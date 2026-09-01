import { describe, expect, it } from 'vitest';
import type { StationState } from './index';
import { planTuneIn } from './index';

const base: StationState = {
  trackId: 't-moon',
  title: '月光小径',
  startedAt: 1_000,
  durationMs: 240_000,
  positionMs: 30_000,
  hostTalking: false,
  hostSegmentId: null,
  serverTime: 31_000,
};

describe('调频进入 · 公共时间线快照', () => {
  it('主播正在说话时带上进行中的段落', () => {
    const plan = planTuneIn({
      ...base,
      hostTalking: true,
      hostSegmentId: 'seg-1',
    });
    expect(plan).toEqual({
      trackId: 't-moon',
      startedAt: 1_000,
      speechSegmentId: 'seg-1',
    });
  });

  it('主播沉默时只对齐音乐', () => {
    expect(planTuneIn(base).speechSegmentId).toBeNull();
    expect(planTuneIn(base).trackId).toBe('t-moon');
  });
});
