/**
 * 上下文构建器（技术设计 §4.3）：把人格 + 时间 + 曲目 + 段落意图组装成 LLM prompt。
 * Aitune 六要素砍一留五：无 User Profile（D1/D2）。
 * 纯逻辑零 IO：persona 内容由调用方传入（组装层读文件）。
 */

import type { InterludeConfig } from './config';
import type { DayPartContext } from './time';
import type { MemoryKind, SegmentKind } from './types';

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
  /** kind=reply：本次要回应的留言（合并多条，FR-054） */
  replyTo?: Array<{ id: string; body: string }>;
  /** kind=request_ack：被受理点歌的曲名 */
  ackTitle?: string;
  /** L1 节目记忆（P3，FR-071/072：基于真实节目经历延续话题） */
  memories?: Array<{ kind: MemoryKind; text: string; importance: number }>;
  /** 串场起头配置（调电台=改配置）；缺省用内置默认 */
  interlude?: InterludeConfig;
  /** 0~1 选择起头角度的随机种子（组装层注入 Math.random，保持 core 纯函数、可测） */
  openerSeed?: number;
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
    '常规串场：40~90 字。像朋友间随口闲聊——可从音乐感受、一个轻盈观察、节目记忆或当下氛围起头，轻松自然，不逐首报幕，避免固定套话开场。',
  topic: '小主题：200~450 字。围绕一个今晚的小话题慢慢展开，像深夜电台主播那样有开头、有收尾。',
  reply: '回应听众留言：40~120 字。合并理解相关内容再回应；用泛称指代听众，不点名；不确定的不接。',
  request_ack: '点歌回应：25~60 字。接受、延后或婉拒都可以，语气符合人格；不进入任何「模式」话术。',
};

/** 内置起头种子（当 station.config.json 未提供 interlude.seeds 时兜底） */
const DEFAULT_SEEDS: readonly string[] = [
  '从正在放的音乐的感觉起头：它让你联想到什么画面、气味，或此刻的心情。',
  '说一个轻盈的小观察：窗外的光、杯子里的咖啡、城市深夜的某个声音。',
  '接上节目里的一个小记忆或内部梗，像老听众都懂的那样轻轻一提。',
  '就着刚才播过的某首歌，聊一句你的私人感受，不解说、不报幕。',
  '直接落进此刻的氛围里，几乎不铺垫，像你本来就在自言自语。',
];

const SYSTEM_RULES = `你是一台 AI 氛围电台的主播，正在进行直播。以下是你的人格档案，必须严格遵守：

<persona>
{PERSONA}
</persona>

【直播输出规则】
- 你输出的内容会被 TTS 转成语音直接播出。
- 输出格式：严格的 JSON，只有两个字段：
  {"text": "你要说的话", "songRequest": null}
  - text：要播报的正文。不要任何前缀、标题、引号、舞台指示或解释；普通话口语，语速舒缓，句子偏短，善用标点制造停顿。
  - songRequest：仅当听众留言明显在点歌时，填 {"query": "歌名或风格描述"}；否则固定为 null。
- 音乐是节目主体，你只是轻轻开口的主持，不抢戏。
- 开场千变万化：不要每次都用「现在是周X的…」这种报时式起头。像一个真人深夜电台主播那样随口起头——可以从正在放的音乐、一个轻盈的小观察、节目里的一个小记忆，或直接落进此刻的氛围起头。语气松弛、有温度，偶尔一句轻轻的玩笑或吐槽都可以（像 VA-11 的 Jill 或深夜直播那样自然），但永远不喧宾夺主、不破你温柔克制的人设。
- 只谈论上下文里真实存在的过去；不确定的歌曲背景、作者经历或现实事件，宁可不提。
- 不编造任何没有发生过的节目事件或与听众的共同经历。`;

export function buildSegmentPrompt(ctx: SegmentPromptContext): SegmentPrompt {
  const system = SYSTEM_RULES.replace('{PERSONA}', ctx.persona.trim());

  const lines: string[] = [];
  // 背景提示（给主播参考，不是必须照搬的开场白；FR-036 可参考本地时间但不报时）
  lines.push(
    `时段背景：此刻${ctx.dayPart.weekdayZh}${ctx.dayPart.label}，${ctx.dayPart.moodHint}。`,
  );
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
  if (ctx.replyTo && ctx.replyTo.length > 0) {
    const quoted = ctx.replyTo.map((m) => `「${m.body}」`).join('、');
    lines.push(`收音机前的听众留下了留言：${quoted}`);
  }
  if (ctx.ackTitle) {
    lines.push(`听众点了一首歌：《${ctx.ackTitle}》已受理，即将安排播出。`);
  }
  if (ctx.memories && ctx.memories.length > 0) {
    const remembered = ctx.memories.map((m) => `[${m.kind}] ${m.text}`).join('\n');
    lines.push(`你记得的节目历史（只可引用这些真实发生过的事，禁止编造或扩展）：\n${remembered}`);
  }
  // 起头角度：避免每次都像播报「现在是周X…」
  const seed = typeof ctx.openerSeed === 'number' ? ctx.openerSeed : 0.42;
  const ratio = ctx.interlude?.timeOpenerRatio ?? 0.18;
  const seeds = ctx.interlude?.seeds?.length ? ctx.interlude.seeds : DEFAULT_SEEDS;
  const nonTime: string[] = [...seeds];
  if (ctx.memories && ctx.memories.length > 0) {
    nonTime.push('从一个你记得的节目小事或内部梗起头，像老听众都懂的那样轻轻一提。');
  }
  let opener: string;
  if (seed < ratio) {
    opener =
      '（偶尔才用）像随口瞥了眼窗外那样，用一句带出此刻的时段，然后立刻回到音乐或心情，不要展开成播报。';
  } else {
    const denom = 1 - ratio || 1;
    const idx = Math.floor(((seed - ratio) / denom) * nonTime.length) % nonTime.length;
    // seeds 恒非空（config 为空时回退 DEFAULT_SEEDS），兜底仅为了满足类型收窄
    opener = nonTime[idx] ?? nonTime[0] ?? '';
  }
  lines.push(`起头建议（化成你自己的口语，请勿照搬原文）：${opener}`);
  lines.push('');
  lines.push(`请播一段「${ctx.hostName}的${ctx.stationName}」节目内容——${KIND_BRIEF[ctx.kind]}`);

  return { system, user: lines.join('\n') };
}
