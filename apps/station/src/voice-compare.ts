/**
 * TTS 盲听对比（技术设计 §4.6）：同一段串场文本用候选音色各合成一版，
 * 维护者亲耳挑选「她的声音」。声音是产品的一半生命，这个决定不许外包。
 * 用法：pnpm voice:compare
 * 产物：.cache/voice-compare/<voice>.mp3（不进 git）
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEdgeTts } from '@ambient-radio/adapters';
import { loadStationConfig } from './config';
import { loadEnvFile } from './env';
import { findRepoRoot } from './paths';

/** 候选音色池：覆盖「温柔 / 活泼 / 甜 / 清亮 / 可爱」五种底色 */
const CANDIDATES = [
  { label: '晓晓 · 默认（Warm）', voice: 'zh-CN-XiaoxiaoNeural' },
  { label: '晓伊 · 活泼（Lively）', voice: 'zh-CN-XiaoyiNeural' },
  { label: '晓萱 · 甜（Sweet）', voice: 'zh-CN-XiaoxuanNeural' },
  { label: '云希 · 男声清亮（Sunshine）', voice: 'zh-CN-YunxiNeural' },
  { label: '云霞 · 男声可爱（Cute）', voice: 'zh-CN-YunxiaNeural' },
];

/** 盲听文本：覆盖电台串场的典型形态（安静开场 + 音乐评论 + 轻收尾） */
const SAMPLE_TEXT =
  '周五的傍晚，天色暗得刚刚好。电台正在放一首很轻的曲子，像谁在远处慢慢翻一页书。收音机前的你，不必回应什么，听着就好。';

async function main(): Promise<void> {
  loadEnvFile();
  const repoRoot = findRepoRoot();
  const config = loadStationConfig();
  const outDir = resolve(repoRoot, '.cache', 'voice-compare');
  mkdirSync(outDir, { recursive: true });

  console.log('🎙️ TTS 盲听对比（技术设计 §4.6）');
  console.log('文本：「' + SAMPLE_TEXT.slice(0, 30) + '…」\n');

  for (const candidate of CANDIDATES) {
    const tts = createEdgeTts({
      voice: candidate.voice,
      rate: config.tts.rate,
      cacheDir: outDir,
      loudnorm: config.tts.postProcess === 'loudnorm',
    });
    const speech = await tts.synthesize(SAMPLE_TEXT);
    console.log(`  ✓ ${candidate.label} → ${speech.filePath}`);
  }

  console.log(`\n全部完成。请逐一试听 ${outDir} 下的文件，然后告诉我你的选择；`);
  console.log('我会把选中的音色写进 config/station.config.json 的 tts.voice。');
}

main().catch((err) => {
  console.error('[voice-compare] 失败：', err);
  process.exit(1);
});
