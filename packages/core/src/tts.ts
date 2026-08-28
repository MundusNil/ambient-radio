/** TTS 端口：文案 → 语音文件；实现见 adapters/tts（D8：候选池随时换） */
export interface SynthesizedSpeech {
  filePath: string;
  durationMs: number;
  /** 命中缓存（文本哈希相同） */
  cached: boolean;
}

export interface TtsClient {
  synthesize(text: string): Promise<SynthesizedSpeech>;
}
