/**
 * 语音设置（组装层）：设置面板「语音」页 → 写回 config/station.config.json + 热生效。
 * 铁律 4：调电台 = 改 station.config.json —— 面板只是这份配置的编辑界面，
 * 写盘后重启仍保持；内存里的 runtime config 同步更新，当次进程立即生效。
 *
 * 三项设置：
 *  - enabled      语音功能总开关（关 = 引擎不规划段落，LLM/TTS 零调用零费用，只放歌）
 *  - speechRate   语速基准 0.5~1.5（provider 中立；minimax speed 直接用，edge 换算成 ±%）
 *  - speechVolume 主播音量 0~1（loudnorm 会把各段响度归一，TTS 侧 vol 会被抹平；
 *                 真正的音量控制落在前端语音轨增益，见 apps/web/src/audio.ts）
 *  - cadence      发言频率档位（三档预设 → engine.talkIntervalMs 区间）
 */
import { readFileSync, writeFileSync } from 'node:fs';

export interface VoiceSettings {
  enabled: boolean;
  speechRate: number;
  speechVolume: number;
  cadence: CadenceId;
}

export type CadenceId = 'sparse' | 'gentle' | 'close';

export interface CadencePreset {
  id: CadenceId;
  /** 面板展示名 */
  label: string;
  /** 一句话意境描述（面板副标题） */
  hint: string;
  /** 大致次数/小时（面板展示） */
  perHour: string;
  /** 写入 engine.talkIntervalMs 的采样区间 */
  intervalMs: [number, number];
}

/**
 * 三档发言频率（FR-031 默认档 = gentle）：
 * 留白 → 音乐绝对主角；浅语 → 电台常态；絮语 → 陪伴感最强。
 */
export const CADENCE_PRESETS: readonly CadencePreset[] = [
  {
    id: 'sparse',
    label: '留白',
    hint: '音乐为主，梦可偶尔轻声一句',
    perHour: '约 3~5 次/小时',
    intervalMs: [720_000, 1_200_000],
  },
  {
    id: 'gentle',
    label: '浅语',
    hint: '电台常态，轻轻串场',
    perHour: '约 8~12 次/小时',
    intervalMs: [300_000, 480_000],
  },
  {
    id: 'close',
    label: '絮语',
    hint: '陪伴感更强，话说得勤一些',
    perHour: '约 15~20 次/小时',
    intervalMs: [180_000, 240_000],
  },
];

export function cadenceById(id: string): CadencePreset | undefined {
  return CADENCE_PRESETS.find((p) => p.id === id);
}

/** 由 talkIntervalMs 反查档位；不在预设上则归到最接近的一档（面板显示用） */
export function cadenceOfInterval(intervalMs: [number, number]): CadenceId {
  const mid = (intervalMs[0] + intervalMs[1]) / 2;
  let best: CadenceId = 'gentle';
  let bestDist = Number.POSITIVE_INFINITY;
  for (const p of CADENCE_PRESETS) {
    const pm = (p.intervalMs[0] + p.intervalMs[1]) / 2;
    const dist = Math.abs(pm - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = p.id;
    }
  }
  return best;
}

/** 配置对象里语音相关的形状（StationRuntimeConfig 的结构子集） */
export interface VoiceConfigShape {
  engine: { voiceEnabled: boolean; talkIntervalMs: [number, number] };
  audio: { speechVolume?: number };
  tts: { speechRate: number };
}

export function readVoiceSettings(config: VoiceConfigShape): VoiceSettings {
  return {
    enabled: config.engine.voiceEnabled,
    speechRate: config.tts.speechRate,
    speechVolume: config.audio.speechVolume ?? 1,
    cadence: cadenceOfInterval(config.engine.talkIntervalMs),
  };
}

export interface VoicePatch {
  enabled?: unknown;
  speechRate?: unknown;
  speechVolume?: unknown;
  cadence?: unknown;
}

/** 校验并归一化面板提交；非法值抛错（路由转 400） */
export function validateVoicePatch(patch: VoicePatch): Partial<VoiceSettings> {
  const out: Partial<VoiceSettings> = {};
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
    out.enabled = patch.enabled;
  }
  if (patch.speechRate !== undefined) {
    if (typeof patch.speechRate !== 'number' || !Number.isFinite(patch.speechRate)) {
      throw new Error('speechRate 必须是数字');
    }
    if (patch.speechRate < 0.5 || patch.speechRate > 1.5) {
      throw new Error('speechRate 需在 0.5~1.5 之间');
    }
    out.speechRate = Math.round(patch.speechRate * 100) / 100;
  }
  if (patch.speechVolume !== undefined) {
    if (typeof patch.speechVolume !== 'number' || !Number.isFinite(patch.speechVolume)) {
      throw new Error('speechVolume 必须是数字');
    }
    if (patch.speechVolume < 0 || patch.speechVolume > 1) {
      throw new Error('speechVolume 需在 0~1 之间');
    }
    out.speechVolume = Math.round(patch.speechVolume * 100) / 100;
  }
  if (patch.cadence !== undefined) {
    if (typeof patch.cadence !== 'string' || !cadenceById(patch.cadence)) {
      throw new Error(`未知发言频率档位：${String(patch.cadence)}`);
    }
    out.cadence = patch.cadence as CadenceId;
  }
  if (Object.keys(out).length === 0) throw new Error('没有可应用的语音设置');
  return out;
}

/**
 * 落盘：读 station.config.json → 打补丁 → 原格式写回（2 空格缩进，与手工编辑一致）。
 * 同时把新值写进内存 runtime config（工厂下次调用即读到新值）。
 * 返回应用后的完整设置（面板回显）。
 */
export function applyVoiceSettings(
  configPath: string,
  config: VoiceConfigShape,
  patch: VoicePatch,
): VoiceSettings {
  const valid = validateVoicePatch(patch);
  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as {
    engine?: Record<string, unknown>;
    audio?: Record<string, unknown>;
    tts?: Record<string, unknown>;
  };
  raw.engine ??= {};
  raw.audio ??= {};
  raw.tts ??= {};

  if (valid.enabled !== undefined) {
    raw.engine.voiceEnabled = valid.enabled;
    config.engine.voiceEnabled = valid.enabled;
  }
  if (valid.cadence !== undefined) {
    const preset = cadenceById(valid.cadence) as CadencePreset;
    raw.engine.talkIntervalMs = preset.intervalMs;
    config.engine.talkIntervalMs = [preset.intervalMs[0], preset.intervalMs[1]];
  }
  if (valid.speechRate !== undefined) {
    raw.tts.speechRate = valid.speechRate;
    config.tts.speechRate = valid.speechRate;
  }
  if (valid.speechVolume !== undefined) {
    raw.audio.speechVolume = valid.speechVolume;
    config.audio.speechVolume = valid.speechVolume;
  }

  writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
  return readVoiceSettings(config);
}
