/**
 * 时钟适配器：core 的时间注入在这里落地。
 * 单元测试注入假时钟；生产组装注入 systemClock。
 */
export interface Clock {
  /** epoch ms */
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};
