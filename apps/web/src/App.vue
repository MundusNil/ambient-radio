<script setup lang="ts">
// 收音机面板：调频进入（D5）—— 开台即跳进正在进行的节目。
// 控制只有开台/关台 + 总音量（FR-001）；无进度条、无切歌、无回放（PRD §8.2）。

import { planTuneIn, type ServerEvent, type StationState } from '@ambient-radio/shared';
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
// biome-ignore lint/correctness/noUnusedImports: used in template
import GradientBackground from './GradientBackground.vue';

const info = ref<StationInfo | null>(null);
const state = ref<StationState | null>(null);
const live = ref(false);
const volume = ref(0.8);
const connecting = ref(false);
const hostTalking = ref(false);
let hostTalkTimer: ReturnType<typeof setTimeout> | undefined;
const offAir = ref(false);
// P2 留言（FR-052：本次收听窗口内保留自己发送的留言；关台即清 FR-057）
const messages = ref<Array<{ id: string; body: string }>>([]);
const draft = ref('');
const sending = ref(false);

const audio = new RadioAudio();
let ws: WsHandle | null = null;
let clockOffset = 0;
let statePollTimer: ReturnType<typeof setInterval> | null = null;
// ER-004：解码失败上报电台跳过该曲
audio.onTrackFailed = (trackId) => {
  if (ws && live.value) {
    ws.sendRaw(JSON.stringify({ type: 'track-failed', trackId }));
  }
};

async function refreshState(): Promise<void> {
  const s = await fetchState().catch(() => null);
  if (!s) return;
  clockOffset = calibrate(s);
  state.value = s;
}

function applyTuneIn(s: StationState): void {
  const plan = planTuneIn(s);
  if (plan.trackId) void audio.play(plan.trackId, plan.startedAt, clockOffset, true);
  if (plan.speechSegmentId) {
    void audio.playSpeech(plan.speechSegmentId);
    hostTalking.value = true;
  }
}

function handleEvent(event: ServerEvent): void {
  if (event.type === 'off-air') {
    offAir.value = true;
    audio.suspend();
  } else if (event.type === 'sync') {
    state.value = event.state;
    if (live.value) applyTuneIn(event.state);
  } else if (event.type === 'track') {
    state.value = {
      trackId: event.trackId,
      title: event.title,
      startedAt: event.startedAt,
      durationMs: event.durationMs,
      positionMs: Math.max(0, Date.now() + clockOffset - event.startedAt),
      hostTalking: false,
      hostSegmentId: null,
      serverTime: Date.now() + clockOffset,
    };
    if (live.value) {
      void audio.play(event.trackId, event.startedAt, clockOffset, false);
    }
  } else if (event.type === 'voice') {
    if (live.value) {
      void audio.playSpeech(event.segmentId);
      hostTalking.value = true;
      clearTimeout(hostTalkTimer);
      hostTalkTimer = setTimeout(() => {
        hostTalking.value = false;
      }, event.durationMs + 200);
    }
  } else if (event.type === 'received') {
    const pending = messages.value.find((m) => m.id.startsWith('pending-'));
    if (pending) pending.id = event.id;
  }
}

async function openStation(): Promise<void> {
  connecting.value = true;
  try {
    await audio.unlock(info.value?.audio.ducking, info.value?.audio.crossfadeMs);
    await refreshState();
    if (state.value) applyTuneIn(state.value);
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
  messages.value = []; // FR-057：关台后上一轮留言不再显示
}

function sendMessage(): void {
  const body = draft.value.trim();
  if (!body || !ws) return;
  ws.sendMessage(body);
  // 本地乐观记录（FR-052）；回执由 received 事件确认去重
  messages.value.push({ id: `pending-${Date.now()}`, body });
  draft.value = '';
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
    <GradientBackground :talking="hostTalking" :off-air="offAir" />
    <div class="veil" :class="{ talking: hostTalking, lost: offAir }" aria-hidden="true" />

    <section class="hero">
      <p class="on-air" :class="{ active: live, talking: hostTalking }">
        <span class="lamp" aria-hidden="true" />
        ON AIR
      </p>

      <h1 class="title">Mock Radio</h1>

      <p class="sr-only" aria-live="polite">{{ hostTalking ? '梦可正在说话' : '' }}</p>

      <p class="now-playing" :class="{ silent: !live || !state?.title }" aria-live="polite">
        <template v-if="offAir">
          <span class="np-label">信号丢失</span>
          <span class="np-title">曲库暂时无法播放，维护者处理中</span>
        </template>
        <template v-else-if="live && state?.title">
          <span class="np-label">正在播放</span>
          <span class="np-title">{{ state.title }}</span>
        </template>
        <template v-else-if="state?.title">
          <span class="np-label">此刻电波里</span>
          <span class="np-title">{{ state.title }}</span>
        </template>
        <template v-else>
          <span class="np-label">频率调谐中</span>
        </template>
      </p>

      <button
        class="power"
        :class="{ on: live }"
        :disabled="connecting"
        :aria-pressed="live"
        :aria-busy="connecting"
        @click="live ? closeStation() : openStation()"
      >
        {{ connecting ? '调频中' : live ? '关台' : '开台' }}
      </button>
    </section>

    <div class="dock">
      <div v-if="live" class="chat">
        <div class="chat-list" :class="{ empty: messages.length === 0 }">
          <template v-if="messages.length > 0">
            <p v-for="m in messages" :key="m.id" class="chat-item">{{ m.body }}</p>
          </template>
          <template v-else>
            <p class="chat-hint">梦可会在这个频率上读到你的留言。</p>
          </template>
        </div>
        <form class="chat-form" @submit.prevent="sendMessage">
          <label class="sr-only" for="msg">留言</label>
          <input
            id="msg"
            v-model="draft"
            class="chat-input"
            type="text"
            maxlength="200"
            placeholder="说点什么"
            autocomplete="off"
          />
          <button class="chat-send" type="submit" :disabled="sending || !draft.trim()">发送</button>
        </form>
      </div>
      <div class="volume">
        <label for="vol">音量</label>
        <input
          id="vol"
          v-model.number="volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(volume * 100)"
        />
      </div>
    </div>
  </main>
</template>
