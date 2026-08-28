/**
 * 收音机音频引擎（Web Audio）：
 * 音乐轨常驻 + ducking 增益层（语音轨接入后由 duck() 驱动）。
 * 「调频进入」：按服务器时间戳直接 seek 进正在进行的节目（D5）。
 */

const BUFFER_CACHE_LIMIT = 10;

export class RadioAudio {
  private ctx: AudioContext | null = null;
  /** 用户总音量（FR-001：唯一的音量控制） */
  private volumeGain: GainNode | null = null;
  /** ducking 层：主播说话时压低、说完恢复（FR-043/044；参数来自 /api/config） */
  private duckGain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** 语音轨 source（独立于音乐轨；播完自动 unduck，FR-044） */
  private speechSource: AudioBufferSourceNode | null = null;
  private currentKey = '';
  private volume = 0.8;
  private bufferCache = new Map<string, AudioBuffer>();
  private ducking = { speechGain: 0.22, attackTauMs: 250, releaseDelayMs: 1200, releaseTauMs: 600 };
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  /** ER-004：曲目解码失败回调（App 层上报电台） */
  onTrackFailed: ((trackId: string) => void) | null = null;

  /** 必须在用户手势中调用（浏览器自动播放策略）；「开台」按钮即手势 */
  async unlock(ducking?: {
    speechGain: number;
    attackTauMs: number;
    releaseDelayMs: number;
    releaseTauMs: number;
  }): Promise<void> {
    if (ducking) this.ducking = ducking;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.duckGain = this.ctx.createGain();
      this.volumeGain = this.ctx.createGain();
      this.duckGain.connect(this.volumeGain);
      this.volumeGain.connect(this.ctx.destination);
      this.volumeGain.gain.value = this.volume;
    }
    await this.ctx.resume();
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /** 播放（或切到）指定曲目；startedAt 为服务器时间戳 */
  async play(trackId: string, startedAt: number, clockOffsetMs: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !trackId) return;
    const key = `${trackId}:${startedAt}`;
    if (key === this.currentKey) return;

    const buffer = await this.loadBuffer(trackId).catch(() => null);
    if (!buffer) {
      // ER-004：解码失败（文件损坏）→ 上报电台跳过该曲
      this.onTrackFailed?.(trackId);
      return;
    }
    // 加载期间被关台：丢弃
    if (!this.ctx || !this.duckGain) return;

    this.stopCurrent();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.duckGain);
    // 服务器时间对齐：本地时钟 + offset = 服务器时刻
    const positionMs = Date.now() + clockOffsetMs - startedAt;
    const offsetSec = Math.min(Math.max(0, positionMs / 1000), Math.max(0, buffer.duration - 0.5));
    src.start(this.ctx.currentTime + 0.08, offsetSec);
    this.source = src;
    this.currentKey = key;
  }

  /** 播放梦可的语音段：音乐压低，语音播完平滑恢复（FR-043/044） */
  async playSpeech(segmentId: string): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.volumeGain) return;
    try {
      const res = await fetch(`/audio/segment/${segmentId}`);
      if (!res.ok) return;
      const raw = await res.arrayBuffer();
      if (!this.ctx) return;
      const buffer = await this.ctx.decodeAudioData(raw);
      if (!this.ctx || !this.volumeGain) return;

      this.stopSpeech();
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      // 语音直连总音量（不经过 duckGain——它自己是压低音乐的那一方）
      src.connect(this.volumeGain);
      src.onended = () => {
        this.speechSource = null;
        this.unduck();
      };
      src.start();
      this.speechSource = src;
      this.duck();
    } catch {
      // 语音加载失败：音乐照常，不中断（沉默保底哲学）
    }
  }

  private stopSpeech(): void {
    if (this.speechSource) {
      try {
        this.speechSource.onended = null;
        this.speechSource.stop();
      } catch {
        // 已停止
      }
      this.speechSource.disconnect();
      this.speechSource = null;
    }
  }

  /** 主播开始说话：音乐平滑压低（FR-043） */
  duck(): void {
    const ctx = this.ctx;
    if (!ctx || !this.duckGain) return;
    if (this.releaseTimer !== null) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    const { speechGain, attackTauMs } = this.ducking;
    this.duckGain.gain.setTargetAtTime(speechGain, ctx.currentTime, attackTauMs / 1000);
  }

  /** 主播说完：延迟后平滑恢复（FR-044） */
  unduck(): void {
    const ctx = this.ctx;
    if (!ctx || !this.duckGain) return;
    const { releaseDelayMs, releaseTauMs } = this.ducking;
    this.releaseTimer = setTimeout(() => {
      if (this.ctx && this.duckGain) {
        this.duckGain.gain.setTargetAtTime(1, this.ctx.currentTime, releaseTauMs / 1000);
      }
    }, releaseDelayMs);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && this.volumeGain) {
      this.volumeGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }

  suspend(): void {
    void this.ctx?.suspend();
    this.stopCurrent();
  }

  private stopCurrent(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // 已停止
      }
      this.source.disconnect();
      this.source = null;
    }
    this.currentKey = '';
  }

  private async loadBuffer(trackId: string): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(trackId);
    if (cached) return cached;
    const res = await fetch(`/audio/track/${trackId}`);
    if (!res.ok) throw new Error(`/audio/track/${trackId} ${res.status}`);
    const raw = await res.arrayBuffer();
    const ctx = this.ctx;
    if (!ctx) throw new Error('audio context closed');
    const buffer = await ctx.decodeAudioData(raw);
    this.bufferCache.set(trackId, buffer);
    if (this.bufferCache.size > BUFFER_CACHE_LIMIT) {
      const oldest = this.bufferCache.keys().next().value;
      if (oldest !== undefined) this.bufferCache.delete(oldest);
    }
    return buffer;
  }
}
