/**
 * 收音机音频引擎（Web Audio）：
 * 音乐轨常驻 + ducking 增益层（语音轨接入后由 duck() 驱动）。
 * 「调频进入」：按服务器时间戳直接 seek 进正在进行的节目（D5）。
 */

const BUFFER_CACHE_LIMIT = 6;

export class RadioAudio {
  private ctx: AudioContext | null = null;
  /** 用户总音量（FR-001：唯一的音量控制） */
  private volumeGain: GainNode | null = null;
  /** ducking 层：主播说话时压低、说完恢复（FR-043/044；参数来自 /api/config） */
  private duckGain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** 音乐轨独立增益：切歌时旧轨淡出、新轨淡入，交叠成平滑过渡（不再硬切） */
  private sourceGain: GainNode | null = null;
  /** 语音轨 source（独立于音乐轨；播完自动 unduck，FR-044） */
  private speechSource: AudioBufferSourceNode | null = null;
  /** 主播音量（设置面板「语音」页；语音轨独立增益，不影响音乐总音量） */
  private speechGainNode: GainNode | null = null;
  private speechVolume = 1;
  private currentKey = '';
  private volume = 0.8;
  /** 换曲竞态防护：只有最新一次 play 调用能真正播出（防止并发解码交错） */
  private playGeneration = 0;
  private bufferCache = new Map<string, AudioBuffer>();
  private ducking = { speechGain: 0.45, attackTauMs: 250, releaseDelayMs: 1200, releaseTauMs: 600 };
  /** 切歌交叠时长（ms）；0 = 硬切。可调，听感在 150~400ms 最顺 */
  private crossfadeMs = 250;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  /** ER-004：曲目解码失败回调（App 层上报电台） */
  onTrackFailed: ((trackId: string) => void) | null = null;

  /** 必须在用户手势中调用（浏览器自动播放策略）；「开台」按钮即手势 */
  async unlock(
    ducking?: {
      speechGain: number;
      attackTauMs: number;
      releaseDelayMs: number;
      releaseTauMs: number;
    },
    crossfadeMs?: number,
  ): Promise<void> {
    if (ducking) this.ducking = ducking;
    if (typeof crossfadeMs === 'number' && crossfadeMs >= 0) this.crossfadeMs = crossfadeMs;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.duckGain = this.ctx.createGain();
      this.volumeGain = this.ctx.createGain();
      this.speechGainNode = this.ctx.createGain();
      this.speechGainNode.gain.value = this.speechVolume;
      this.duckGain.connect(this.volumeGain);
      this.speechGainNode.connect(this.volumeGain);
      this.volumeGain.connect(this.ctx.destination);
      this.volumeGain.gain.value = this.volume;
    }
    await this.ctx.resume();
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /**
   * 播放（或切到）指定曲目；startedAt 为服务器时间戳。
   * @param tuneIn 是否「调频进入」：true=刚开台/重新同步，对齐到正在播放的位置（D5）；
   *               false=收听中切歌，从 0 开始，绝不快进（否则会把下一首开头按事件延迟截掉）。
   */
  async play(
    trackId: string,
    startedAt: number,
    clockOffsetMs: number,
    tuneIn = false,
  ): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !trackId) return;
    const key = `${trackId}:${startedAt}`;
    if (key === this.currentKey) return;
    const generation = ++this.playGeneration;

    const buffer = await this.loadBuffer(trackId).catch(() => null);
    // 解码期间又来了一次换曲：放弃本次（由最新调用接管）
    if (generation !== this.playGeneration) return;
    if (!buffer) {
      // ER-004：解码失败（文件损坏）→ 上报电台跳过该曲
      this.onTrackFailed?.(trackId);
      return;
    }
    // 加载期间被关台：丢弃
    if (!this.ctx || !this.duckGain) return;

    const now = ctx.currentTime;
    const xf = Math.max(0, this.crossfadeMs) / 1000;

    // 新曲目：自带增益节点，先静音再淡入（不接 duckGain 之外的公共点）
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    src.connect(gain);
    gain.connect(this.duckGain);

    // 上一首：交叠淡出后停止（切歌从硬切变成平滑过渡）
    this.fadeOutCurrent(xf, now);

    // 调频进入：对齐到服务器当前播放位置（中途加入电台）。
    // 切歌：从头播，不按事件延迟快进——快进会把下一首开头截掉，听感发秃。
    const positionMs = Date.now() + clockOffsetMs - startedAt;
    const offsetSec = tuneIn
      ? Math.min(Math.max(0, positionMs / 1000), Math.max(0, buffer.duration - 0.5))
      : 0;

    // 淡入与上一首淡出等长，交叠成平滑过渡
    gain.gain.linearRampToValueAtTime(1, now + 0.06 + xf);
    src.start(now + 0.06, offsetSec);
    // 停止后自动断开释放，避免节点堆积
    src.onended = () => {
      try {
        gain.disconnect();
      } catch {
        // 已断开
      }
      try {
        src.disconnect();
      } catch {
        // 已断开
      }
    };

    this.source = src;
    this.sourceGain = gain;
    this.currentKey = key;
  }

  /** 把正在播的旧曲在 xf 秒内淡出并停止（与 new 交叠）；无旧曲则空操作 */
  private fadeOutCurrent(xf: number, now: number): void {
    const oldSrc = this.source;
    const oldGain = this.sourceGain;
    if (!oldSrc || !oldGain) return;
    try {
      // cancelScheduledValues 后从当前值接着淡出（不读 .value 的固有值陷阱）
      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.linearRampToValueAtTime(0, now + xf);
      oldSrc.stop(now + xf + 0.03);
    } catch {
      // 已停止：忽略
    }
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
      // 语音走独立增益（设置面板「主播音量」），再进总音量（不经过 duckGain——它自己是压低音乐的那一方）
      src.connect(this.speechGainNode ?? this.volumeGain);
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

  /** 设置主播音量（0~1）：语音轨增益即时生效；0 时掐掉在播语音 */
  setSpeechVolume(v: number): void {
    this.speechVolume = Math.min(1, Math.max(0, v));
    if (this.ctx && this.speechGainNode) {
      this.speechGainNode.gain.setTargetAtTime(this.speechVolume, this.ctx.currentTime, 0.05);
    }
    if (this.speechVolume === 0) this.stopSpeech();
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
    if (this.sourceGain) {
      try {
        this.sourceGain.disconnect();
      } catch {
        // 已断开
      }
      this.sourceGain = null;
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
    try {
      const buffer = await ctx.decodeAudioData(raw);
      this.cacheBuffer(trackId, buffer);
      return buffer;
    } catch (err) {
      // 解码失败重试一次（瞬时内存/CPU 压力可能造成一次性失败）
      console.warn(
        `[audio] 解码失败（${trackId}），重试：${err instanceof Error ? err.message : String(err)}`,
      );
      await new Promise((r) => setTimeout(r, 400));
      try {
        const buffer = await ctx.decodeAudioData(raw);
        this.cacheBuffer(trackId, buffer);
        return buffer;
      } catch (err2) {
        console.warn(
          `[audio] 解码重试仍失败（${trackId}）：${err2 instanceof Error ? err2.message : String(err2)}`,
        );
        throw err2;
      }
    }
  }

  private cacheBuffer(trackId: string, buffer: AudioBuffer): void {
    this.bufferCache.set(trackId, buffer);
    // 解码后 PCM 体积大（flac 4 分钟 ≈ 40MB）：上限 6 首防内存膨胀
    if (this.bufferCache.size > BUFFER_CACHE_LIMIT) {
      const oldest = this.bufferCache.keys().next().value;
      if (oldest !== undefined) this.bufferCache.delete(oldest);
    }
  }
}
