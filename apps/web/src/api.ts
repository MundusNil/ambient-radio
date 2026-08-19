/** 前端 API/WS 客户端：调频进入（对时）、事件流、断线重连 */
import type { ServerEvent, StationState } from '@ambient-radio/shared';

export interface StationInfo {
  station: { name: string; host: string };
  audio: {
    ducking: {
      speechGain: number;
      attackTauMs: number;
      releaseDelayMs: number;
      releaseTauMs: number;
    };
  };
}

export async function fetchConfig(): Promise<StationInfo> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`/api/config ${res.status}`);
  return (await res.json()) as StationInfo;
}

export async function fetchState(): Promise<StationState> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error(`/api/state ${res.status}`);
  return (await res.json()) as StationState;
}

/** 服务器-本地时钟偏移：本地时间 + offset ≈ 服务器时间 */
export function calibrate(state: StationState): number {
  return state.serverTime - Date.now();
}

export interface WsHandle {
  close(): void;
}

/** 连接电台事件流；断线 3s 后自动重连（收音机掉线自动重新调频） */
export function connectWs(onEvent: (event: ServerEvent) => void, onOpen?: () => void): WsHandle {
  let closed = false;
  let ws: WebSocket | null = null;

  function connect(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => onOpen?.();
    ws.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data as string) as ServerEvent);
      } catch {
        // 无效消息忽略，事件流不断
      }
    };
    ws.onclose = () => {
      if (!closed) setTimeout(connect, 3000);
    };
  }

  connect();
  return {
    close() {
      closed = true;
      ws?.close();
    },
  };
}
