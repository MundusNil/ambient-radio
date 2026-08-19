import { describe, expect, it } from 'vitest';
import { getDayPartContext } from './time';

describe('getDayPartContext', () => {
  it('0~5 点为凌晨', () => {
    const ctx = getDayPartContext(new Date(2026, 7, 19, 3, 30));
    expect(ctx.dayPart).toBe('deepNight');
    expect(ctx.label).toBe('凌晨');
  });

  it('5~11 点为清晨与上午', () => {
    const ctx = getDayPartContext(new Date(2026, 7, 19, 8, 0));
    expect(ctx.dayPart).toBe('morning');
  });

  it('11~17 点为下午', () => {
    const ctx = getDayPartContext(new Date(2026, 7, 19, 14, 0));
    expect(ctx.dayPart).toBe('afternoon');
  });

  it('17~22 点为傍晚与晚上', () => {
    const ctx = getDayPartContext(new Date(2026, 7, 19, 20, 0));
    expect(ctx.dayPart).toBe('evening');
  });

  it('22 点后为深夜', () => {
    const ctx = getDayPartContext(new Date(2026, 7, 19, 23, 0));
    expect(ctx.dayPart).toBe('lateNight');
    expect(ctx.moodHint).toContain('低声');
  });

  it('携带星期信息（2026-08-19 为周三）', () => {
    const ctx = getDayPartContext(new Date(2026, 7, 19, 12, 0));
    expect(ctx.weekday).toBe(3);
    expect(ctx.weekdayZh).toBe('周三');
  });
});
