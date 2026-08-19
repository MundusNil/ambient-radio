/**
 * 时段氛围（FR-020）：本地时间轻微影响子风格权重与主持语气。
 * 纯逻辑、零 IO —— 时钟由调用方注入（Date 对象），可测试。
 */

export type DayPart = 'deepNight' | 'morning' | 'afternoon' | 'evening' | 'lateNight';

export interface DayPartContext {
  hour: number;
  minute: number;
  dayPart: DayPart;
  /** 中文时段名，供上下文构建与日志使用 */
  label: string;
  /** 时段氛围提示词，供上下文构建器 */
  moodHint: string;
  /** 0~6，0 = 周日 */
  weekday: number;
  weekdayZh: string;
}

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function dayPartOf(hour: number): DayPart {
  if (hour < 5) return 'deepNight';
  if (hour < 11) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'lateNight';
}

const DAY_PART_META: Record<DayPart, { label: string; moodHint: string }> = {
  deepNight: { label: '凌晨', moodHint: '极安静，近乎耳语' },
  morning: { label: '清晨与上午', moodHint: '微亮，清透' },
  afternoon: { label: '下午', moodHint: '明亮，松弛' },
  evening: { label: '傍晚与晚上', moodHint: '渐暗，温柔' },
  lateNight: { label: '深夜', moodHint: '安静，低声' },
};

export function getDayPartContext(date: Date): DayPartContext {
  const hour = date.getHours();
  const weekday = date.getDay();
  const meta = DAY_PART_META[dayPartOf(hour)];
  return {
    hour,
    minute: date.getMinutes(),
    dayPart: dayPartOf(hour),
    label: meta.label,
    moodHint: meta.moodHint,
    weekday,
    weekdayZh: WEEKDAY_ZH[weekday] ?? '',
  };
}
