/**
 * 电台组装核心：把 core 的纯逻辑接到真实世界。
 * 引擎出意图事件 → 这里执行（选曲、广播、生成管线）。
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Clock } from '@ambient-radio/adapters';
import type { EngineConfig, EngineEvent, SchedulerConfig, Track } from '@ambient-radio/core';
import { createEngine, createScheduler } from '@ambient-radio/core';
import type { ServerEvent, StationState } from '@ambient-radio/shared';
import { Hono } from 'hono';
import { WebSocket, WebSocketServer } from 'ws';
import type { DuckingConfig } from './config';

const CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

export interface RadioDeps {
  stationName: string;
  hostName: string;
  engineConfig: EngineConfig;
  schedulerConfig: SchedulerConfig;
  ducking: DuckingConfig;
  tracks: Track[];
  libraryRoot: string;
  clock: Clock;
}

export function createRadio(deps: RadioDeps) {
  const { tracks, libraryRoot, clock } = deps;
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const engine = createEngine({ config: deps.engineConfig, rng: Math.random });
  const scheduler = createScheduler({
    tracks,
    config: deps.schedulerConfig,
    rng: Math.random,
  });

  const wss = new WebSocketServer({ noServer: true });

  /** 串场管线占位提示的节流计数（LLM/TTS 接入后删除） */
  let pipelineNoticeLeft = 3;

  function broadcast(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  function getState(): StationState {
    const now = clock.now();
    const snap = engine.getSnapshot(now);
    return {
      trackId: snap.trackId,
      title: snap.trackTitle,
      startedAt: snap.trackStartedAt,
      durationMs: snap.trackDurationMs,
      positionMs: snap.positionMs,
      hostTalking: snap.hostTalking,
      serverTime: now,
    };
  }

  function startTrack(at: number): void {
    const decision = scheduler.pickNext(at);
    scheduler.reportStarted(decision.track.id, at);
    engine.onTrackStarted(decision.track, at);
    if (decision.relaxedNoRepeat) {
      console.warn(
        `[scheduler] 曲库不足，放宽 30 分钟防重复（FR-018 例外）：${decision.track.title}`,
      );
    }
    console.log(
      `[radio] ▶ ${decision.track.title}（${decision.track.styles.join('/')}，${Math.round(decision.track.durationMs / 1000)}s）`,
    );
    broadcast({
      type: 'track',
      trackId: decision.track.id,
      title: decision.track.title,
      startedAt: at,
      durationMs: decision.track.durationMs,
    });
  }

  function handleEvents(events: EngineEvent[], now: number): void {
    for (const event of events) {
      switch (event.type) {
        case 'track-ended': {
          startTrack(now);
          break;
        }
        case 'plan-segment': {
          // P1 串场管线占位：LLM + TTS 适配器是下一个切片。
          // 沉默保底（ER-001~003）：生成不可用即静默丢弃，音乐照常，节奏不乱。
          engine.onSegmentFailed(event.id);
          if (pipelineNoticeLeft > 0) {
            pipelineNoticeLeft -= 1;
            console.log(
              `[radio] 引擎规划了 ${event.kind} 段落（串场管线未接入，已按沉默保底丢弃）`,
            );
          }
          break;
        }
        case 'play-segment': {
          // 当前不可达（plan 即 fail）；语音轨接入后：广播 voice + ducking
          broadcast({
            type: 'voice',
            segmentId: event.segmentId,
            startedAt: event.startedAt,
            durationMs: event.durationMs,
          });
          break;
        }
      }
    }
  }

  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/state', (c) => c.json(getState()));

  /** 前端需要的公开信息（电台名、ducking 曲线参数——曲线在配置里，不在代码里） */
  app.get('/api/config', (c) =>
    c.json({
      station: { name: deps.stationName, host: deps.hostName },
      audio: { ducking: deps.ducking },
    }),
  );

  app.get('/audio/track/:id', async (c) => {
    const track = trackById.get(c.req.param('id'));
    if (!track) return c.json({ error: 'track not found' }, 404);
    const absPath = join(libraryRoot, track.path);
    const info = await stat(absPath).catch(() => null);
    if (!info?.isFile()) return c.json({ error: 'track file missing' }, 410);
    const contentType =
      CONTENT_TYPES[track.path.slice(track.path.lastIndexOf('.'))] ?? 'application/octet-stream';
    const stream = Readable.toWeb(createReadStream(absPath)) as ReadableStream<Uint8Array>;
    return c.body(stream, 200, {
      'Content-Type': contentType,
      'Content-Length': String(info.size),
      'Cache-Control': 'no-cache',
    });
  });

  let tickTimer: ReturnType<typeof setInterval> | null = null;

  function start(): void {
    // 电台开机即开播（D5：音乐时间线永远走，调频进来时音乐已经在放）
    startTrack(clock.now());
    tickTimer = setInterval(() => {
      const now = clock.now();
      const events = engine.tick(now);
      if (events.length > 0) handleEvents(events, now);
    }, 1000);
  }

  function stop(): void {
    if (tickTimer !== null) clearInterval(tickTimer);
  }

  function attachWs(server: Server): void {
    server.on('upgrade', (req, socket, head) => {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      if (pathname !== '/ws') {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
    wss.on('connection', (ws) => {
      // WS 连接数即在场人数（§4.7）
      engine.onListenersChanged(wss.clients.size);
      // 调频进入：立即补发当前状态
      ws.send(JSON.stringify({ type: 'sync', state: getState() }));
      ws.on('close', () => {
        engine.onListenersChanged(wss.clients.size);
      });
    });
  }

  return { app, start, stop, attachWs };
}
