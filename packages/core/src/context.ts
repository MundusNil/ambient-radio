/**
 * 上下文构建器（技术设计 §4.3）：把人格 + 时间 + 曲目 + 段落意图组装成 LLM prompt。
 * Aitune 六要素砍一留五：无 User Profile（D1/D2）。
 * 纯逻辑零 IO：persona 内容由调用方传入（组装层读文件）。
 */
import type { DayPartContext } from './time';
import type { SegmentKind } from './types';

export interface TrackBrief {
  title: string;
  artist: string | null;
  styles: string[];
}

export interface SegmentPromptContext {
  kind: SegmentKind;
  /** persona.md 全文（L0 层，维护者所有） */
  persona: string;
  stationName: string;
  hostName: string;
  dayPart: DayPartContext;
  currentTrack: TrackBrief | null;
  recentTracks: TrackBrief[];
}

export interface SegmentPrompt {
  system: string;
  user: string;
}

/** 各段落类型的文案长度约束（对应 FR-032/033；语速舒缓约 4 字/秒） */
const KIND_BRIEF: Record<SegmentKind, string> = {
  station_id:
    '台呼：非个人化的电台识别，15~35 字。带出电台名即可；不得点名、欢迎或识别当前听众，不说「欢迎回来」这类措辞。',
  interlude:
    '常规串场：40~90 字。围绕正在放的音乐、时段氛围或你自己的观察随口聊聊，轻松自然，不逐首报幕。',
  topic: '小主题：200~450 字。围绕一个今晚的小话题慢慢展开，像深夜电台主播那样有开头、有收尾。',
  reply: '回应听众留言：40~120 字。合并理解相关内容再回应；用泛称指代听众，不点名；不确定的不接。',
  request_ack: '点歌回应：25~60 字。接受、延后或婉拒都可以，语气符合人格；不进入任何「模式」话术。',
};

const SYSTEM_RULES = `你是一台 AI 氛围电台的主播，正在进行直播。以下是你的人格档案，必须严格遵守：

<persona>
{PERSONA}
</persona>

【直播输出规则】
- 你输出的内容会被 TTS 转成语音直接播出。只输出要说的内容本身：不要前缀、标题、引号、括号注释、舞台指示或任何解释。
- 普通话口语，语速舒缓，句子偏短，善用标点制造停顿。
- 音乐是节目主体，你只是轻轻开口的主持，不抢戏。
- 只谈论上下文里真实存在的过去；不确定的歌曲背景、作者经历或现实事件，宁可不提。
- 不编造任何没有发生过的节目事件或与听众的共同经历。`;

export function buildSegmentPrompt(ctx: SegmentPromptContext): SegmentPrompt {
  const system = SYSTEM_RULES.replace('{PERSONA}', ctx.persona.trim());

  const lines: string[] = [];
  lines.push(`现在是${ctx.dayPart.weekdayZh}${ctx.dayPart.label}，${ctx.dayPart.moodHint}。`);
  if (ctx.currentTrack) {
    const artist = ctx.currentTrack.artist ? `，${ctx.currentTrack.artist}` : '';
    lines.push(
      `电台正在播放《${ctx.currentTrack.title}》${artist}（${ctx.currentTrack.styles.join('/')}）。`,
    );
  } else {
    lines.push('电台刚好处在换曲的间隙。');
  }
  if (ctx.recentTracks.length > 0) {
    const recent = ctx.recentTracks
      .slice(0, 3)
      .map((t) => `《${t.title}》`)
      .join('');
    lines.push(`这之前播过${recent}。`);
  }
  lines.push('');
  lines.push(`请播一段「${ctx.hostName}的${ctx.stationName}」节目内容——${KIND_BRIEF[ctx.kind]}`);

  return { system, user: lines.join('\n') };
}
