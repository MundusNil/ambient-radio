/**
 * L1 节目记忆：检索打分与选择（技术设计 §4.4，FR-075 分层遗忘）。
 * 打分 = importance × 时间衰减 × 最近引用加权；
 * 纯逻辑零 IO：记忆数据与时钟由调用方传入。
 */
import type { MemoryKind } from './types';

export interface MemoryConfig {
  /** 上下文最多带入的 L1 记忆条数 */
  retrievalLimit: number;
  /** 基础衰减半衰期（天）；importance 越高衰减慢（halfLife = base / importance） */
  decayHalfLifeDays: number;
  /** 最近引用加权的半衰期（天）；越近引用分越高 */
  recencyBoostHalfLifeDays: number;
  /** 低于此分不入选 */
  minScore: number;
}

export interface MemoryRecordL1 {
  id: string;
  kind: MemoryKind;
  text: string;
  importance: number;
  createdAt: number;
  lastUsedAt: number | null;
  status: 'active' | 'archived' | 'deleted';
}

const DAY_MS = 86_400_000;

export function memoryScore(m: MemoryRecordL1, now: number, config: MemoryConfig): number {
  const ageDays = (now - m.createdAt) / DAY_MS;
  // importance 越高半衰越长：halfLife = base × importance（0.2 → 衰减快，0.9 → 慢）
  const halfLifeDays = config.decayHalfLifeDays * Math.max(0.1, m.importance);
  const decay = 2 ** (-ageDays / halfLifeDays);
  let score = m.importance * decay;
  if (m.lastUsedAt !== null) {
    const sinceUseDays = (now - m.lastUsedAt) / DAY_MS;
    const boost = 2 ** (-sinceUseDays / config.recencyBoostHalfLifeDays);
    score *= 1 + boost; // 最近引用过 → 最高 ×2
  }
  return score;
}

/** 从记忆中选出本次上下文要带出的 top-N（只选 active） */
export function selectTopMemories(
  memories: MemoryRecordL1[],
  now: number,
  config: MemoryConfig,
): MemoryRecordL1[] {
  return memories
    .filter((m) => m.status === 'active' && m.text.length > 0)
    .map((m) => ({ memory: m, score: memoryScore(m, now, config) }))
    .filter((x) => x.score >= config.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.retrievalLimit)
    .map((x) => x.memory);
}
