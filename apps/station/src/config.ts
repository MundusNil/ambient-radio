/** 配置加载：station.config.json → 类型化配置（默认值兜底；调电台=改配置，D 决策） */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineConfig, SchedulerConfig } from '@ambient-radio/core';
import { DEFAULT_ENGINE_CONFIG, DEFAULT_SCHEDULER_CONFIG } from '@ambient-radio/core';
import { findRepoRoot } from './paths';

interface RawJson {
  station?: { name?: string; host?: string; port?: number };
  engine?: Partial<EngineConfig> & { nodeWindow?: Partial<EngineConfig['nodeWindow']> };
  scheduler?: Partial<SchedulerConfig>;
  audio?: { ducking?: Partial<DuckingConfig> };
  llm?: Partial<LlmConfig>;
  tts?: Partial<TtsConfig>;
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

export interface TtsConfig {
  provider: string;
  voice: string;
  rate: string;
  postProcess: string;
  cacheDir: string;
}

export interface StationRuntimeConfig {
  station: { name: string; host: string; port: number };
  engine: EngineConfig;
  scheduler: SchedulerConfig;
  audio: { ducking: DuckingConfig };
  llm: LlmConfig;
  tts: TtsConfig;
  messages: { retentionDays: number };
  library: { root: string };
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
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: '-10%',
      postProcess: 'loudnorm',
      cacheDir: '.cache/tts',
      ...raw.tts,
    },
    messages: { retentionDays: 7, ...raw.messages },
    library: { root: 'config/library', ...raw.library },
  };
}
