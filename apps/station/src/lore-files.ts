import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type LoreEntry, parseLoreMarkdown, parseTracksMarkdown } from '@ambient-radio/core';

export function loadLibraryLore(libraryRoot: string): LoreEntry[] {
  const entries: LoreEntry[] = [];
  if (!existsSync(libraryRoot)) return entries;
  for (const dir of readdirSync(libraryRoot, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const style = dir.name;
    const lorePath = join(libraryRoot, style, 'lore.md');
    const tracksPath = join(libraryRoot, style, 'tracks.md');
    if (existsSync(lorePath)) {
      entries.push(parseLoreMarkdown(style, readFileSync(lorePath, 'utf-8')));
    }
    if (existsSync(tracksPath)) {
      entries.push(...parseTracksMarkdown(readFileSync(tracksPath, 'utf-8')));
    }
  }
  return entries;
}

export function loadSpeechExamples(path: string): string {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8').trim();
}
