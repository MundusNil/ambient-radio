/**
 * 电台组装：把 core 接到真实世界（HTTP / WS / 文件）。
 * 节目引擎出意图 → 段落生产产出语音 → 这里广播与入库。
 */

import { randomUUID } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Clock, Store } from '@ambient-radio/adapters';
import type {
  EngineConfig,
  EngineEvent,
  LlmClient,
  MemoryConfig,
  SchedulerConfig,
  SegmentKind,
  Track,
  TtsClient,
} from '@ambient-radio/core';
import {
  createEngine,
  createProgrammeMemory,
  createScheduler,
  createSegmentProducer,
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
  /** 点歌受理：request_ack 播出后要插入调度器的曲目（P2） */
  songTrackId: string | null;
  /** reply 段消耗的留言 id：播出后从库里删除（重启不重播，FR-051） */
  replyToIds?: string[];
}

/** 维护者审查台页面（apps/admin/index.html） */
const adminHtmlPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'apps',
  'admin',
  'index.html',
);

export interface RadioDeps {
  stationName: string;
  hostName: string;
  persona: string;
  speechExamples: string;
  engineConfig: EngineConfig;
  schedulerConfig: SchedulerConfig;
  ducking: DuckingConfig;
  tracks: Track[];
  libraryRoot: string;
  clock: Clock;
  llm: LlmClient;
  tts: TtsClient;
  store: Store;
  /** 原始留言保留天数（FR-092：7 天） */
  retentionDays: number;
  /** L1 记忆检索配置（P3） */
  memoryConfig: MemoryConfig;
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
  const programmeMemory = createProgrammeMemory({
    config: deps.memoryConfig,
    list: () => deps.store.listMemories(),
    touch: (id, at) => deps.store.touchMemory(id, at),
    insert: (rows) => deps.store.insertMemories(rows),
    nextId: () => randomUUID(),
  });
  const producer = createSegmentProducer({
    llm: deps.llm,
    tts: deps.tts,
    persona: deps.persona,
    stationName: deps.stationName,
    hostName: deps.hostName,
    speechExamples: deps.speechExamples,
    retrieveRecentSpeech: () => {
      const segs = deps.store.listRecentAiredSegments(4);
      return segs
        .slice()
        .reverse()
        .map((s) => s.text);
    },
    retrieveMemories: (now) => programmeMemory.retrieve(now),
    tracks,
    view: () => {
      const now = clock.now();
      const snap = engine.getSnapshot(now);
      return {
        now,
        currentTrack: snap.trackId ? (trackById.get(snap.trackId) ?? null) : null,
        recentTracks: snap.recentTracks,
      };
    },
  });

  const wss = new WebSocketServer({ noServer: true });

  /** 当前曲目的 play 记录 id（track-ended 时收尾） */
  let currentPlayId: string | null = null;

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
      hostSegmentId: snap.hostSegmentId,
      serverTime: now,
    };
  }

  function startTrack(at: number): void {
    const decision = scheduler.pickNext(at);
    scheduler.reportStarted(decision.track.id, at);
    engine.onTrackStarted(decision.track, at);
    consecutiveFailures = 0; // 成功播出一首，失败计数清零（「连续」语义）
    if (currentPlayId !== null) {
      deps.store.endPlay(currentPlayId, at);
    }
    currentPlayId = deps.store.startPlay(decision.track.id, at);
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

  async function produceAndReady(plan: {
    id: string;
    kind: SegmentKind;
    replyTo?: Array<{ id: string; body: string }>;
    ackTitle?: string;
  }): Promise<void> {
    const produced = await producer.produce(plan);
    if (!produced) {
      console.warn('[radio] 段落生成失败（沉默保底，ER-001~003）');
      engine.onSegmentFailed(plan.id);
      return;
    }
    if (produced.songTrackId) {
      const hit = trackById.get(produced.songTrackId);
      if (hit) {
        engine.onRequestAck(hit.title);
        console.log(`[radio] 🎵 点歌受理：《${hit.title}》（${hit.styles.join('/')}）→ 预告后插播`);
      }
    }
    voiceSegments.set(plan.id, {
      id: produced.id,
      kind: produced.kind,
      text: produced.text,
      audioPath: produced.audioPath,
      durationMs: produced.durationMs,
      startedAt: 0,
      songTrackId: produced.songTrackId,
      replyToIds: plan.replyTo?.map((m) => m.id),
    });
    engine.onSegmentReady(produced.id, produced.durationMs);
    console.log(
      `[radio] 💬 ${produced.kind}（${(produced.durationMs / 1000).toFixed(1)}s${produced.cached ? '，缓存命中' : ''}）：${produced.text.slice(0, 40)}${produced.text.length > 40 ? '…' : ''}`,
    );
  }

  /** L1 记忆策展（P3）：播出后提取值得保留的节目事实。失败静默。 */
  async function extractAndStoreMemories(seg: VoiceSegment): Promise<void> {
    try {
      const extracted = await deps.llm.extractMemories(seg.text);
      programmeMemory.ingest(extracted, clock.now());
      if (extracted.length === 0) return;
      console.log(
        `[radio] 🧠 记忆 ${extracted.length} 条：${extracted.map((m) => `[${m.kind}] ${m.text.slice(0, 24)}`).join('；')}`,
      );
    } catch (err) {
      console.warn(
        `[radio] 记忆提取失败（忽略，不影响节目）：${err instanceof Error ? err.message : String(err)}`,
      );
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
          void produceAndReady({
            id: event.id,
            kind: event.kind,
            replyTo: event.replyTo,
            ackTitle: event.ackTitle,
          });
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
          // 回复播出后：消耗的留言从库里删除（FR-051，重启不重播）
          if (aired.replyToIds && aired.replyToIds.length > 0) {
            deps.store.deleteMessages(aired.replyToIds);
          }
          // 节目记录（P3 记忆的基础数据；原始文案仅存库，不外泄）
          try {
            deps.store.insertSegment({
              id: aired.id,
              kind: aired.kind,
              text: aired.text,
              audioPath: aired.audioPath,
              durationMs: aired.durationMs,
              plannedAt: 0,
              airedAt: aired.startedAt,
              status: 'aired',
            });
          } catch (err) {
            // 记录失败不影响播出（ER 哲学：绝不因内部故障打断节目）
            console.warn(
              `[radio] 段记录入库失败（忽略）：${err instanceof Error ? err.message : String(err)}`,
            );
          }
          // L1 记忆策展（P3）：播出后异步提取值得保留的节目事实（失败静默，不阻塞节目）
          void extractAndStoreMemories(aired);
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

  // ---- 维护者审查（P3，FR-100：与普通收听体验分离；单机版无鉴权，公网部署前需加） ----

  app.get('/api/admin/memories', (c) => c.json(deps.store.listMemories()));

  app.delete('/api/admin/memories/:id', (c) => {
    deps.store.deleteMemory(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.get('/api/admin/messages', (c) => c.json(deps.store.listActiveMessages(clock.now())));

  /** 维护者审查台页面（P3，FR-100） */
  app.get('/admin', (c) =>
    c.html(readFileSync(adminHtmlPath, 'utf-8'), 200, {
      'Content-Type': 'text/html; charset=utf-8',
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
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  function start(): void {
    // 电台开机即开播（D5：音乐时间线永远走，调频进来时音乐已经在放）
    // 重启恢复：上次没播完的曲目从剩余位置接着播（电台重启不失忆）
    const now = clock.now();
    const unfinished = deps.store.getLastUnfinishedPlay();
    const resumeTrack = unfinished ? trackById.get(unfinished.trackId) : undefined;
    if (unfinished && resumeTrack && now < unfinished.startedAt + resumeTrack.durationMs) {
      // 恢复调度器防重复记忆：最近 30 分钟播放史
      for (const play of deps.store.listRecentPlays(now - deps.schedulerConfig.noRepeatWindowMs)) {
        scheduler.reportStarted(play.trackId, play.startedAt);
      }
      engine.onTrackStarted(resumeTrack, unfinished.startedAt);
      currentPlayId = unfinished.id;
      console.log(
        `[radio] ↻ 恢复上次节目：${resumeTrack.title}（${Math.round((now - unfinished.startedAt) / 1000)}s 处）`,
      );
      broadcast({
        type: 'track',
        trackId: resumeTrack.id,
        title: resumeTrack.title,
        startedAt: unfinished.startedAt,
        durationMs: resumeTrack.durationMs,
      });
    } else {
      // 上次播完或已过时：正常开播
      if (unfinished && resumeTrack) {
        deps.store.endPlay(unfinished.id, now);
      }
      startTrack(now);
    }
    for (const msg of deps.store.listActiveMessages(now)) {
      engine.onMessage({ id: msg.id, body: msg.body, receivedAt: msg.receivedAt });
    }
    tickTimer = setInterval(() => {
      const tickNow = clock.now();
      const events = engine.tick(tickNow);
      if (events.length > 0) handleEvents(events, tickNow);
    }, 1000);
    // 每日清理过期留言（FR-092）
    cleanupTimer = setInterval(
      () => {
        const removed = deps.store.deleteExpiredMessages(clock.now());
        if (removed > 0) console.log(`[radio] 🧹 清理过期留言 ${removed} 条`);
      },
      24 * 60 * 60 * 1000,
    );
  }

  function stop(): void {
    if (tickTimer !== null) clearInterval(tickTimer);
    if (cleanupTimer !== null) clearInterval(cleanupTimer);
  }

  /** ER-004/005：连续失败计数，≥3 进信号丢失状态 */
  let consecutiveFailures = 0;

  /** 单曲损坏：拉黑 + 强制换下一首（ER-004） */
  async function onTrackFailed(trackId: string): Promise<void> {
    const track = trackById.get(trackId);
    if (!track) return;
    // 区分「文件真丢了」与「解码暂时失败」：文件还在 → 不拉黑（可能是瞬时解码压力），仅换歌
    const absPath = join(libraryRoot, track.path);
    const fileExists = await stat(absPath)
      .then((s) => s.isFile())
      .catch(() => false);
    if (!fileExists) {
      scheduler.blacklistTrack(trackId);
      console.warn(`[radio] ⚠️ 曲目文件缺失（${track.title}）已拉黑，尝试下一首（ER-004）`);
    } else {
      console.warn(`[radio] ⚠️ 曲目解码失败（${track.title}）文件仍在，换下一首重试（不拉黑）`);
    }
    consecutiveFailures += 1;
    if (consecutiveFailures >= 3) {
      console.error('[radio] 📡 连续 3 首失败：信号丢失（ER-005）');
      broadcast({ type: 'off-air', reason: 'library' });
      return;
    }
    // 强制换曲：选新曲并直接接管时间线（engine 无感知的覆盖，plays 由 startTrack 收尾）
    try {
      const now = clock.now();
      const decision = scheduler.pickNext(now);
      scheduler.reportStarted(decision.track.id, now);
      if (currentPlayId !== null) {
        deps.store.endPlay(currentPlayId, now);
      }
      currentPlayId = deps.store.startPlay(decision.track.id, now);
      engine.onTrackStarted(decision.track, now);
      broadcast({
        type: 'track',
        trackId: decision.track.id,
        title: decision.track.title,
        startedAt: now,
        durationMs: decision.track.durationMs,
      });
    } catch {
      // 曲库耗尽：信号丢失（ER-005）
      console.error('[radio] 📡 曲库无可播放曲目：信号丢失（ER-005）');
      broadcast({ type: 'off-air', reason: 'library' });
    }
  }

  /** 上行留言处理（P2）：入库（7 天保留）→ 引擎 SLA 队列 → 回执 */
  function handleClientMessage(ws: WebSocket, raw: string): void {
    try {
      const parsed = JSON.parse(raw) as { type?: string; body?: string; trackId?: string };
      if (parsed.type === 'track-failed' && typeof parsed.trackId === 'string') {
        void onTrackFailed(parsed.trackId);
        return;
      }
      if (parsed.type !== 'message' || typeof parsed.body !== 'string' || !parsed.body.trim()) {
        return;
      }
      const now = clock.now();
      const id = randomUUID();
      const retention = deps.retentionDays * 86_400_000;
      deps.store.insertMessage({
        id,
        body: parsed.body.trim(),
        receivedAt: now,
        expiresAt: now + retention,
      });
      engine.onMessage({ id, body: parsed.body.trim(), receivedAt: now });
      ws.send(JSON.stringify({ type: 'received', id }));
      console.log(`[radio] 💌 留言（${id.slice(0, 8)}）：${parsed.body.trim().slice(0, 40)}`);
    } catch {
      // 无效消息忽略，事件流不断
    }
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
      ws.on('message', (raw) => {
        handleClientMessage(ws, raw.toString());
      });
      ws.on('close', () => {
        engine.onListenersChanged(wss.clients.size);
      });
    });
  }

  return { app, start, stop, attachWs };
}
