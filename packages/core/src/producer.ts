/**
 * 段落生产：plan-segment → 上下文 → LLM → TTS → 可播出段落。
 * 失败返回 null（沉默保底）；节目引擎仍只负责何时开口。
 */
import { buildSegmentPrompt } from './context';
import type { LlmClient } from './llm';
import type { MemoryRecordL1 } from './memory';
import { matchSongRequest } from './request';
import { joinLinesText, normalizeSpeechLines } from './speech';
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
}

export interface SegmentProducerOptions {
  llm: LlmClient;
  tts: TtsClient;
  persona: string;
  stationName: string;
  hostName: string;
  speechExamples: string;
  retrieveRecentSpeech: () => string[];
  retrieveMemories: (now: number) => MemoryRecordL1[];
  tracks: Track[];
  view: () => StationView;
  /** 整段口播的字数硬上限（防长篇独白拖垮节奏） */
  maxSegmentChars?: number;
}

export interface SegmentProducer {
  produce(plan: SegmentPlan): Promise<ProducedSegment | null>;
}

export function createSegmentProducer(options: SegmentProducerOptions): SegmentProducer {
  async function produce(plan: SegmentPlan): Promise<ProducedSegment | null> {
    try {
      const view = options.view();
      const memories = options.retrieveMemories(view.now);
      const recentSpeech = options.retrieveRecentSpeech();
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
        recentSpeech,
        speechExamples: options.speechExamples,
        memories: memories.map((m) => ({
          kind: m.kind,
          text: m.text,
          importance: m.importance,
        })),
      });
      const draft = await options.llm.generateSegment(prompt);
      let songTrackId: string | null = null;
      if (plan.kind === 'reply' && draft.songRequest?.query) {
        songTrackId = matchSongRequest(options.tracks, draft.songRequest.query)?.id ?? null;
      }
      // 韵律行（语速/情绪/停顿）优先；模型没给或全空时退回整段文本
      const lines = normalizeSpeechLines(draft.lines ?? [], {
        maxChars: options.maxSegmentChars ?? Number.POSITIVE_INFINITY,
      });
      const speech = await options.tts.synthesize(lines.length > 0 ? lines : draft.text);
      const text = lines.length > 0 ? joinLinesText(lines) : draft.text;
      return {
        id: plan.id,
        kind: plan.kind,
        text,
        audioPath: speech.filePath,
        durationMs: speech.durationMs,
        cached: speech.cached,
        songTrackId,
      };
    } catch {
      return null;
    }
  }

  return { produce };
}
