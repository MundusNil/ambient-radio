/**
 * L1 节目记忆：检索打分与选择（技术设计 §4.4，FR-075 分层遗忘）。
 * 打分 = importance × 时间衰减 × 最近引用加权；
 * 纯逻辑零 IO：记忆数据与时钟由调用方传入。
 */
import type { MemoryExtraction } from './llm';
import type { MemoryKind } from './types';

export interface MemoryConfig {
  /** 上下文最多带入的 L1 记忆条数 */
  retrievalLimit: number;
  /** 基础衰减半衰期（天）；importance 越高衰减慢（halfLife = base × importance²） */
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
  // importance 越高半衰越长：halfLife = base × importance²（0.2 → 快速淡出，0.9 → 长期保留）
  const halfLifeDays = config.decayHalfLifeDays * Math.max(0.1, m.importance) ** 2;
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

export interface ProgrammeMemory {
  retrieve(now: number): MemoryRecordL1[];
  ingest(extracts: MemoryExtraction[], now: number): void;
}

function memoryKey(kind: string, text: string): string {
  return `${kind}\n${text.trim().replace(/\s+/g, ' ')}`;
}

export function createProgrammeMemory(options: {
  config: MemoryConfig;
  list: () => MemoryRecordL1[];
  touch: (id: string, at: number) => void;
  insert: (rows: MemoryRecordL1[]) => void;
  nextId: () => string;
}): ProgrammeMemory {
  return {
    retrieve(now: number): MemoryRecordL1[] {
      // 注入 ≠ 引用。检索时 touch 会让 recency 自我加分，一次性闲聊会被反复捞出。
      return selectTopMemories(options.list(), now, options.config);
    },
    ingest(extracts: MemoryExtraction[], now: number): void {
      if (extracts.length === 0) return;
      const seen = new Set(
        options
          .list()
          .filter((m) => m.status === 'active')
          .map((m) => memoryKey(m.kind, m.text)),
      );
      const rows: MemoryRecordL1[] = [];
      for (const m of extracts) {
        const key = memoryKey(m.kind, m.text);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          id: options.nextId(),
          kind: m.kind,
          text: m.text,
          importance: m.importance,
          createdAt: now,
          lastUsedAt: null,
          status: 'active',
        });
      }
      if (rows.length > 0) options.insert(rows);
    },
  };
}

/** P3 记忆提取：策展规则（FR-080~085）。Skip 列表对齐 Hermes：不记一次性闲聊/氛围布景。 */
export const MEMORY_EXTRACTION_SYSTEM = `你是电台节目的记忆策展人。阅读下面这段主播播报，判断是否有值得长期保留的节目事实。

只记录与节目连续性有关的（满足任一即可记）：
- topic：听众追问过、或主播明确说「下次再聊」的可延续话题
- promise：主播做出的承诺或未完成的话题（如「明天晚上这个点」「下次放那首」）
- meme：已经反复出现、听众也接得住的节目内部梗
- event：重要的节目事件（点歌受理、特别的互动）

不要记录（即使主播说了很多遍）：
- 一次性氛围布景：吧台、便利店、车站、橘猫、空座位、像素小物件等。那是当下开口的闲聊，不是节目栏目。
- 对刚播过的口播内容的复述或摘要
- 可以联网再搜到的作品设定、曲目介绍
- 没有未完约定、听众没追问的轻松话题

硬性规则：
- 只输出 JSON：{"memories": [{"kind": "topic|promise|meme|event", "text": "一句话", "importance": 0~1}]}
- 没有值得记的就输出 {"memories": []}
- 绝对禁止：用户名、听众身份信息、原句引用、个人生活细节（FR-082）
- 绝对禁止：编造未播出的事实（FR-074）
- 最多 3 条；text 用一句中立、匿名的节目事实描述`;

/** 解析记忆提取；失败/无内容 → 空数组（策展：宁可漏记不可乱记） */
export function parseMemoryExtraction(raw: string): MemoryExtraction[] {
  try {
    const parsed = JSON.parse(raw.trim()) as {
      memories?: Array<{ kind?: string; text?: string; importance?: number }>;
    };
    if (!Array.isArray(parsed.memories)) return [];
    return parsed.memories
      .filter(
        (m): m is { kind: MemoryExtraction['kind']; text: string; importance?: number } =>
          typeof m.text === 'string' &&
          m.text.trim().length > 0 &&
          (m.kind === 'topic' || m.kind === 'promise' || m.kind === 'meme' || m.kind === 'event'),
      )
      .map((m) => ({
        kind: m.kind,
        text: m.text.trim(),
        importance: Math.min(1, Math.max(0, typeof m.importance === 'number' ? m.importance : 0.5)),
      }));
  } catch {
    return [];
  }
}
