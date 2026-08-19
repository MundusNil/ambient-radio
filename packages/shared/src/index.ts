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
  serverTime: number; // epoch ms，用于时钟对齐
}

/** WS 下行事件 */
export type ServerEvent =
  | { type: 'track'; trackId: string; title: string; startedAt: number; durationMs: number }
  | { type: 'voice'; segmentId: string; startedAt: number; durationMs: number }
  | { type: 'sync'; state: StationState };

/** WS 上行事件 */
export type ClientEvent = { type: 'message'; body: string };

/** 留言回执 */
export type MessageAck = { type: 'received'; id: string };

/** POST /api/message 请求体（WS 断连时的降级通道） */
export interface PostMessageBody {
  body: string;
}
