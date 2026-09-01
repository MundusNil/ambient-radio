import { describe, expect, it } from 'vitest';
import { matchSongRequest } from './request';
import type { Track } from './types';

const T = (id: string, title: string, styles: string[] = ['cafe']): Track => ({
  id,
  path: `${id}.mp3`,
  title,
  artist: null,
  durationMs: 240_000,
  styles,
  enabled: true,
  addedAt: 0,
});

const library = [
  T('t-moon', '月光小径', ['cafe']),
  T('t-220', '220暖色调', ['night-quiet']),
  T('t-bgm', 'Hopes and Dreams', ['game-bgm']),
];

describe('点歌受理 · 匹配曲库', () => {
  it('精确标题命中（忽略大小写）', () => {
    expect(matchSongRequest(library, '月光小径')?.id).toBe('t-moon');
    expect(matchSongRequest(library, '月光小径 ')?.id).toBe('t-moon');
  });

  it('按 token 命中标题片段', () => {
    expect(matchSongRequest(library, '220')?.id).toBe('t-220');
    expect(matchSongRequest(library, 'Hopes')?.id).toBe('t-bgm');
  });

  it('标题未命中时按子风格名匹配', () => {
    expect(matchSongRequest(library, '来一首 cafe')?.id).toBe('t-moon');
  });

  it('空 query 或未命中返回 null（婉拒）', () => {
    expect(matchSongRequest(library, '   ')).toBeNull();
    expect(matchSongRequest(library, '不存在的歌')).toBeNull();
  });
});
