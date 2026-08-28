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
  | { type: 'plan-segment'; id: string; kind: SegmentKind }
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

export interface Engine {
  /** 每秒调用；返回本 tick 的意图事件（幂等：状态转换的那一 tick 才发） */
  tick(now: number): EngineEvent[];
  onTrackStarted(track: Track, at: number): void;
  onSegmentReady(id: string, durationMs: number): void;
  onSegmentFailed(id: string): void;
  onListenersChanged(count: number): void;
  /** /api/state 与上下文构建共用的时间线快照 */
  getSnapshot(now: number): EngineSnapshot;
}

interface PendingSegment {
  id: string;
  kind: SegmentKind;
  state: 'planned' | 'ready';
  durationMs: number | null;
  plannedAt: number;
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

  function sampleInterval(): number {
    const [min, max] = config.talkIntervalMs;
    return min + rng() * (max - min);
  }

  /** 自然节点：曲目中段（前奏与尾奏保护，绝不打断一首歌的开头） */
  function atNaturalNode(now: number): boolean {
    if (!currentTrack) return false;
    const elapsed = now - trackStartedAt;
    const { minIntoTrackMs, minBeforeTrackEndMs } = config.nodeWindow;
    return elapsed >= minIntoTrackMs && elapsed <= currentTrack.durationMs - minBeforeTrackEndMs;
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

    // 规划：台呼优先，其次 next_talk_due
    const gapOk = lastSegmentEndedAt === null || now >= lastSegmentEndedAt + config.minTalkGapMs;
    if (!pending && shouldSpeak() && gapOk) {
      if (stationIdDue && atNaturalNode(now)) {
        pending = {
          id: `seg-${++seq}`,
          kind: 'station_id',
          state: 'planned',
          durationMs: null,
          plannedAt: now,
        };
        stationIdDue = false;
        nextTalkDue = now + sampleInterval();
        events.push({ type: 'plan-segment', id: pending.id, kind: 'station_id' });
      } else if (now >= nextTalkDue) {
        const topicEligible = now - lastTopicAt >= config.topicCooldownMs;
        const kind: SegmentKind =
          topicEligible && rng() < config.topicChance ? 'topic' : 'interlude';
        if (kind === 'topic') lastTopicAt = now;
        pending = {
          id: `seg-${++seq}`,
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
    // ER 哲学：本段放弃，音乐照常，主播沉默（组装层自己知道失败）
    if (pending && pending.id === id) {
      pending = null;
    }
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
    getSnapshot,
  };
}
