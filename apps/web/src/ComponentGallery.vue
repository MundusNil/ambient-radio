<script setup lang="ts">
// 组件画廊：?gallery=1 打开，铺出设计系统全部 ui-* 组件，供后期改前端对照。
import { ref } from 'vue';
// biome-ignore lint/correctness/noUnusedImports: ORB_SCHEMES used in template
import { DEFAULT_SCHEME, ORB_SCHEMES } from './palettes';

const checked = ref(DEFAULT_SCHEME.id);
const volume = ref(0.6);
const draft = ref('');
</script>

<template>
  <section class="gallery">
    <header class="gallery-head">
      <p class="ui-label">Design System</p>
      <h1 class="ui-display">组件画廊</h1>
      <p class="gallery-note">暗黑杂志风 · 弥散极光 · 胶片颗粒 · 发丝线分层</p>
    </header>

    <div class="gallery-grid">
      <div class="gallery-cell">
        <p class="ui-label">标签 Label</p>
        <p class="ui-label">ON AIR</p>
        <span class="np-label">正在播放</span>
      </div>

      <div class="gallery-cell">
        <p class="ui-label">状态灯 Dot</p>
        <p class="on-air"><span class="ui-dot" />待机</p>
        <p class="on-air active"><span class="ui-dot" />直播</p>
        <p class="on-air active talking"><span class="ui-dot" />说话</p>
      </div>

      <div class="gallery-cell">
        <p class="ui-label">按钮 Button</p>
        <div class="gallery-row">
          <button class="ui-button">开台</button>
          <button class="ui-button" aria-pressed="true">关台</button>
          <button class="ui-button" disabled>调频中</button>
        </div>
        <div class="gallery-row">
          <button class="ui-button ui-button--primary">确定</button>
          <button class="ui-button ui-button--ghost">发送</button>
          <button class="ui-button ui-button--ghost" disabled>发送</button>
        </div>
      </div>

      <div class="gallery-cell">
        <p class="ui-label">图标按钮 Icon</p>
        <div class="gallery-row">
          <button class="ui-icon-button" aria-label="设置">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </button>
        </div>
      </div>

      <div class="gallery-cell">
        <p class="ui-label">输入 Field</p>
        <form class="chat-form" @submit.prevent>
          <input v-model="draft" class="ui-field" type="text" placeholder="说点什么" />
          <button class="ui-button ui-button--ghost" type="submit">发送</button>
        </form>
        <div class="key-row">
          <label class="key-label" for="g-key">
            <span class="ui-dot configured" />豆包（方舟）API Key
          </label>
          <input
            id="g-key"
            class="ui-field ui-field--secret"
            type="text"
            readonly
            value="••••••••••••••••"
          />
          <p class="key-help">只读掩码、禁复制；聚焦全选后直接输入新值覆盖</p>
        </div>
      </div>

      <div class="gallery-cell">
        <p class="ui-label">滑块 Slider</p>
        <div class="volume">
          <label for="g-vol">音量</label>
          <input id="g-vol" v-model.number="volume" class="ui-slider" type="range" min="0" max="1" step="0.01" />
        </div>
      </div>

      <div class="gallery-cell gallery-cell--wide">
        <p class="ui-label">主题卡片 Theme card</p>
        <div class="swatches">
          <label
            v-for="s in ORB_SCHEMES"
            :key="s.id"
            class="ui-theme-card"
            :style="{ '--c1': s.colors[0], '--c2': s.colors[1], '--c3': s.colors[2] }"
          >
            <input v-model="checked" class="ui-swatch-input" type="radio" name="gallery-scheme" :value="s.id" />
            <span class="ui-theme-preview" aria-hidden="true">
              <span class="ui-theme-orb ui-theme-orb--bl" />
              <span class="ui-theme-orb ui-theme-orb--tr" />
              <span class="grain" />
            </span>
            <span class="ui-theme-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <span class="ui-theme-meta">
              <span class="ui-theme-name">{{ s.name }}</span>
              <span class="ui-theme-dots" aria-hidden="true">
                <i :style="{ background: s.colors[0] }" />
                <i :style="{ background: s.colors[1] }" />
                <i :style="{ background: s.colors[2] }" />
              </span>
            </span>
          </label>
        </div>
      </div>

      <div class="gallery-cell gallery-cell--wide">
        <p class="ui-label">浮层 Panel</p>
        <fieldset class="ui-panel gallery-panel">
          <legend class="ui-label settings-title">氛围配色</legend>
          <p class="gallery-note">分层表面 + 阴影 + 毛玻璃，无边框（间距优先于描边）</p>
        </fieldset>
      </div>
    </div>
  </section>
</template>

<style scoped>
.gallery {
  position: relative;
  z-index: 2;
  max-width: 720px;
  margin-inline: auto;
  padding: var(--space-3xl) var(--space-xl) 96px;
}

.gallery-head {
  text-align: center;
  margin-bottom: var(--space-3xl);
}

.gallery-note {
  margin: var(--space-sm) 0 0;
  font-size: var(--text-md);
  color: var(--fg-faint);
  letter-spacing: var(--track-tight);
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-2xl);
}

.gallery-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.gallery-cell--wide {
  grid-column: 1 / -1;
}

.gallery-cell > .ui-label:first-child {
  color: var(--accent);
}

.gallery-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md);
}

.gallery-panel {
  position: static;
  max-width: 320px;
}

@media (max-width: 640px) {
  .gallery-grid {
    grid-template-columns: 1fr;
  }
}
</style>
