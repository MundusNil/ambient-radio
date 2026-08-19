import { getDayPartContext } from '@ambient-radio/core';
import type { StationState } from '@ambient-radio/shared';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/state', (c) => {
  // P1 骨架占位：节目引擎接入后，这里返回真实时间线状态（当前曲目 + 服务器时钟）。
  // 契约见 packages/shared —— 调频进入的收音机面板靠它对齐正在进行的节目。
  const state: StationState = {
    trackId: null,
    title: null,
    startedAt: 0,
    durationMs: 0,
    positionMs: 0,
    hostTalking: false,
    serverTime: Date.now(),
  };
  return c.json(state);
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  const now = getDayPartContext(new Date());
  console.log(`[station] 梦可电台守护进程（骨架） http://localhost:${info.port}`);
  console.log(`[station] 此刻是${now.weekdayZh} ${now.label}，${now.moodHint}。等节目引擎醒来。`);
});
