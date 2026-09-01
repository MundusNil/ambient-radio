import { describe, expect, it } from 'vitest';
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
    speechExamples: '',
    retrieveRecentSpeech: () => [],
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

describe('段落生产 · 逐句韵律', () => {
  it('把韵律行交给 TTS，完整文本用于入库与记忆', async () => {
    const seen: unknown[] = [];
    const producer = producerOf({
      llm: {
        generateSegment: async () => ({
          text: '刚下班吧。先别急着找遥控器。',
          lines: [
            { text: '刚下班吧。', speed: 1.1, emotion: 'happy', pauseAfterSec: 0.6 },
            { text: '先别急着找遥控器。', speed: 1.1, emotion: 'happy' },
          ],
          songRequest: null,
        }),
        extractMemories: async () => [],
      },
      tts: {
        synthesize: async (input) => {
          seen.push(input);
          return { filePath: '/tmp/seg.mp3', durationMs: 9000, cached: false };
        },
      },
    });

    const produced = await producer.produce({ id: 'seg-prosody', kind: 'interlude' });

    expect(seen[0]).toEqual([
      { text: '刚下班吧。', speed: 1.1, emotion: 'happy', pauseAfterSec: 0.6 },
      { text: '先别急着找遥控器。', speed: 1.1, emotion: 'happy' },
    ]);
    expect(produced?.text).toBe('刚下班吧。先别急着找遥控器。');
    expect(produced?.durationMs).toBe(9000);
  });

  it('模型没给韵律行时退回整段文本', async () => {
    const seen: unknown[] = [];
    const producer = producerOf({
      tts: {
        synthesize: async (input) => {
          seen.push(input);
          return { filePath: '/tmp/seg.mp3', durationMs: 3000, cached: false };
        },
      },
    });

    await producer.produce({ id: 'seg-plain', kind: 'interlude' });

    expect(seen[0]).toBe('今晚风很轻。');
  });

  it('超过字数硬上限时整句丢弃，不切半句', async () => {
    const producer = createSegmentProducer({
      llm: {
        generateSegment: async () => ({
          text: '一二三四五。六七八九十。十一十二十三。',
          lines: [{ text: '一二三四五。' }, { text: '六七八九十。' }, { text: '十一十二十三。' }],
          songRequest: null,
        }),
        extractMemories: async () => [],
      },
      tts: ttsOk,
      persona: PERSONA,
      stationName: '梦可电台',
      hostName: '梦可',
      speechExamples: '',
      retrieveRecentSpeech: () => [],
      retrieveMemories: () => [],
      tracks: [track],
      maxSegmentChars: 12,
      view: () => ({
        now: Date.UTC(2026, 7, 19, 12, 0, 0),
        currentTrack: track,
        recentTracks: [],
      }),
    });

    const produced = await producer.produce({ id: 'seg-cap', kind: 'topic' });

    expect(produced?.text).toBe('一二三四五。六七八九十。');
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

describe('段落生产 · 对话史', () => {
  it('把近期口播传进 prompt', async () => {
    let seenUser = '';
    const producer = createSegmentProducer({
      llm: {
        generateSegment: async (prompt) => {
          seenUser = prompt.user;
          return { text: '今晚风很轻。', songRequest: null };
        },
        extractMemories: async () => [],
      },
      tts: ttsOk,
      persona: PERSONA,
      stationName: '梦可电台',
      hostName: '梦可',
      speechExamples: 'Last Call 这名字也太直白了。',
      retrieveMemories: () => [],
      retrieveRecentSpeech: () => ['Last Call 这名字也太直白了。'],
      tracks: [track],
      view: () => ({
        now: Date.UTC(2026, 7, 19, 12, 0, 0),
        currentTrack: { ...track, styles: ['va11halla'] },
        recentTracks: [],
      }),
    });

    await producer.produce({ id: 'seg-1', kind: 'interlude' });

    expect(seenUser).toContain('Last Call 这名字也太直白了。');
  });
});
