/** 配置加载：station.config.json → 类型化配置（默认值兜底；调电台=改配置，D 决策） */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  EngineConfig,
  InterludeConfig,
  MemoryConfig,
  SchedulerConfig,
} from '@ambient-radio/core';
import {
  DEFAULT_ENGINE_CONFIG,
  DEFAULT_INTERLUDE_CONFIG,
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_SCHEDULER_CONFIG,
} from '@ambient-radio/core';
import { findRepoRoot } from './paths';

interface RawJson {
  station?: { name?: string; host?: string; port?: number };
  engine?: Partial<EngineConfig> & { nodeWindow?: Partial<EngineConfig['nodeWindow']> };
  scheduler?: Partial<SchedulerConfig>;
  interlude?: Partial<InterludeConfig>;
  memory?: Partial<MemoryConfig>;
  audio?: { ducking?: Partial<DuckingConfig> };
  llm?: Partial<LlmConfig>;
  tts?: {
    provider?: 'edge-tts' | 'minimax';
    postProcess?: string;
    cacheDir?: string;
    edge?: Partial<EdgeTtsProviderConfig>;
    minimax?: Partial<MiniMaxTtsProviderConfig>;
  };
  messages?: { retentionDays?: number };
  library?: { root?: string };
}

export interface DuckingConfig {
  speechGain: number;
  attackTauMs: number;
  releaseDelayMs: number;
  releaseTauMs: number;
}

export interface LlmConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  temperature: number;
}

/** edge-tts 子配置（免费，D8 默认） */
export interface EdgeTtsProviderConfig {
  voice: string;
  /** edge-tts rate，如 "-10%" */
  rate: string;
}

/** minimax 子配置（付费可选，音质更可控） */
export interface MiniMaxTtsProviderConfig {
  /** 系统音色 ID，如 Chinese_wenrounvxing（温柔女性） */
  voice: string;
  /** 模型，默认 speech-02-hd */
  model: string;
  /** 语速 0.5~2.0 */
  speed: number;
  /** 存放 API key 的环境变量名 */
  apiKeyEnv: string;
  /** 存放 GroupId 的环境变量名 */
  groupIdEnv: string;
}

export interface TtsConfig {
  provider: 'edge-tts' | 'minimax';
  /** 'loudnorm' 或 'none' */
  postProcess: string;
  cacheDir: string;
  edge: EdgeTtsProviderConfig;
  minimax: MiniMaxTtsProviderConfig;
}

export interface StationRuntimeConfig {
  station: { name: string; host: string; port: number };
  engine: EngineConfig;
  scheduler: SchedulerConfig;
  interlude: InterludeConfig;
  audio: { ducking: DuckingConfig };
  llm: LlmConfig;
  tts: TtsConfig;
  messages: { retentionDays: number };
  library: { root: string };
  memory: MemoryConfig;
}

const DEFAULT_DUCKING: DuckingConfig = {
  speechGain: 0.22,
  attackTauMs: 250,
  releaseDelayMs: 1200,
  releaseTauMs: 600,
};

export function loadStationConfig(
  path = join(findRepoRoot(), 'config', 'station.config.json'),
): StationRuntimeConfig {
  const raw: RawJson = JSON.parse(readFileSync(path, 'utf-8'));
  const engine: EngineConfig = {
    ...DEFAULT_ENGINE_CONFIG,
    ...raw.engine,
    nodeWindow: { ...DEFAULT_ENGINE_CONFIG.nodeWindow, ...raw.engine?.nodeWindow },
  };
  const scheduler: SchedulerConfig = {
    ...DEFAULT_SCHEDULER_CONFIG,
    ...raw.scheduler,
    styleBaseWeights: {
      ...DEFAULT_SCHEDULER_CONFIG.styleBaseWeights,
      ...raw.scheduler?.styleBaseWeights,
    },
    timeOfDayBoost: {
      ...DEFAULT_SCHEDULER_CONFIG.timeOfDayBoost,
      ...raw.scheduler?.timeOfDayBoost,
    },
  };
  return {
    station: {
      name: raw.station?.name ?? '梦可电台',
      host: raw.station?.host ?? '梦可',
      port: raw.station?.port ?? 9730,
    },
    engine,
    scheduler,
    interlude: { ...DEFAULT_INTERLUDE_CONFIG, ...raw.interlude },
    audio: {
      ducking: { ...DEFAULT_DUCKING, ...raw.audio?.ducking },
    },
    llm: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      temperature: 0.8,
      ...raw.llm,
    },
    tts: {
      provider: 'edge-tts',
      postProcess: 'loudnorm',
      cacheDir: '.cache/tts',
      ...raw.tts,
      edge: {
        voice: 'zh-CN-XiaoxuanNeural',
        rate: '-10%',
        ...raw.tts?.edge,
      },
      minimax: {
        voice: 'Chinese_wenrounvxing',
        model: 'speech-02-hd',
        speed: 1,
        apiKeyEnv: 'MINIMAX_API_KEY',
        groupIdEnv: 'MINIMAX_GROUP_ID',
        ...raw.tts?.minimax,
      },
    },
    messages: { retentionDays: 7, ...raw.messages },
    library: { root: 'config/library', ...raw.library },
    memory: { ...DEFAULT_MEMORY_CONFIG, ...raw.memory },
  };
}
