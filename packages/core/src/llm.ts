/** LLM 端口：core 不知道协议细节；实现见 adapters/llm（D7：OpenAI 兼容通吃） */
import type { SegmentPrompt } from './context';

export interface SegmentDraft {
  text: string;
}

export interface LlmClient {
  /** 生成一段播报文案；失败抛错，由组装层决定静默降级（沉默保底） */
  generateSegment(prompt: SegmentPrompt): Promise<SegmentDraft>;
}
