import { describe, expect, it } from 'vitest';
import { type MemoryConfig, type MemoryRecordL1, memoryScore, selectTopMemories } from './memory';

const config: MemoryConfig = {
  retrievalLimit: 3,
  decayHalfLifeDays: 7,
  recencyBoostHalfLifeDays: 1,
  minScore: 0,
};

const M = (overrides: Partial<MemoryRecordL1> & { id: string }): MemoryRecordL1 => ({
  kind: 'topic',
  text: '测试记忆',
  importance: 0.5,
  createdAt: 1_000_000,
  lastUsedAt: null,
  status: 'active',
  ...overrides,
});

const NOW = 10_000_000;

describe('memoryScore（FR-075 分层遗忘）', () => {
  it('importance 高的记忆分高', () => {
    const important = M({ id: 'a', importance: 0.9, createdAt: NOW - 1_000 });
    const ordinary = M({ id: 'b', importance: 0.3, createdAt: NOW - 1_000 });
    expect(memoryScore(important, NOW, config)).toBeGreaterThan(memoryScore(ordinary, NOW, config));
  });

  it('时间衰减：旧记忆分低（普通话题渐淡）', () => {
    const fresh = M({ id: 'a', createdAt: NOW - 1_000 });
    const old = M({ id: 'b', createdAt: NOW - 30 * DAY });
    expect(memoryScore(fresh, NOW, config)).toBeGreaterThan(memoryScore(old, NOW, config));
  });

  it('importance 高者衰减慢（核心事件长期保留）', () => {
    const oldImportant = M({ id: 'a', importance: 0.9, createdAt: NOW - 30 * DAY });
    const oldOrdinary = M({ id: 'b', importance: 0.2, createdAt: NOW - 30 * DAY });
    expect(memoryScore(oldImportant, NOW, config)).toBeGreaterThan(
      memoryScore(oldOrdinary, NOW, config),
    );
  });

  it('最近引用过 → 加权提升', () => {
    const unused = M({ id: 'a', createdAt: NOW - 10 * DAY });
    const reused = M({ id: 'b', createdAt: NOW - 10 * DAY, lastUsedAt: NOW - 60_000 });
    expect(memoryScore(reused, NOW, config)).toBeGreaterThan(memoryScore(unused, NOW, config));
  });
});

describe('selectTopMemories', () => {
  it('返回按分排序的 top-N，跳过 archived/deleted', () => {
    const fresh = M({ id: 'a', createdAt: NOW - 1_000, importance: 0.8 });
    const old = M({ id: 'b', createdAt: NOW - 60 * DAY });
    const archived = M({ id: 'c', createdAt: NOW - 1_000, status: 'archived' });
    const selected = selectTopMemories([old, archived, fresh], NOW, {
      ...config,
      retrievalLimit: 1,
    });
    expect(selected.map((m) => m.id)).toEqual(['a']);
  });

  it('低于 minScore 的记忆不入选（完全淡忘）', () => {
    const faint = M({ id: 'a', importance: 0.1, createdAt: NOW - 60 * DAY });
    const selected = selectTopMemories([faint], NOW, { ...config, minScore: 0.05 });
    expect(selected).toEqual([]);
  });
});

const DAY = 86_400_000;
