/** 行为参数：station.config.json 的 TS 镜像（调电台=改配置，不改代码） */

import type { MemoryConfig } from './memory';
import type { DayPart } from './time';
import type { SubStyle } from './types';

export interface SchedulerConfig {
  /** FR-018：30 分钟滑窗内同曲不出现；曲库不足时放宽并标记 */
  noRepeatWindowMs: number;
  /** 子风格基础权重（文件夹名 → 权重） */
  styleBaseWeights: Record<SubStyle, number>;
  /** FR-020：时段 × 子风格修正（深夜偏安静、白天偏明亮） */
  timeOfDayBoost: Partial<Record<DayPart, Record<SubStyle, number>>>;
  /** FR-019：距上次播放每过 N 首歌，惩罚减半 */
  recencyPenaltyHalfLifePlays: number;
}

export interface EngineConfig {
  /** FR-031：主动串场间隔采样区间（8~12 次/小时） */
  talkIntervalMs: [number, number];
  /** 相邻两段之间的最小间隔（保护性下限） */
  minTalkGapMs: number;
  /** FR-055：留言 prefer 时限——到期后在自然节点优先回应 */
  preferReplyMs: number;
  /** FR-055/ER-007：留言 force 时限——到期后放宽节点尽快回应（故障期由组装层暂停） */
  forceReplyMs: number;
  /** FR-033：小主题冷却 */
  topicCooldownMs: number;
  /** 冷却结束后，本次串场升级为小主题的概率 */
  topicChance: number;
  nodeWindow: {
    /** 开口的自然节点：距曲目开头至少这么久（前奏保护） */
    minIntoTrackMs: number;
    /** 距曲目结尾这么久之后就不再开口（留给边界） */
    minBeforeTrackEndMs: number;
  };
  /** D5：无人在听时是否照常开口（默认 false：空房间沉默） */
  speakWhenAlone: boolean;
  /** 段落生成超时：组装层无响应则静默丢弃，节奏照常（ER 哲学：故障不卡死节目） */
  pendingTimeoutMs: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  noRepeatWindowMs: 30 * 60 * 1000,
  styleBaseWeights: {
    'game-bgm': 1.0,
    cafe: 1.0,
    'vocal-soft': 0.6,
    'night-quiet': 0.8,
  },
  timeOfDayBoost: {
    deepNight: { 'night-quiet': 1.8, 'vocal-soft': 1.2 },
    morning: { cafe: 1.3 },
    afternoon: { 'game-bgm': 1.2 },
    evening: {},
    lateNight: { 'night-quiet': 1.5 },
  },
  recencyPenaltyHalfLifePlays: 8,
};

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  talkIntervalMs: [150 * 1000, 240 * 1000],
  minTalkGapMs: 90 * 1000,
  preferReplyMs: 20 * 1000,
  forceReplyMs: 45 * 1000,
  topicCooldownMs: 40 * 60 * 1000,
  topicChance: 0.15,
  nodeWindow: {
    minIntoTrackMs: 20 * 1000,
    minBeforeTrackEndMs: 10 * 1000,
  },
  speakWhenAlone: false,
  pendingTimeoutMs: 120_000,
};
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  retrievalLimit: 3,
  decayHalfLifeDays: 7,
  recencyBoostHalfLifeDays: 0.5,
  minScore: 0.45,
};
