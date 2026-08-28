/**
 * 曲库扫描命令：pnpm scan
 * config/library/<子风格>/*.mp3 → SQLite（tracks 表，幂等 upsert）。
 * 新增歌曲 / 改标签 = 跑一次本命令；文件夹名即子风格标签（D3）。
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createStore } from '@ambient-radio/adapters';
import { loadStationConfig } from './config';
import { loadEnvFile } from './env';
import { scanLibrary } from './library';
import { findRepoRoot } from './paths';

async function main(): Promise<void> {
  loadEnvFile();
  const repoRoot = findRepoRoot();
  const config = loadStationConfig();
  const libraryRoot = resolve(repoRoot, config.library.root);
  const dbPath = resolve(repoRoot, 'data', 'station.db');
  mkdirSync(dirname(dbPath), { recursive: true });

  const tracks = await scanLibrary(libraryRoot);
  const store = createStore(dbPath);
  store.upsertTracks(tracks);

  console.log(`[scan] 曲库 ${tracks.length} 首已入库：${dbPath}`);
  const byStyle = new Map<string, number>();
  for (const t of tracks) {
    for (const s of t.styles) byStyle.set(s, (byStyle.get(s) ?? 0) + 1);
  }
  for (const [style, count] of byStyle) {
    console.log(`[scan]   ${style}: ${count}`);
  }
}

main().catch((err) => {
  console.error('[scan] 失败：', err);
  process.exit(1);
});
