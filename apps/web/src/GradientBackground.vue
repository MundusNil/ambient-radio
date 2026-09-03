<!--
  Paper Shaders GrainGradient（与参考页同一组参数）。
  这是 D4 收音机面板的氛围层：全屏电波，不是可视化器。
-->
<script setup lang="ts">
import {
  defaultObjectSizing,
  GrainGradientShapes,
  getShaderColorFromString,
  getShaderNoiseTexture,
  grainGradientFragmentShader,
  ShaderFitOptions,
  ShaderMount,
} from '@paper-design/shaders';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { hexToRgb01, lerp, type OrbScheme } from './palettes';

const props = withDefaults(
  defineProps<{
    /** 当前配色方案；切换时颜色平滑滑变，不闪跳 */
    scheme: OrbScheme;
    talking?: boolean;
    offAir?: boolean;
  }>(),
  { talking: false, offAir: false },
);

const root = ref<HTMLElement | null>(null);
let mount: ShaderMount | null = null;
let cancelled = false;
let motionQuery: MediaQueryList | null = null;
let currentColors: Array<[number, number, number, number]> = props.scheme.colors.map(hexToRgb01);
let fadeRaf = 0;

function targetSpeed(): number {
  if (motionQuery?.matches) return 0;
  if (props.offAir) return 0.12;
  if (props.talking) return 0.4;
  return 1;
}

function applySpeed(): void {
  mount?.setSpeed(targetSpeed());
}

onMounted(async () => {
  const el = root.value;
  if (!el) return;

  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', applySpeed);

  const noise = getShaderNoiseTexture();
  if (noise) {
    try {
      await noise.decode();
    } catch {
      // 噪声贴图失败时着色器仍可跑，只是颗粒更弱
    }
  }
  if (cancelled || !root.value) return;

  const sizing = defaultObjectSizing;
  // 仍是 3 档。颜色来自 palettes.ts 当前方案，切换时逐帧插值。
  const colors = currentColors;

  try {
    mount = new ShaderMount(
      root.value,
      grainGradientFragmentShader,
      {
        u_colorBack: getShaderColorFromString('hsl(0, 0%, 0%)'),
        u_colors: colors.map((c) => c.slice()),
        u_colorsCount: colors.length,
        u_softness: 0.76,
        u_intensity: 0.45,
        u_noise: 0,
        u_shape: GrainGradientShapes.corners,
        u_noiseTexture: noise,
        u_fit: ShaderFitOptions[sizing.fit],
        u_scale: 1,
        u_rotation: 0,
        u_offsetX: 0,
        u_offsetY: 0,
        u_originX: sizing.originX,
        u_originY: sizing.originY,
        u_worldWidth: sizing.worldWidth,
        u_worldHeight: sizing.worldHeight,
      },
      undefined,
      targetSpeed(),
      0,
      1.5,
      1920 * 1080,
    );
  } catch {
    // WebGL 不可用：保留 CSS 兜底渐变
  }
  // 初始方案同步一次 CSS 变量（accent 派生色 + 兜底渐变），WebGL 失败也能跟主题
  applySchemeVars(props.scheme);
});

/** 主题切换：2s easeInOut 逐帧插值 u_colors，丝滑滑变；reduced-motion 直接落位 */
watch(
  () => props.scheme,
  (next) => {
    cancelAnimationFrame(fadeRaf);
    applySchemeVars(next);
    const from = currentColors;
    const to = next.colors.map(hexToRgb01);
    if (motionQuery?.matches) {
      currentColors = to;
      mount?.setUniforms({ u_colors: to, u_colorsCount: to.length });
      return;
    }
    const started = performance.now();
    const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    const step = (now: number): void => {
      const t = Math.min(1, (now - started) / 2000);
      const k = easeInOut(t);
      currentColors = from.map((c, i) => {
        const next = to[i];
        return c.map((v, j) => lerp(v, next?.[j] ?? v, k)) as [number, number, number, number];
      });
      mount?.setUniforms({ u_colors: currentColors, u_colorsCount: currentColors.length });
      if (t < 1) fadeRaf = requestAnimationFrame(step);
    };
    fadeRaf = requestAnimationFrame(step);
  },
);

/** 把方案的 accent 派生色与兜底渐变色落到 :root（shader 颜色单独走插值） */
function applySchemeVars(scheme: OrbScheme): void {
  const rootStyle = document.documentElement.style;
  const accent = hexToRgb01(scheme.accent);
  rootStyle.setProperty('--accent', scheme.accent);
  rootStyle.setProperty('--accent-glow', `rgb(${toRgba255(accent, 0.45)})`);
  rootStyle.setProperty('--accent-line', `rgb(${toRgba255(accent, 0.55)})`);
  rootStyle.setProperty('--accent-soft', `rgb(${toRgba255(accent, 0.18)})`);
  scheme.colors.map(hexToRgb01).forEach((c, i) => {
    rootStyle.setProperty(`--orb-${i + 1}`, cssRgb(c));
  });
}
onUnmounted(() => {
  cancelled = true;
  motionQuery?.removeEventListener('change', applySpeed);
  motionQuery = null;
  cancelAnimationFrame(fadeRaf);
  mount?.dispose();
  mount = null;
});

function toRgba255(vec: readonly number[], alpha: number): string {
  return `${Math.round((vec[0] ?? 0) * 255)} ${Math.round((vec[1] ?? 0) * 255)} ${Math.round((vec[2] ?? 0) * 255)} / ${alpha}`;
}

function cssRgb(vec: readonly number[]): string {
  return `rgb(${Math.round((vec[0] ?? 0) * 255)} ${Math.round((vec[1] ?? 0) * 255)} ${Math.round((vec[2] ?? 0) * 255)})`;
}
</script>

<template>
  <div ref="root" class="gradient" aria-hidden="true" />
</template>
