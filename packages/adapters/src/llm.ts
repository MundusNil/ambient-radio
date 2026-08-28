/** OpenAI 兼容 LLM 客户端（D7：DeepSeek / Qwen / GLM / Kimi 通吃，换供应商=改配置） */
import type { LlmClient, MemoryExtraction, SegmentDraft, SegmentPrompt } from '@ambient-radio/core';

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
  /** 网络失败时的重试次数 */
  retries?: number;
}

/** P3 记忆提取的系统提示：策展规则 + 匿名硬约束（FR-080~085） */
const EXTRACTION_SYSTEM = `你是电台节目的记忆策展人。阅读下面这段主播播报，判断是否有值得长期保留的节目事实。

只记录与节目连续性有关的（满足任一即可记）：
- topic：节目谈过的可延续话题（如听众表现出对某类音乐/时段的偏好，且主播回应了）
- promise：主播做出的承诺或未完成的话题（如「明天晚上这个点」「下次放那首」「以后多聊」）
- meme：节目内部梗
- event：重要的节目事件（点歌受理、特别的互动等）

硬性规则：
- 只输出 JSON：{"memories": [{"kind": "topic|promise|meme|event", "text": "一句话", "importance": 0~1}]}
- 没有值得记的就输出 {"memories": []}
- 绝对禁止：用户名、听众身份信息、原句引用、个人生活细节（FR-082）
- 绝对禁止：编造未播出的事实（FR-074）
- 最多 3 条；text 用一句中立、匿名的节目事实描述`;

/** P2 点歌意图的结构化输出契约（LLM 按此格式返回 JSON） */
interface SongRequestJson {
  text: string;
  songRequest?: { query: string } | null;
}

/**
 * 解析 LLM 输出：优先 JSON（结构化点歌意图），
 * 解析失败回退纯文本（文本即回复内容，songRequest 缺省）。
 */
function parseDraft(raw: string): SegmentDraft {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as SongRequestJson;
    if (typeof parsed.text === 'string' && parsed.text.trim().length > 0) {
      return {
        text: parsed.text.trim(),
        songRequest: parsed.songRequest ?? null,
      };
    }
  } catch {
    // 不是 JSON：按纯文本处理
  }
  return { text: trimmed, songRequest: null };
}

/** P3 记忆提取的输出契约：{ memories: [{ kind, text, importance }] } */
interface MemoryExtractionJson {
  memories?: Array<{ kind?: string; text?: string; importance?: number }>;
}

/** 解析记忆提取；失败/无内容 → 空数组（策展：宁可漏记不可乱记） */
function parseExtraction(raw: string): MemoryExtraction[] {
  try {
    const parsed = JSON.parse(raw.trim()) as MemoryExtractionJson;
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

export function createOpenAiCompatibleLlm(options: OpenAiCompatibleOptions): LlmClient {
  const { baseUrl, apiKey, model, temperature = 0.8, timeoutMs = 30_000, retries = 1 } = options;

  async function chatOnce(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
  ): Promise<string> {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: 800,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('LLM 空响应');
    return text;
  }

  return {
    async generateSegment(prompt: SegmentPrompt): Promise<SegmentDraft> {
      const messages = [
        { role: 'system' as const, content: prompt.system },
        { role: 'user' as const, content: prompt.user },
      ];
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const text = await chatOnce(messages);
          return parseDraft(text);
        } catch (err) {
          lastError = err;
          // 只有网络/5xx 类错误值得重试；4xx 不重试
          if (err instanceof Error && /HTTP 4\d\d/.test(err.message)) break;
        }
      }
      throw lastError instanceof Error ? lastError : new Error('LLM 调用失败');
    },

    async extractMemories(segmentText: string): Promise<MemoryExtraction[]> {
      const messages = [
        { role: 'system' as const, content: EXTRACTION_SYSTEM },
        { role: 'user' as const, content: segmentText.slice(0, 2000) },
      ];
      try {
        const text = await chatOnce(messages);
        return parseExtraction(text);
      } catch {
        // 提取失败不阻塞节目（策展失败 = 本次不记，安全）
        return [];
      }
    },
  };
}
