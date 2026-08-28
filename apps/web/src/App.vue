<script setup lang="ts">
// 收音机面板：调频进入（D5）—— 开台即跳进正在进行的节目。
// 控制只有开台/关台 + 总音量（FR-001）；无进度条、无切歌、无回放（PRD §8.2）。

import type { ServerEvent, StationState } from '@ambient-radio/shared';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import {
  calibrate,
  connectWs,
  fetchConfig,
  fetchState,
  type StationInfo,
  type WsHandle,
} from './api';
import { RadioAudio } from './audio';

const info = ref<StationInfo | null>(null);
const state = ref<StationState | null>(null);
const live = ref(false);
const volume = ref(0.8);
const connecting = ref(false);
const hostTalking = ref(false);
let hostTalkTimer: ReturnType<typeof setTimeout> | undefined;

const audio = new RadioAudio();
let ws: WsHandle | null = null;
let clockOffset = 0;
let statePollTimer: ReturnType<typeof setInterval> | null = null;

async function refreshState(): Promise<void> {
  const s = await fetchState().catch(() => null);
  if (!s) return;
  clockOffset = calibrate(s);
  state.value = s;
}

function handleEvent(event: ServerEvent): void {
  if (event.type === 'sync') {
    state.value = event.state;
    if (live.value && event.state.trackId) {
      void audio.play(event.state.trackId, event.state.startedAt, clockOffset);
    }
  } else if (event.type === 'track') {
    state.value = {
      trackId: event.trackId,
      title: event.title,
      startedAt: event.startedAt,
      durationMs: event.durationMs,
      positionMs: Math.max(0, Date.now() + clockOffset - event.startedAt),
      hostTalking: false,
      serverTime: Date.now() + clockOffset,
    };
    if (live.value) {
      void audio.play(event.trackId, event.startedAt, clockOffset);
    }
  } else if (event.type === 'voice') {
    // 梦可开口：音乐平滑压低（ducking 在 audio.playSpeech 内完成）
    if (live.value) {
      void audio.playSpeech(event.segmentId);
      hostTalking.value = true;
      clearTimeout(hostTalkTimer);
      hostTalkTimer = setTimeout(() => {
        hostTalking.value = false;
      }, event.durationMs + 200);
    }
  }
}

async function openStation(): Promise<void> {
  connecting.value = true;
  try {
    await audio.unlock(info.value?.audio.ducking);
    await refreshState();
    if (state.value?.trackId) {
      await audio.play(state.value.trackId, state.value.startedAt, clockOffset);
    }
    ws = connectWs(handleEvent);
    live.value = true;
  } finally {
    connecting.value = false;
  }
}

function closeStation(): void {
  live.value = false;
  ws?.close();
  ws = null;
  audio.suspend();
}

watch(volume, (v) => audio.setVolume(v));

onMounted(async () => {
  info.value = await fetchConfig().catch(() => null);
  await refreshState();
  // WS 之外的低频校时兜底（防本地时钟漂移）
  statePollTimer = setInterval(() => {
    if (!live.value) void refreshState();
  }, 60_000);
});

onUnmounted(() => {
  ws?.close();
  if (statePollTimer !== null) clearInterval(statePollTimer);
});
</script>

<template>
  <main class="shell">
    <section class="panel">
      <p class="on-air" :class="{ active: live, talking: hostTalking }">
        <span class="lamp" aria-hidden="true" />ON AIR
      </p>

      <h1 class="title">{{ info?.station.name ?? '梦可电台' }}</h1>
      <p class="tagline" :class="{ talking: hostTalking }">
        {{ hostTalking ? '梦可正在说话…' : '音乐永远是主体，她只是偶尔轻轻开口。' }}
      </p>

      <div class="now-playing" :class="{ silent: !live || !state?.title }">
        <template v-if="live && state?.title">
          <span class="np-label">正在播放</span>
          <span class="np-title">{{ state.title }}</span>
        </template>
        <template v-else-if="state?.title">
          <span class="np-label">此刻电波里</span>
          <span class="np-title">{{ state.title }}</span>
        </template>
        <template v-else>
          <span class="np-label">频率调谐中</span>
          <span class="np-title">——</span>
        </template>
      </div>

      <button
        class="power"
        :class="{ on: live }"
        :disabled="connecting"
        @click="live ? closeStation() : openStation()"
      >
        {{ connecting ? '调频中…' : live ? '关台' : '开台' }}
      </button>

      <div class="volume">
        <label for="vol">音量</label>
        <input id="vol" v-model.number="volume" type="range" min="0" max="1" step="0.01" />
      </div>
    </section>
  </main>
</template>
