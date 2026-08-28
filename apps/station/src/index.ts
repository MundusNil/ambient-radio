import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  createEdgeTts,
  createOpenAiCompatibleLlm,
  createStore,
  systemClock,
} from '@ambient-radio/adapters';
import { getDayPartContext } from '@ambient-radio/core';
import { serve } from '@hono/node-server';
import { loadStationConfig } from './config';
import { loadEnvFile } from './env';
import { scanLibrary } from './library';
import { findRepoRoot } from './paths';
import { createRadio } from './radio';

async function main(): Promise<void> {
  loadEnvFile();
  const repoRoot = findRepoRoot();
  const config = loadStationConfig();
  const libraryRoot = resolve(repoRoot, config.library.root);
  const dbPath = resolve(repoRoot, 'data', 'station.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = createStore(dbPath);
  // 曲库：优先读库；首次启动自动扫描入库（之后用 pnpm scan 更新）
  let tracks = store.listTracks();
  if (tracks.length === 0) {
    console.log('[station] 曲库为空，首次扫描入库…');
    tracks = await scanLibrary(libraryRoot);
    if (tracks.length > 0) store.upsertTracks(tracks);
  }

  if (tracks.length === 0) {
    console.error(
      '[station] 曲库为空：把音频文件放进 config/library/<子风格>/ 后再启动（ER-005：无音乐即无电台）。',
    );
    process.exit(1);
  }

  const styleSummary = [...new Set(tracks.flatMap((t) => t.styles))]
    .map((s) => `${s}(${tracks.filter((t) => t.styles.includes(s)).length})`)
    .join(' ');

  const apiKey = process.env[config.llm.apiKeyEnv] ?? '';
  if (!apiKey) {
    console.error(
      `[station] 缺少 LLM API key（环境变量 ${config.llm.apiKeyEnv}）：请在 .env 配置后重启。串场管线将保持静默（沉默保底）。`,
    );
  }
  const persona = readFileSync(resolve(repoRoot, 'config', 'persona.md'), 'utf-8');

  const radio = createRadio({
    stationName: config.station.name,
    hostName: config.station.host,
    persona,
    engineConfig: config.engine,
    schedulerConfig: config.scheduler,
    ducking: config.audio.ducking,
    tracks,
    libraryRoot,
    clock: systemClock,
    llm: createOpenAiCompatibleLlm({
      baseUrl: config.llm.baseUrl,
      apiKey,
      model: config.llm.model,
      temperature: config.llm.temperature,
    }),
    tts: createEdgeTts({
      voice: config.tts.voice,
      rate: config.tts.rate,
      cacheDir: resolve(repoRoot, config.tts.cacheDir),
      loudnorm: config.tts.postProcess === 'loudnorm',
    }),
    store,
  });

  const server = serve({ fetch: radio.app.fetch, port: config.station.port }, (info) => {
    const now = getDayPartContext(new Date());
    console.log(`[station] ${config.station.name} 守护进程已启动：http://localhost:${info.port}`);
    console.log(`[station] 曲库 ${tracks.length} 首：${styleSummary}`);
    console.log(`[station] 此刻是${now.weekdayZh}${now.label}，${now.moodHint}。`);
  });

  radio.attachWs(server);
  radio.start();
}

main().catch((err) => {
  console.error('[station] 启动失败：', err);
  process.exit(1);
});
