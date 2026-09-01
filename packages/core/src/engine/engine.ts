/**
 * 节目引擎（技术设计 §4.1）：每秒 tick 的状态机。
 * 「何时说话」比「说什么」更重要 —— 本模块只决定节奏与意图，
 * 文本与语音的生成在 seam 之外（组装层响应 plan-segment 事件）。
 *
 * 状态流转：
 *   MUSIC ──plan──▶ GENERATING ──ready──▶ (自然节点) VOICE ──endsAt──▶ MUSIC
 *
 * 零 IO：随机数注入；时间由调用方以 epoch ms 传入。
 */
import type { EngineConfig } from '../config';
import type { SegmentKind, Track } from '../types';

export type EngineEvent =
  /** 当前曲目播完（组装层：选下一首并回填 onTrackStarted） */
  | { type: 'track-ended'; trackId: string }
  /** 规划一个段落（组装层：上下文构建 → LLM → TTS → onSegmentReady/onSegmentFailed） */
  | {
      type: 'plan-segment';
      id: string;
      kind: SegmentKind;
      /** kind=reply 时：本次要回应的留言（合并多条，FR-054） */
      replyTo?: Array<{ id: string; body: string }>;
      /** kind=request_ack 时：被受理点歌的曲名 */
      ackTitle?: string;
    }
  /** 在自然节点播出已就绪的段落（组装层：广播 voice + 播放音频） */
  | { type: 'play-segment'; segmentId: string; startedAt: number; durationMs: number };

export interface EngineSnapshot {
  trackId: string | null;
  trackTitle: string | null;
  trackStartedAt: number;
  trackDurationMs: number;
  positionMs: number;
  hostTalking: boolean;
  hostSegmentId: string | null;
  listeners: number;
  recentTracks: Array<{ id: string; title: string; artist: string | null; styles: string[] }>;
}

export interface EngineOptions {
  config: EngineConfig;
  /** [0, 1) 均匀随机；组装层注入（默认 Math.random） */
  rng: () => number;
}

export interface ListenerMessageIn {
  id: string;
  body: string;
  receivedAt: number;
}

export interface Engine {
  /** 每秒调用；返回本 tick 的意图事件（幂等：状态转换的那一 tick 才发） */
  tick(now: number): EngineEvent[];
  onTrackStarted(track: Track, at: number): void;
  onSegmentReady(id: string, durationMs: number): void;
  onSegmentFailed(id: string): void;
  onListenersChanged(count: number): void;
  /** 收到一条听众留言（P2：进入 SLA 回应队列） */
  onMessage(message: ListenerMessageIn): void;
  /** 受理了点歌：安排一次 request_ack 预告（P2） */
  onRequestAck(title: string): void;
  /** /api/state 与上下文构建共用的时间线快照 */
  getSnapshot(now: number): EngineSnapshot;
}

interface PendingSegment {
  id: string;
  kind: SegmentKind;
  state: 'planned' | 'ready';
  durationMs: number | null;
  plannedAt: number;
  /** kind=reply：本次回应消耗的留言 id（play 时出队） */
  replyToIds?: string[];
}

interface VoiceState {
  segmentId: string;
  startedAt: number;
  endsAt: number;
}

const RECENT_TRACK_LIMIT = 5;

export function createEngine(options: EngineOptions): Engine {
  const { config } = options;
  const rng = options.rng ?? Math.random;

  let currentTrack: Track | null = null;
  let trackStartedAt = 0;
  let voice: VoiceState | null = null;
  let pending: PendingSegment | null = null;
  let nextTalkDue = Number.POSITIVE_INFINITY;
  let lastSegmentEndedAt: number | null = null;
  let lastTopicAt = Number.NEGATIVE_INFINITY;
  let listeners = 0;
  let stationIdDue = false;
  let seq = 0;
  const recentTracks: Track[] = [];
  /** P2：待回应留言（按到达顺序；SLA 45s 优先 / 90s force） */
  const replyQueue: Array<{ id: string; body: string; receivedAt: number }> = [];
  /** P2：待播的点歌预告（一次一条） */
  let ackTitle: string | null = null;

  function sampleInterval(): number {
    const [min, max] = config.talkIntervalMs;
    return min + rng() * (max - min);
  }

  /** 自然节点：曲目中段（前奏与尾奏保护，绝不打断一首歌的开头） */
  function atNaturalNode(now: number, forced = false): boolean {
    if (!currentTrack) return false;
    const elapsed = now - trackStartedAt;
    const { minIntoTrackMs, minBeforeTrackEndMs } = config.nodeWindow;
    if (elapsed < minIntoTrackMs) return false;
    if (forced) return true; // force：尾奏保护让位，前奏保护保留
    return elapsed <= currentTrack.durationMs - minBeforeTrackEndMs;
  }

  function shouldSpeak(): boolean {
    return listeners > 0 || config.speakWhenAlone;
  }

  function tick(now: number): EngineEvent[] {
    const events: EngineEvent[] = [];

    // VOICE 结束 → 回到 MUSIC
    if (voice && now >= voice.endsAt) {
      lastSegmentEndedAt = voice.endsAt;
      voice = null;
    }

    // 曲目结束：音乐时间线永远走，与 VOICE 独立（D5）
    let trackEndedThisTick = false;
    if (currentTrack && now >= trackStartedAt + currentTrack.durationMs) {
      recentTracks.unshift(currentTrack);
      if (recentTracks.length > RECENT_TRACK_LIMIT) {
        recentTracks.length = RECENT_TRACK_LIMIT;
      }
      events.push({ type: 'track-ended', trackId: currentTrack.id });
      currentTrack = null;
      trackEndedThisTick = true;
    }

    // VOICE 期间不规划、不播出
    if (voice) return events;

    // 组装层无响应的段落：静默丢弃，节奏照常（ER 哲学）
    if (pending && now - pending.plannedAt > config.pendingTimeoutMs) {
      pending = null;
    }
    // 60% 预取：曲目结束时仍未就绪 → 放弃该段落（来不及则沉默保底）
    if (trackEndedThisTick && pending && pending.state === 'planned') {
      pending = null;
    }

    // 规划：优先级——request_ack > 留言 force > 留言 prefer > 台呼 > next_talk_due
    // minTalkGap 只约束主动串场；留言/点歌是 SLA 驱动，不受间隔限制
    const oldest = replyQueue[0];
    const hasPendingReply = oldest !== undefined;
    const gapOk =
      lastSegmentEndedAt === null ||
      now >= lastSegmentEndedAt + config.minTalkGapMs ||
      ackTitle !== null ||
      hasPendingReply;
    if (!pending && shouldSpeak() && gapOk) {
      const replyDue = hasPendingReply && now >= oldest.receivedAt + config.preferReplyMs;
      const replyForced = hasPendingReply && now >= oldest.receivedAt + config.forceReplyMs;

      if (ackTitle !== null && atNaturalNode(now)) {
        const title = ackTitle;
        ackTitle = null;
        pending = {
          id: `seg-${now}-${++seq}`,
          kind: 'request_ack',
          state: 'planned',
          durationMs: null,
          plannedAt: now,
        };
        nextTalkDue = now + sampleInterval();
        events.push({ type: 'plan-segment', id: pending.id, kind: 'request_ack', ackTitle: title });
      } else if (replyForced) {
        // 不 splice：留言留在队列，play 时才出队（生成失败自动留队重试）
        const batch = replyQueue.slice(0, 3); // 合并最多 3 条（FR-054）
        pending = {
          id: `seg-${now}-${++seq}`,
          kind: 'reply',
          state: 'planned',
          durationMs: null,
          plannedAt: now,
          replyToIds: batch.map((m) => m.id),
        };
        nextTalkDue = now + sampleInterval();
        events.push({
          type: 'plan-segment',
          id: pending.id,
          kind: 'reply',
          replyTo: batch.map((m) => ({ id: m.id, body: m.body })),
        });
      } else if (replyDue && atNaturalNode(now)) {
        const batch = replyQueue.slice(0, 3);
        pending = {
          id: `seg-${now}-${++seq}`,
          kind: 'reply',
          state: 'planned',
          durationMs: null,
          plannedAt: now,
          replyToIds: batch.map((m) => m.id),
        };
        nextTalkDue = now + sampleInterval();
        events.push({
          type: 'plan-segment',
          id: pending.id,
          kind: 'reply',
          replyTo: batch.map((m) => ({ id: m.id, body: m.body })),
        });
      } else if (stationIdDue && atNaturalNode(now)) {
        pending = {
          id: `seg-${now}-${++seq}`,
          kind: 'station_id',
          state: 'planned',
          durationMs: null,
          plannedAt: now,
        };
        stationIdDue = false;
        nextTalkDue = now + sampleInterval();
        events.push({ type: 'plan-segment', id: pending.id, kind: 'station_id' });
      } else if (
        currentTrack !== null &&
        (now >= nextTalkDue ||
          (now >= trackStartedAt + currentTrack.durationMs * 0.6 &&
            nextTalkDue <= trackStartedAt + currentTrack.durationMs))
      ) {
        const topicEligible = now - lastTopicAt >= config.topicCooldownMs;
        const kind: SegmentKind =
          topicEligible && rng() < config.topicChance ? 'topic' : 'interlude';
        if (kind === 'topic') lastTopicAt = now;
        pending = {
          id: `seg-${now}-${++seq}`,
          kind,
          state: 'planned',
          durationMs: null,
          plannedAt: now,
        };
        nextTalkDue = now + sampleInterval();
        events.push({ type: 'plan-segment', id: pending.id, kind });
      }
    }

    // 播出：已就绪 + 自然节点（曲目边界也算节点：voice 从边界起，压新歌前奏）
    if (
      pending &&
      pending.state === 'ready' &&
      pending.durationMs !== null &&
      (atNaturalNode(now) || trackEndedThisTick)
    ) {
      // reply 播出：本次回应的留言正式出队（FR-051 连续留言按批处理）
      if (pending.replyToIds && pending.replyToIds.length > 0) {
        const consumed = new Set(pending.replyToIds);
        for (let i = replyQueue.length - 1; i >= 0; i -= 1) {
          const msg = replyQueue[i];
          if (msg && consumed.has(msg.id)) replyQueue.splice(i, 1);
        }
      }
      voice = {
        segmentId: pending.id,
        startedAt: now,
        endsAt: now + pending.durationMs,
      };
      events.push({
        type: 'play-segment',
        segmentId: pending.id,
        startedAt: now,
        durationMs: pending.durationMs,
      });
      pending = null;
    }

    return events;
  }

  function onTrackStarted(track: Track, at: number): void {
    currentTrack = track;
    trackStartedAt = at;
    if (nextTalkDue === Number.POSITIVE_INFINITY) {
      nextTalkDue = at + sampleInterval();
    }
  }

  function onSegmentReady(id: string, durationMs: number): void {
    if (pending && pending.id === id) {
      pending.state = 'ready';
      pending.durationMs = durationMs;
    }
  }

  function onSegmentFailed(id: string): void {
    // ER 哲学：本段放弃，音乐照常，主播沉默（组装层自己知道失败）。
    // reply 段失败：留言仍在队列，SLA 到期后自然重试。
    if (pending && pending.id === id) {
      pending = null;
    }
  }

  function onMessage(message: ListenerMessageIn): void {
    replyQueue.push(message);
  }

  function onRequestAck(title: string): void {
    ackTitle = title;
  }

  function onListenersChanged(count: number): void {
    const wasEmpty = listeners === 0;
    listeners = count;
    // 0 → n：新会话开始，安排一次台呼（FR-004/005）
    if (wasEmpty && listeners > 0) {
      stationIdDue = true;
    }
  }

  function getSnapshot(now: number): EngineSnapshot {
    return {
      trackId: currentTrack?.id ?? null,
      trackTitle: currentTrack?.title ?? null,
      trackStartedAt,
      trackDurationMs: currentTrack?.durationMs ?? 0,
      positionMs: currentTrack ? Math.max(0, now - trackStartedAt) : 0,
      hostTalking: voice !== null,
      hostSegmentId: voice?.segmentId ?? null,
      listeners,
      recentTracks: recentTracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        styles: t.styles,
      })),
    };
  }

  return {
    tick,
    onTrackStarted,
    onSegmentReady,
    onSegmentFailed,
    onListenersChanged,
    onMessage,
    onRequestAck,
    getSnapshot,
  };
}
