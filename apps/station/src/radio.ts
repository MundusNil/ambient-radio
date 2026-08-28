/**
 * 电台组装核心：把 core 的纯逻辑接到真实世界。
 * 引擎出意图事件 → 这里执行（选曲、生成、广播）。
 * 生成管线：plan-segment → 上下文构建 → LLM → TTS → onSegmentReady；
 * 任一环失败即按沉默保底（ER-001~003）静默丢弃，音乐照常。
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Clock } from '@ambient-radio/adapters';
import type {
  EngineConfig,
  EngineEvent,
  LlmClient,
  SchedulerConfig,
  SegmentKind,
  Track,
  TtsClient,
} from '@ambient-radio/core';
import {
  buildSegmentPrompt,
  createEngine,
  createScheduler,
  getDayPartContext,
} from '@ambient-radio/core';
import type { ServerEvent, StationState } from '@ambient-radio/shared';
import type { ServerType } from '@hono/node-server';
import { type Context, Hono } from 'hono';
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

/** 语音段落保留上限（P3 进 SQLite 前先用内存；防无界增长） */
const AIRED_SEGMENT_LIMIT = 50;

interface VoiceSegment {
  id: string;
  kind: SegmentKind;
  text: string;
  audioPath: string;
  durationMs: number;
  startedAt: number;
}

export interface RadioDeps {
  stationName: string;
  hostName: string;
  persona: string;
  engineConfig: EngineConfig;
  schedulerConfig: SchedulerConfig;
  ducking: DuckingConfig;
  tracks: Track[];
  libraryRoot: string;
  clock: Clock;
  llm: LlmClient;
  tts: TtsClient;
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

  /** 生成中/已生成待播的段落（id → 内容） */
  const voiceSegments = new Map<string, VoiceSegment>();
  /** 已播出的段落（供 /audio/segment/:id 回放引用，按 startedAt 淘汰） */
  const airedSegments: VoiceSegment[] = [];

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

  /** 生成管线：plan-segment → LLM → TTS → ready；失败静默丢弃（沉默保底） */
  async function generateSegment(plan: { id: string; kind: SegmentKind }): Promise<void> {
    try {
      const snap = engine.getSnapshot(clock.now());
      const prompt = buildSegmentPrompt({
        kind: plan.kind,
        persona: deps.persona,
        stationName: deps.stationName,
        hostName: deps.hostName,
        dayPart: getDayPartContext(new Date(clock.now())),
        currentTrack: snap.trackId ? (trackById.get(snap.trackId) ?? null) : null,
        recentTracks: snap.recentTracks,
      });
      const draft = await deps.llm.generateSegment(prompt);
      const speech = await deps.tts.synthesize(draft.text);
      voiceSegments.set(plan.id, {
        id: plan.id,
        kind: plan.kind,
        text: draft.text,
        audioPath: speech.filePath,
        durationMs: speech.durationMs,
        startedAt: 0,
      });
      engine.onSegmentReady(plan.id, speech.durationMs);
      console.log(
        `[radio] 💬 ${plan.kind}（${(speech.durationMs / 1000).toFixed(1)}s${speech.cached ? '，缓存命中' : ''}）：${draft.text.slice(0, 40)}${draft.text.length > 40 ? '…' : ''}`,
      );
    } catch (err) {
      console.warn(
        `[radio] 段落生成失败（沉默保底，ER-001~003）：${err instanceof Error ? err.message : String(err)}`,
      );
      engine.onSegmentFailed(plan.id);
    }
  }

  function handleEvents(events: EngineEvent[], now: number): void {
    for (const event of events) {
      switch (event.type) {
        case 'track-ended': {
          startTrack(now);
          break;
        }
        case 'plan-segment': {
          void generateSegment(event);
          break;
        }
        case 'play-segment': {
          const seg = voiceSegments.get(event.segmentId);
          if (!seg) break;
          const aired: VoiceSegment = { ...seg, startedAt: event.startedAt };
          airedSegments.push(aired);
          if (airedSegments.length > AIRED_SEGMENT_LIMIT) {
            airedSegments.shift();
          }
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

  async function streamFile(c: Context, absPath: string, contentType: string): Promise<Response> {
    const info = await stat(absPath).catch(() => null);
    if (!info?.isFile()) return c.json({ error: 'file missing' }, 410);
    const stream = Readable.toWeb(createReadStream(absPath)) as ReadableStream<Uint8Array>;
    return c.body(stream, 200, {
      'Content-Type': contentType,
      'Content-Length': String(info.size),
      'Cache-Control': 'no-cache',
    });
  }

  app.get('/audio/track/:id', async (c) => {
    const track = trackById.get(c.req.param('id'));
    if (!track) return c.json({ error: 'track not found' }, 404);
    const absPath = join(libraryRoot, track.path);
    const ext = track.path.slice(track.path.lastIndexOf('.'));
    return streamFile(c, absPath, CONTENT_TYPES[ext] ?? 'application/octet-stream');
  });

  app.get('/audio/segment/:id', async (c) => {
    const seg =
      voiceSegments.get(c.req.param('id')) ?? airedSegments.find((s) => s.id === c.req.param('id'));
    if (!seg) return c.json({ error: 'segment not found' }, 404);
    return streamFile(c, seg.audioPath, 'audio/mpeg');
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

  function attachWs(server: ServerType): void {
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
      // WS 连接数即在场人数（技术设计 §4.7）
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
