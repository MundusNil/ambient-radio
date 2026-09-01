/** OpenAI 兼容 LLM 客户端（D7：DeepSeek / Qwen / GLM / Kimi 通吃，换供应商=改配置） */
import type { LlmClient, MemoryExtraction, SegmentDraft, SegmentPrompt } from '@ambient-radio/core';
import { MEMORY_EXTRACTION_SYSTEM, parseMemoryExtraction } from '@ambient-radio/core';

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
  /** 网络失败时的重试次数 */
  retries?: number;
}

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
        { role: 'system' as const, content: MEMORY_EXTRACTION_SYSTEM },
        { role: 'user' as const, content: segmentText.slice(0, 2000) },
      ];
      try {
        const text = await chatOnce(messages);
        return parseMemoryExtraction(text);
      } catch {
        // 提取失败不阻塞节目（策展失败 = 本次不记，安全）
        return [];
      }
    },
  };
}
