import type { Track } from '@ambient-radio/core';
import { describe, expect, it } from 'vitest';
import { createStore } from './store';

const T = (id: string, path: string): Track => ({
  id,
  path,
  title: `曲目-${id}`,
  artist: null,
  durationMs: 240_000,
  styles: ['cafe'],
  enabled: true,
  addedAt: 1_700_000_000_000,
});

describe('store · tracks', () => {
  it('upsert 按 path 幂等，不产生重复行', () => {
    const store = createStore(':memory:');
    store.upsertTracks([T('a', 'cafe/a.mp3'), T('b', 'cafe/b.mp3')]);
    store.upsertTracks([T('a2', 'cafe/a.mp3')]); // 同 path，id 更新
    const tracks = store.listTracks();
    expect(tracks).toHaveLength(2);
    expect(tracks.find((t) => t.path === 'cafe/a.mp3')?.id).toBe('a2');
  });

  it('styles 数组往返完整', () => {
    const store = createStore(':memory:');
    const track: Track = {
      ...T('a', 'cafe/a.mp3'),
      styles: ['cafe', 'night-quiet'],
      artist: '测试歌手',
    };
    store.upsertTracks([track]);
    expect(store.listTracks()[0]).toMatchObject({
      styles: ['cafe', 'night-quiet'],
      artist: '测试歌手',
    });
  });
});

describe('store · plays（时间线重建依据）', () => {
  it('播放开始后 lastUnfinished 可见；结束后消失', () => {
    const store = createStore(':memory:');
    store.upsertTracks([T('a', 'cafe/a.mp3')]);
    const playId = store.startPlay('a', 1_000_000);
    expect(store.getLastUnfinishedPlay()).toEqual({
      id: playId,
      trackId: 'a',
      startedAt: 1_000_000,
    });
    store.endPlay(playId, 1_240_000);
    expect(store.getLastUnfinishedPlay()).toBeNull();
  });

  it('listRecentPlays 按时间过滤（喂回调度器防重复滑窗）', () => {
    const store = createStore(':memory:');
    store.upsertTracks([T('a', 'cafe/a.mp3'), T('b', 'cafe/b.mp3')]);
    const p1 = store.startPlay('a', 1_000_000);
    store.endPlay(p1, 1_240_000);
    const p2 = store.startPlay('b', 1_300_000);
    store.endPlay(p2, 1_500_000);
    const recent = store.listRecentPlays(1_100_000); // 只含 b
    expect(recent).toEqual([{ trackId: 'b', startedAt: 1_300_000 }]);
  });
});

describe('store · segments（节目记录，P3 记忆的基础）', () => {
  it('插入后可读取', () => {
    const store = createStore(':memory:');
    store.insertSegment({
      id: 'seg-1',
      kind: 'interlude',
      text: '你好',
      audioPath: '/tmp/a.mp3',
      durationMs: 5000,
      plannedAt: 1_000_000,
      airedAt: 1_000_500,
      status: 'aired',
    });
    expect(store.listSegments()).toHaveLength(1);
    expect(store.listSegments()[0]).toMatchObject({ kind: 'interlude', text: '你好' });
  });
});
