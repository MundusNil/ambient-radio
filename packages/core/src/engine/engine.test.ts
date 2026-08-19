import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import type { Track } from '../types';
import { createEngine } from './engine';

const T = (id: string, durationMs = 900_000): Track => ({
  id,
  path: `${id}.mp3`,
  title: id,
  artist: null,
  durationMs,
  styles: ['cafe'],
  enabled: true,
  addedAt: 0,
});

const fixed = (v: number) => () => v;

/** 节奏测试配置：固定 5 分钟间隔、禁 topic、空房间也开口（纯节奏先行） */
const cfg = {
  ...DEFAULT_ENGINE_CONFIG,
  talkIntervalMs: [300_000, 300_000] as [number, number],
  topicChance: 0,
  speakWhenAlone: true,
};

describe('engine · 时间线（D5：音乐时间线永远走）', () => {
  it('无曲目时 tick 静默', () => {
    const e = createEngine({ config: cfg, rng: fixed(0) });
    expect(e.tick(0)).toEqual([]);
  });

  it('曲目播完发出 track-ended，且只发一次', () => {
    const e = createEngine({ config: cfg, rng: fixed(0) });
    e.onTrackStarted(T('a', 60_000), 0);
    expect(e.tick(30_000)).toEqual([]);
    expect(e.tick(60_000)).toEqual([{ type: 'track-ended', trackId: 'a' }]);
    expect(e.tick(61_000)).toEqual([]);
  });
});

/** 固定序列 RNG：依次返回给定值，耗尽后重复最后一个 */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
};

describe('engine · 自然节点窗口（前奏与尾奏保护）', () => {
  it('曲目开头 20 秒内不播出，进入中段后才播', () => {
    const early = { ...cfg, talkIntervalMs: [0, 0] as [number, number] };
    const e = createEngine({ config: early, rng: fixed(0) });
    e.onTrackStarted(T('a', 600_000), 0);
    const [plan] = e.tick(0);
    if (plan?.type !== 'plan-segment') throw new Error('expect plan event');
    e.onSegmentReady(plan.id, 15_000);
    expect(e.tick(5_000)).toEqual([]); // 前奏保护
    expect(e.tick(20_000)).toHaveLength(1); // 进入中段，播出
  });

  it('尾奏保护：曲目结尾 10 秒内不播，等到边界随 track-ended 一起播', () => {
    const ending = { ...cfg, talkIntervalMs: [0, 0] as [number, number] };
    const e = createEngine({ config: ending, rng: fixed(0) });
    e.onTrackStarted(T('a', 60_000), 0);
    const [plan] = e.tick(0);
    if (plan?.type !== 'plan-segment') throw new Error('expect plan event');
    e.onSegmentReady(plan.id, 15_000);
    expect(e.tick(55_000)).toEqual([]); // 55s > 60-10，尾奏保护
    const events = e.tick(60_000);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'track-ended', trackId: 'a' });
    expect(events[1]).toMatchObject({ type: 'play-segment', segmentId: plan.id });
  });
});

describe('engine · 听众感知（D5：空房间沉默）', () => {
  const alone = { ...cfg, talkIntervalMs: [0, 0] as [number, number], speakWhenAlone: false };

  it('无人在场时到期也不开口', () => {
    const e = createEngine({ config: alone, rng: fixed(0) });
    e.onTrackStarted(T('a'), 0);
    expect(e.tick(300_000)).toEqual([]);
  });

  it('听众进入后，下一个自然节点优先播台呼（FR-004/005）', () => {
    const e = createEngine({ config: alone, rng: fixed(0) });
    e.onTrackStarted(T('a'), 0);
    e.onListenersChanged(1);
    const events = e.tick(30_000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'plan-segment', kind: 'station_id' });
  });
});

describe('engine · 故障哲学（ER-001~003）', () => {
  it('生成失败的段落被静默丢弃，节奏照常', () => {
    const e = createEngine({ config: cfg, rng: fixed(0) });
    e.onTrackStarted(T('a'), 0);
    const [plan] = e.tick(300_000);
    if (plan?.type !== 'plan-segment') throw new Error('expect plan event');
    e.onSegmentFailed(plan.id);
    expect(e.tick(310_000)).toEqual([]); // 沉默，不播技术错误
    const again = e.tick(600_000);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ type: 'plan-segment' });
  });

  it('组装层无响应超过 60 秒：静默丢弃挂起段落，节目不卡死', () => {
    const e = createEngine({ config: cfg, rng: fixed(0) });
    e.onTrackStarted(T('a'), 0);
    e.tick(300_000); // plan（不回调 ready/failed，模拟组装层卡死）
    expect(e.tick(340_000)).toEqual([]); // 超时前：等待
    // 300s + 60s = 360s 后丢弃；下一次 due = 600s
    expect(e.tick(361_000)).toEqual([]);
    expect(e.tick(600_000)).toHaveLength(1); // 节奏恢复
  });
});

describe('engine · 最小间隔与 topic 升级', () => {
  it('段落播完后 90 秒内不开新段（minTalkGap）', () => {
    const tight = { ...cfg, talkIntervalMs: [0, 0] as [number, number] };
    const e = createEngine({ config: tight, rng: fixed(0) });
    e.onTrackStarted(T('a'), 0);
    const [plan] = e.tick(0);
    if (plan?.type !== 'plan-segment') throw new Error('expect plan event');
    e.onSegmentReady(plan.id, 15_000);
    e.tick(20_000); // 播出，voice 到 35s
    expect(e.tick(36_000)).toEqual([]); // 35s + 90s 内
    expect(e.tick(125_001)).toHaveLength(1); // gap 已过
  });

  it('冷却期满后有机会升级为 topic，冷却内不升级（FR-033）', () => {
    const topicCfg = {
      ...DEFAULT_ENGINE_CONFIG,
      talkIntervalMs: [300_000, 300_000] as [number, number],
      topicChance: 1, // 必升级
      speakWhenAlone: true,
    };
    // rng 序列：首曲 interval 采样 → topic 判定 → 节奏重采样
    const e = createEngine({ config: topicCfg, rng: seq(0, 0, 0) });
    e.onTrackStarted(T('a'), 0);
    expect(e.tick(300_000)[0]).toMatchObject({ type: 'plan-segment', kind: 'topic' });
    // 冷却未满（40 分钟），第二次仍是 interlude
    expect(e.tick(600_000)[0]).toMatchObject({ type: 'plan-segment', kind: 'interlude' });
  });
});

describe('engine · 串场节奏（FR-031）', () => {
  it('next_talk_due 未到期不规划；到期后规划 interlude（FR-032）', () => {
    const e = createEngine({ config: cfg, rng: fixed(0) });
    e.onTrackStarted(T('a'), 0);
    expect(e.tick(299_000)).toEqual([]);
    const events = e.tick(300_000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'plan-segment', kind: 'interlude' });
  });

  it('段落就绪后在自然节点播出；VOICE 期间静默（FR-043 时段音乐降、不叠新段）', () => {
    const e = createEngine({ config: cfg, rng: fixed(0) });
    e.onTrackStarted(T('a'), 0);
    const [plan] = e.tick(300_000);
    if (plan?.type !== 'plan-segment') throw new Error('expect plan event');
    e.onSegmentReady(plan.id, 15_000);

    const play = e.tick(301_000);
    expect(play).toEqual([
      { type: 'play-segment', segmentId: plan.id, startedAt: 301_000, durationMs: 15_000 },
    ]);

    // VOICE 期间（301s ~ 316s）无任何事件
    expect(e.tick(305_000)).toEqual([]);
    // 段落结束：回到 MUSIC，无事件
    expect(e.tick(316_000)).toEqual([]);
  });

  it('段落播完后，下一次串场在间隔之后（节奏重采样）', () => {
    const e = createEngine({ config: cfg, rng: fixed(0) });
    e.onTrackStarted(T('a'), 0);
    const [plan] = e.tick(300_000);
    if (plan?.type !== 'plan-segment') throw new Error('expect plan event');
    e.onSegmentReady(plan.id, 15_000);
    e.tick(301_000); // play
    // 下一次 plan 应在 plan@300 + 300 = 600s
    expect(e.tick(599_999)).toEqual([]);
    const again = e.tick(600_000);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ type: 'plan-segment', kind: 'interlude' });
  });
});
