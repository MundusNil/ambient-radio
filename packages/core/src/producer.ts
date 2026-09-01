/**
 * 段落生产：plan-segment → 上下文 → LLM → TTS → 可播出段落。
 * 失败返回 null（沉默保底）；节目引擎仍只负责何时开口。
 */
import { buildSegmentPrompt } from './context';
import type { LlmClient } from './llm';
import { selectLoreEntries } from './lore';
import type { LoreEntry } from './lore';
import type { MemoryRecordL1 } from './memory';
import { matchSongRequest } from './request';
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
  loreEntries: LoreEntry[];
  retrieveRecentSpeech: () => string[];
  retrieveMemories: (now: number) => MemoryRecordL1[];
  tracks: Track[];
  view: () => StationView;
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
      const styles = view.currentTrack?.styles ?? [];
      const haystack = [...recentSpeech, view.currentTrack?.title ?? '', ...styles].join('\n');
      const lore = selectLoreEntries(options.loreEntries, haystack, styles);
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
        lore,
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
      const speech = await options.tts.synthesize(draft.text);
      return {
        id: plan.id,
        kind: plan.kind,
        text: draft.text,
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
