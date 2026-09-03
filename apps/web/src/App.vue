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
// biome-ignore lint/correctness/noUnusedImports: used in template
import { initialScheme, ORB_SCHEMES, type OrbScheme, persistScheme } from './palettes';

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
// D4 氛围层配色：右上角设置面板手动切换，localStorage 记忆，切换 2s 颜色滑变
const scheme = ref<OrbScheme>(initialScheme());
const settingsOpen = ref(false);

function pickScheme(next: OrbScheme): void {
  scheme.value = next;
  persistScheme(next.id);
}

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
    <GradientBackground :scheme="scheme" :talking="hostTalking" :off-air="offAir" />
    <div class="veil" :class="{ talking: hostTalking, lost: offAir }" aria-hidden="true" />

    <button
      class="gear ui-icon-button"
      :class="{ open: settingsOpen }"
      :aria-expanded="settingsOpen"
      aria-controls="scheme-settings"
      aria-label="设置"
      @click="settingsOpen = !settingsOpen"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    </button>
    <Transition name="pop">
      <fieldset v-if="settingsOpen" id="scheme-settings" class="settings ui-panel">
        <legend class="settings-title ui-label">氛围配色</legend>
        <div class="swatches">
          <label v-for="s in ORB_SCHEMES" :key="s.id" class="ui-swatch">
            <input
              class="ui-swatch-input"
              type="radio"
              name="scheme"
              :value="s.id"
              :checked="scheme.id === s.id"
              @change="pickScheme(s)"
            />
            <span
              class="ui-swatch-orb"
              :style="{ '--c1': s.colors[0], '--c2': s.colors[1], '--c3': s.colors[2] }"
              aria-hidden="true"
            >
              <svg class="ui-swatch-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <span class="ui-swatch-name">{{ s.name }}</span>
          </label>
        </div>
      </fieldset>
    </Transition>

    <section class="hero">
      <p class="on-air" :class="{ active: live, talking: hostTalking }">
        <span class="ui-dot" aria-hidden="true" />
        ON AIR
      </p>

      <h1 class="title ui-display">Mock Radio</h1>

      <p class="sr-only" aria-live="polite">{{ hostTalking ? '梦可正在说话' : '' }}</p>

      <p class="now-playing" :class="{ silent: !live || !state?.title }" aria-live="polite">
        <template v-if="offAir">
          <span class="np-label">信号丢失</span>
          <span class="np-title">曲库暂时无法播放，维护者处理中</span>
        </template>
        <template v-else-if="live && state?.title">
          <span class="np-label">正在播放</span>
          <span class="np-title-slot">
            <Transition name="np-fade">
              <span :key="state.trackId ?? state.title" class="np-title">{{ state.title }}</span>
            </Transition>
          </span>
        </template>
        <template v-else-if="state?.title">
          <span class="np-label">此刻电波里</span>
          <span class="np-title-slot">
            <Transition name="np-fade">
              <span :key="state.trackId ?? state.title" class="np-title">{{ state.title }}</span>
            </Transition>
          </span>
        </template>
        <template v-else>
          <span class="np-label">频率调谐中</span>
        </template>
      </p>

      <button
        class="power ui-button"
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
        <div class="chat-list">
          <p v-for="m in messages" :key="m.id" class="chat-item">{{ m.body }}</p>
        </div>
        <form class="chat-form" @submit.prevent="sendMessage">
          <label class="sr-only" for="msg">留言</label>
          <input
            id="msg"
            v-model="draft"
            class="ui-field"
            type="text"
            maxlength="200"
            placeholder="说点什么"
            autocomplete="off"
          />
          <button class="ui-button ui-button--ghost" type="submit" :disabled="sending || !draft.trim()">发送</button>
        </form>
      </div>
      <div class="volume">
        <label for="vol">音量</label>
        <input
          id="vol"
          v-model.number="volume"
          class="ui-slider"
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
