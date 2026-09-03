/**
 * 段落生产：plan-segment → 上下文 → LLM → TTS → 可播出段落。
 * 失败返回 null（沉默保底）；节目引擎仍只负责何时开口。
 */
import { buildSegmentPrompt } from './context';
import type { LlmClient } from './llm';
import type { MemoryRecordL1 } from './memory';
import { matchSongRequest } from './request';
import { clipSpokenText, joinLinesText, normalizeSpeechLines } from './speech';
import { getDayPartContext } from './time';
import type { TtsClient } from './tts';
import type { SegmentKind, Track } from './types';

export interface SegmentPlan {
  id: string;
  kind: SegmentKind;
  replyTo?: Array<{ id: string; body: string }>;
  ackTitle?: string;
}

export interface ProducedSegment {
  id: string;
  kind: SegmentKind;
  text: string;
  audioPath: string;
  durationMs: number;
  cached: boolean;
  songTrackId: string | null;
}

export interface StationView {
  now: number;
  currentTrack: Track | null;
  recentTracks: Array<{ title: string; artist: string | null; styles: string[] }>;
  recentAired?: Array<{ kind: SegmentKind; text: string }>;
}

export interface SegmentProducerOptions {
  llm: LlmClient;
  tts: TtsClient;
  persona: string;
  stationName: string;
  hostName: string;
  retrieveMemories: (now: number) => MemoryRecordL1[];
  tracks: Track[];
  view: () => StationView;
  /** 整段口播的字数硬上限（防长篇独白拖垮节奏） */
  maxSegmentChars?: number;
  /** 按段落类型覆盖字数上限（对齐 FR-032/033） */
  maxSegmentCharsByKind?: Partial<Record<SegmentKind, number>>;
  /** 生成失败回调（组装层打日志）；produce 仍返回 null（ER-001~003） */
  onError?: (err: unknown) => void;
}

export interface SegmentProducer {
  produce(plan: SegmentPlan): Promise<ProducedSegment | null>;
}

export function createSegmentProducer(options: SegmentProducerOptions): SegmentProducer {
  async function produce(plan: SegmentPlan): Promise<ProducedSegment | null> {
    try {
      const view = options.view();
      const memories = options.retrieveMemories(view.now);
      const prompt = buildSegmentPrompt({
        kind: plan.kind,
        persona: options.persona,
        stationName: options.stationName,
        hostName: options.hostName,
        dayPart: getDayPartContext(new Date(view.now)),
        currentTrack: view.currentTrack,
        recentTracks: view.recentTracks,
        replyTo: plan.replyTo,
        ackTitle: plan.ackTitle,
        memories: memories.map((m) => ({
          kind: m.kind,
          text: m.text,
          importance: m.importance,
        })),
        recentAired: view.recentAired,
      });
      const draft = await options.llm.generateSegment(prompt);
      let songTrackId: string | null = null;
      if (plan.kind === 'reply' && draft.songRequest?.query) {
        songTrackId = matchSongRequest(options.tracks, draft.songRequest.query)?.id ?? null;
      }
      const maxChars =
        options.maxSegmentCharsByKind?.[plan.kind] ??
        options.maxSegmentChars ??
        Number.POSITIVE_INFINITY;
      const lines = normalizeSpeechLines(draft.lines ?? [], { maxChars });
      const text = lines.length > 0 ? joinLinesText(lines) : clipSpokenText(draft.text, maxChars);
      const speech = await options.tts.synthesize(lines.length > 0 ? lines : text);
      return {
        id: plan.id,
        kind: plan.kind,
        text,
        audioPath: speech.filePath,
        durationMs: speech.durationMs,
        cached: speech.cached,
        songTrackId,
      };
    } catch (err) {
      options.onError?.(err);
      return null;
    }
  }

  return { produce };
}
