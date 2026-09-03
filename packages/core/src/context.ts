/**
 * 上下文构建器（技术设计 §4.3）：把人格 + 曲目/留言/记忆 + 段落意图组装成 LLM prompt。
 * Aitune 六要素砍一留五：无 User Profile（D1/D2）。
 * 纯逻辑零 IO：persona 内容由调用方传入（组装层读文件）。
 *
 * 装配纪律（2026-09-03 起，选项 A）：
 * 不注入报时/moodHint、不把曲名塞进常规串场、不要求逐句韵律；
 * 上一段口播只作「不要续写」护栏，不当酒馆燃料。
 */
import type { DayPartContext } from './time';
import type { MemoryKind, SegmentKind } from './types';

export interface TrackBrief {
  title: string;
  artist: string | null;
  styles: string[];
}

export interface AiredBrief {
  kind: SegmentKind;
  text: string;
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
  /** 最近已播口播：只用来禁止续写/重复开场，不当续聊燃料 */
  recentAired?: AiredBrief[];
}

export interface SegmentPrompt {
  system: string;
  user: string;
}

/** 各段落类型的意图简述：只约束「说什么、说到哪停」，不给字数下限，不教具体意象 */
const KIND_BRIEF: Record<SegmentKind, string> = {
  station_id:
    '台呼：一句话带出电台名即可；不得点名、欢迎或识别当前听众，不说「欢迎回来」这类措辞。',
  interlude:
    '常规串场：可以只从音乐给你的感觉里轻轻带一句，也可以几乎什么都不解释；不要描写房间、街道、店、猫或任何你看不见的布景。话少不硬撑，说完就停。',
  topic:
    '小主题：只展开一件真实的节目事（你记得的承诺、听众追问过的、已经长出来的梗）。不要写成连续剧或街景。讲完想讲的那一层就停。',
  reply:
    '回应听众留言：合并理解相关内容再回应；用泛称指代听众，不点名；不确定的不接；把回应说完，别停在半路。',
  request_ack: '点歌回应：这首已经受理，预告即将安排；语气符合人格；不进入任何「模式」话术。',
};

const SYSTEM_RULES = `你是{HOST_NAME}，一台 AI 氛围电台的主播，正在直播。音乐在响。听众在听，你是节目的主持人。

<persona>
{PERSONA}
</persona>

你的电台叫「{STATION_NAME}」。需要报台名或自我介绍时报这个名字，平时不必反复提。

【你的节目】
- 只有音乐的电台，听众偶尔留言。音乐是主体，你只在合适的时候开口。沉默是节目的一部分，不要为了填空隙去编场景。
- 每段都是独立、完整的一段：说完就停，不要留半句等下次接——下次开口隔很久，半句话接不上。
- 不要把多段口播连成一部连续剧。上一段里的角色、道具、镜头到此为止。

【怎么开口】
- 素材只来自：正在响的音乐给你的感觉、听众留言、你记得的真实节目事。不要凭空搭房间、街景、店、路过的人、猫、门槛、糖水铺。
- 不报时式开场（不要「现在是周X的…」「周一的清晨」「傍晚的光」这类起头），不逐首报幕（不要念歌名当 DJ），不预告接下来放什么，不用「希望你…」这类客套收尾。
- 想确认作品背景可以搜。没把握就轻轻带过，不把没核实的事当事实说。
- 不要写分镜：不要一句一个镜头，不要给每句话标情绪和停顿。

【输出】
- 严格 JSON：{"text":"要念出来的普通话口语","songRequest":null}
- text 只写要播出的话：不要前缀、标题、括号、舞台指示、表情符号、<#0.5#> 这类标记。
- songRequest 仅当听众留言明显在点歌时填 {"query":"歌名或风格"}，否则 null。
`;

export function buildSegmentPrompt(ctx: SegmentPromptContext): SegmentPrompt {
  const hostName = ctx.hostName.trim() || '梦可';
  const system = SYSTEM_RULES.replace('{PERSONA}', ctx.persona.trim())
    .replace('{STATION_NAME}', ctx.stationName.trim())
    .replace('{HOST_NAME}', hostName);

  const lines: string[] = [];
  const nameTracks = ctx.kind === 'reply' || ctx.kind === 'request_ack';
  if (nameTracks && ctx.currentTrack) {
    const artist = ctx.currentTrack.artist ? `，${ctx.currentTrack.artist}` : '';
    const styles =
      ctx.currentTrack.styles.length > 0 ? `（${ctx.currentTrack.styles.join('/')}）` : '';
    lines.push(`电台正在播放《${ctx.currentTrack.title}》${artist}${styles}。`);
  }
  if (nameTracks && ctx.recentTracks.length > 0) {
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
    lines.push(
      `你记得的节目历史（只可引用这些真实发生过的事，禁止编造或扩展；引用点到为止，不要扩写成场景描写）：\n${remembered}`,
    );
  }
  if (ctx.recentAired && ctx.recentAired.length > 0) {
    const quoted = ctx.recentAired.map((s, i) => `${i + 1}. ${s.text.trim()}`).join('\n');
    lines.push(`刚才播出过（不要续写其中的情节、角色或场景，也不要用同一套开场）：\n${quoted}`);
  }
  lines.push('');
  lines.push(`现在开口，${KIND_BRIEF[ctx.kind]}说完再停。`);

  return { system, user: lines.join('\n') };
}
