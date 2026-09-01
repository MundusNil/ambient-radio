/**
 * API / WebSocket 事件 schema（技术设计 §6）。
 * 前后端共享同一套类型：协议变更编译期报错。
 * 零依赖、自包含 —— apps/web 只引这一个包。
 */

/** GET /api/state 响应：调频同步（进入页面时对齐正在进行的节目） */
export interface StationState {
  trackId: string | null;
  title: string | null;
  startedAt: number; // epoch ms
  durationMs: number;
  positionMs: number;
  hostTalking: boolean;
  /** 进行中的段落；调频进入时据此接上语音 */
  hostSegmentId: string | null;
  serverTime: number; // epoch ms，用于时钟对齐
}

/** 调频进入计划：音乐 seek + 可选接上正在播出的段落 */
export interface TuneInPlan {
  trackId: string | null;
  startedAt: number;
  speechSegmentId: string | null;
}

export function planTuneIn(state: StationState): TuneInPlan {
  return {
    trackId: state.trackId,
    startedAt: state.startedAt,
    speechSegmentId: state.hostTalking ? state.hostSegmentId : null,
  };
}

/** WS 下行事件 */
export type ServerEvent =
  | { type: 'track'; trackId: string; title: string; startedAt: number; durationMs: number }
  | { type: 'voice'; segmentId: string; startedAt: number; durationMs: number }
  | { type: 'sync'; state: StationState }
  | { type: 'received'; id: string }
  | OffAirEvent;

/** WS 上行事件 */
export type ClientEvent =
  | { type: 'message'; body: string }
  /** ER-004：前端播放失败（decode 出错）上报，电台跳过该曲 */
  | { type: 'track-failed'; trackId: string };

/** 留言回执 */
export type MessageAck = { type: 'received'; id: string };

/** ER-005/006：连续多首失败，电台进入信号丢失状态（前端显示简短可理解的状态） */
export type OffAirEvent = { type: 'off-air'; reason: 'library' };

/** POST /api/message 请求体（WS 断连时的降级通道） */
export interface PostMessageBody {
  body: string;
}
