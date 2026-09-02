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

const props = withDefaults(
  defineProps<{
    talking?: boolean;
    offAir?: boolean;
  }>(),
  { talking: false, offAir: false },
);

const root = ref<HTMLElement | null>(null);
let mount: ShaderMount | null = null;
let cancelled = false;
let motionQuery: MediaQueryList | null = null;

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
  // 仍是 3 档。原模版 L≈50/66/83；现用技能库同色相下移一档，拉开高光。
  const colors = ['#22D3EE', '#06B6D4', '#0284C7'];

  try {
    mount = new ShaderMount(
      root.value,
      grainGradientFragmentShader,
      {
        u_colorBack: getShaderColorFromString('hsl(0, 0%, 0%)'),
        u_colors: colors.map(getShaderColorFromString),
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
});

watch(
  () => [props.talking, props.offAir],
  () => {
    applySpeed();
  },
);

onUnmounted(() => {
  cancelled = true;
  motionQuery?.removeEventListener('change', applySpeed);
  motionQuery = null;
  mount?.dispose();
  mount = null;
});
</script>

<template>
  <div ref="root" class="gradient" aria-hidden="true" />
</template>
