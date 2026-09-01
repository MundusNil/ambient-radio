/**
 * 上下文构建器（技术设计 §4.3）：把人格 + 时间 + 曲目 + 段落意图组装成 LLM prompt。
 * Aitune 六要素砍一留五：无 User Profile（D1/D2）。
 * 纯逻辑零 IO：persona 内容由调用方传入（组装层读文件）。
 */

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
  /** 近期已出口播，按时间从旧到新 */
  recentSpeech?: string[];
  /** 选中的世界书条目（调用方已筛选） */
  lore?: Array<{ content: string }>;
  /** 口吻样本原文 */
  speechExamples?: string;
}

export interface SegmentPrompt {
  system: string;
  user: string;
}

/** 各段落类型的意图简述（对应 FR-032/033） */
const KIND_BRIEF: Record<SegmentKind, string> = {
  station_id:
    '台呼：非个人化的电台识别，15~35 字。带出电台名即可；不得点名、欢迎或识别当前听众，不说「欢迎回来」这类措辞。',
  interlude: '常规串场。写下一句就好，一句也可以，不必收束或祝福。',
  topic: '小主题：200~450 字。可以展开一个话题，有开头也可以没有正式收尾。',
  reply: '回应听众留言：合并理解相关内容再回应；用泛称指代听众，不点名；不确定的不接。',
  request_ack: '点歌回应：接受、延后或婉拒都可以，语气符合人格；不进入任何「模式」话术。',
};

const SYSTEM_RULES = `你是梦可，一台 AI 氛围电台的主播，正在直播。音乐在响。写你的下一句。

<persona>
{PERSONA}
</persona>

【输出】
- 严格 JSON：{"text":"要说的话","songRequest":null}
- text 会被 TTS 直接播出。不要前缀、标题、舞台指示。普通话口语。
- songRequest 仅当听众留言明显在点歌时填 {"query":"歌名或风格"}，否则 null。
- 世界书里写过的设定可以当事实；没写的不要编成事实。
- 不编造没有发生过的节目，不编「咱们一起过关」，不点名听众。
- 不要重复聊同一个意象或场景（灯、杯子、雨、夜这些用过就换），不背世界书菜单；宁可说半句就停。`;

export function buildSegmentPrompt(ctx: SegmentPromptContext): SegmentPrompt {
  const system = SYSTEM_RULES.replace('{PERSONA}', ctx.persona.trim());

  const lines: string[] = [];
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
  if (ctx.recentSpeech && ctx.recentSpeech.length > 0) {
    const quoted = ctx.recentSpeech.map((s) => `- 「${s}」`).join('\n');
    lines.push(`你刚才说：\n${quoted}`);
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
  if (ctx.lore && ctx.lore.length > 0) {
    const loreText = ctx.lore.map((entry) => entry.content).join('\n');
    lines.push(`手边的世界书（用得上再用，不是本题）：\n${loreText}`);
  }
  if (ctx.speechExamples) {
    lines.push(`口吻样本：\n${ctx.speechExamples}`);
  }
  lines.push(`房间：此刻${ctx.dayPart.weekdayZh}${ctx.dayPart.label}，${ctx.dayPart.moodHint}。`);
  lines.push('');
  lines.push(
    `写「${ctx.hostName}」的下一句——${KIND_BRIEF[ctx.kind]}接着说就好。不必因为换歌而换话题，也不必提到正在放的歌。`,
  );

  return { system, user: lines.join('\n') };
}
