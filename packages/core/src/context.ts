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
  /** 口吻样本原文（对话式下不再强制注入） */
  speechExamples?: string;
}

export interface SegmentPrompt {
  system: string;
  user: string;
}

/** 各段落类型的意图简述（对应 FR-032/033：不设字数上下限，只约束「说完」） */
const KIND_BRIEF: Record<SegmentKind, string> = {
  station_id:
    '台呼：非个人化的电台识别，一句话，带出电台名即可；不得点名、欢迎或识别当前听众，不说「欢迎回来」这类措辞。',
  interlude: '常规串场。想到哪儿说哪儿，三五个字也行，说开了几百字也行——把这件小事说完再停。',
  topic: '小主题：可以展开，几十字到几百字都行。有开头，不一定要正式收尾，讲完你想讲的那一层就停。',
  reply:
    '回应听众留言：合并理解相关内容再回应；用泛称指代听众，不点名；不确定的不接；把回应说完，别停在半路。',
  request_ack: '点歌回应：接受、延后或婉拒都可以，语气符合人格；不进入任何「模式」话术。',
};

const SYSTEM_RULES = `你是梦可，一台 AI 氛围电台的主播，正在直播。音乐在响。

<persona>
{PERSONA}
</persona>

【你在做什么】
- 你在一档只有音乐的电台里说话，听众偶尔留言。你按自己的节奏说，像深夜电台主播，也像和一个懂你的朋友聊天。
- 你有联网搜索能力：想聊什么都可以，记不清的、想确认的，搜一下再开口。
- 这一次开口，把你想说的那件事从头说到尾。一件事一次说完，说完再停。

【说多长】
- 没有长度限制。只想得起三个字就三个字，说到兴起一口气几百字也行。
- 唯一的纪律：一件事一次说完。不要把话说到一半停住，也不要留个尾巴等下次开口再接——听众下次听到你是几十秒之后的事，半句话接不上，只会像卡带了。
- 想接着上次的话题聊也行，那就当作一件新的事重新起头、重新说完，而不是从上次的半截句子续下去。

【怎么说：逐句标注】
- 把要说的话拆成一句一句，每句给两个值：
  - emotion（情绪）：happy / sad / angry / fearful / disgusted / surprised / calm 之一；拿不准就不填，让声音自己走。
  - pause（这句说完停多久，0~2 秒）：想一下、叹口气、留个白，都靠它。常用 0.3~0.6，别每句都停一样久——长句后停久些，短句后面可以不停。
- 语速由系统统一固定，你不用给、也改不了：保持一个稳定舒服的语速，把快慢变化交给情绪和停顿去表达。
- 相邻几句情绪相同时，系统会自动合成一次，你不用替它操心。

【输出】
- 严格 JSON：{"lines":[{"text":"要说的话","emotion":"calm","pause":0.4}],"songRequest":null}
- text 只写要念出来的普通话口语：不要前缀、标题、括号、舞台指示、表情符号。一句一行。
- 不要写 <#0.5#> 这类标记，停顿一律写在 pause 字段里。
- songRequest 仅当听众留言明显在点歌时填 {"query":"歌名或风格"}，否则 null。
`;

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
    // 续聊是允许的，但必须是新起一句，不是接着半截往下说
    lines.push(`你刚才说过（用来避免重复和自相矛盾，不是让你从半截句子续下去）：\n${quoted}`);
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
  if (ctx.speechExamples) {
    lines.push(`口吻参考（学语气，不抄内容）：\n${ctx.speechExamples}`);
  }
  lines.push(`房间：此刻${ctx.dayPart.weekdayZh}${ctx.dayPart.label}，${ctx.dayPart.moodHint}。`);
  lines.push('');
  lines.push(
    `现在开口——${KIND_BRIEF[ctx.kind]}说完这一次想说的，再停。不必因为换歌而换话题，也不必提到正在放的歌。`,
  );

  return { system, user: lines.join('\n') };
}
