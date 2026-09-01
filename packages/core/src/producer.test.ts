import { describe, expect, it } from 'vitest';
import { DEFAULT_INTERLUDE_CONFIG } from './config';
import type { LlmClient } from './llm';
import { createSegmentProducer } from './producer';
import type { TtsClient } from './tts';
import type { Track } from './types';

const PERSONA = '# 梦可\n温柔、安静、细腻、克制。';

const track: Track = {
  id: 't-moon',
  path: 'cafe/moon.mp3',
  title: '月光小径',
  artist: null,
  durationMs: 240_000,
  styles: ['cafe'],
  enabled: true,
  addedAt: 0,
};

const llmOk = (text = '今晚风很轻。'): LlmClient => ({
  generateSegment: async () => ({ text, songRequest: null }),
  extractMemories: async () => [],
});

const ttsOk: TtsClient = {
  synthesize: async () => ({ filePath: '/tmp/seg.mp3', durationMs: 4200, cached: false }),
};

const producerOf = (overrides: { llm?: LlmClient; tts?: TtsClient; tracks?: Track[] } = {}) =>
  createSegmentProducer({
    llm: overrides.llm ?? llmOk(),
    tts: overrides.tts ?? ttsOk,
    persona: PERSONA,
    stationName: '梦可电台',
    hostName: '梦可',
    interlude: DEFAULT_INTERLUDE_CONFIG,
    retrieveMemories: () => [],
    tracks: overrides.tracks ?? [track],
    view: () => ({
      now: Date.UTC(2026, 7, 19, 12, 0, 0),
      currentTrack: track,
      recentTracks: [],
    }),
  });

describe('段落生产 · 就绪', () => {
  it('LLM 与 TTS 成功时产出可播出的段落', async () => {
    const producer = producerOf();

    const produced = await producer.produce({ id: 'seg-1', kind: 'interlude' });

    expect(produced).toEqual({
      id: 'seg-1',
      kind: 'interlude',
      text: '今晚风很轻。',
      audioPath: '/tmp/seg.mp3',
      durationMs: 4200,
      cached: false,
      songTrackId: null,
    });
  });
});

describe('段落生产 · 沉默保底', () => {
  it('LLM 失败时放弃该段落，不抛错', async () => {
    const producer = producerOf({
      llm: {
        generateSegment: async () => {
          throw new Error('LLM HTTP 500');
        },
        extractMemories: async () => [],
      },
    });

    await expect(producer.produce({ id: 'seg-fail', kind: 'interlude' })).resolves.toBeNull();
  });

  it('TTS 失败时放弃该段落，不抛错', async () => {
    const producer = producerOf({
      tts: {
        synthesize: async () => {
          throw new Error('tts spawn failed');
        },
      },
    });

    await expect(producer.produce({ id: 'seg-tts', kind: 'station_id' })).resolves.toBeNull();
  });
});

describe('段落生产 · 点歌匹配', () => {
  it('reply 命中曲库标题时带上 songTrackId', async () => {
    const producer = producerOf({
      llm: {
        generateSegment: async () => ({
          text: '好，等这首完了就放。',
          songRequest: { query: '月光小径' },
        }),
        extractMemories: async () => [],
      },
    });

    const produced = await producer.produce({
      id: 'seg-reply',
      kind: 'reply',
      replyTo: [{ id: 'm1', body: '能放月光小径吗' }],
    });

    expect(produced?.songTrackId).toBe('t-moon');
    expect(produced?.text).toBe('好，等这首完了就放。');
  });

  it('曲库未命中时 songTrackId 为空（婉拒由文案带出）', async () => {
    const producer = producerOf({
      llm: {
        generateSegment: async () => ({
          text: '这首库里没有，今晚换一种味道。',
          songRequest: { query: '不存在的歌' },
        }),
        extractMemories: async () => [],
      },
    });

    const produced = await producer.produce({
      id: 'seg-miss',
      kind: 'reply',
      replyTo: [{ id: 'm2', body: '放不存在的歌' }],
    });

    expect(produced?.songTrackId).toBeNull();
    expect(produced?.text).toContain('库里没有');
  });
});
