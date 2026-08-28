/** LLM 端口：core 不知道协议细节；实现见 adapters/llm（D7：OpenAI 兼容通吃） */
import type { SegmentPrompt } from './context';

export interface SegmentDraft {
  text: string;
  /** P2 点歌：留言含点歌意图时，LLM 提取的点歌请求（受理与否由组装层匹配曲库后决定） */
  songRequest?: { query: string } | null;
}

export interface LlmClient {
  /** 生成一段播报文案；失败抛错，由组装层决定静默降级（沉默保底） */
  generateSegment(prompt: SegmentPrompt): Promise<SegmentDraft>;
}
