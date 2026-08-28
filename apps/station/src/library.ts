/** 曲库扫描：config/library/<子风格>/*.mp3 → Track[]（文件夹名即标签，D3） */
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { probeDurationMs } from '@ambient-radio/adapters';
import type { Track } from '@ambient-radio/core';

const AUDIO_EXT = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.wav', '.opus']);

function trackIdOf(root: string, absPath: string): string {
  return createHash('md5').update(relative(root, absPath)).digest('hex').slice(0, 12);
}

export async function scanLibrary(root: string): Promise<Track[]> {
  const tracks: Track[] = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const dir of entries) {
    if (!dir.isDirectory()) continue;
    const styleDir = join(root, dir.name);
    const files = await readdir(styleDir, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !AUDIO_EXT.has(extname(file.name).toLowerCase())) continue;
      const absPath = join(styleDir, file.name);
      const durationMs = await probeDurationMs(absPath).catch(() => null);
      if (durationMs === null) {
        // ER-004 预防：无法探测时长的文件不入库
        console.warn(`[library] 无法读取时长，跳过：${dir.name}/${file.name}`);
        continue;
      }
      tracks.push({
        id: trackIdOf(root, absPath),
        path: relative(root, absPath).replaceAll('\\', '/'),
        title: basename(file.name, extname(file.name)),
        artist: null,
        durationMs,
        styles: [dir.name],
        enabled: true,
        addedAt: Date.now(),
      });
    }
  }
  return tracks;
}
