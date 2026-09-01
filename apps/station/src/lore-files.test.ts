import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadLibraryLore, loadSpeechExamples } from './lore-files';

const dirs: string[] = [];

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lore-'));
  dirs.push(root);
  return root;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadLibraryLore', () => {
  it('读每个子文件夹的 lore.md 与 tracks.md；空目录不抛', () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'va11halla'));
    writeFileSync(join(root, 'va11halla', 'lore.md'), '格莱德市酒吧。', 'utf-8');
    writeFileSync(join(root, 'va11halla', 'tracks.md'), 'Last Call | 打烊点', 'utf-8');
    mkdirSync(join(root, 'cafe'));

    const entries = loadLibraryLore(root);

    expect(entries.some((entry) => entry.content.includes('格莱德市酒吧'))).toBe(true);
    expect(entries.some((entry) => entry.keys.includes('Last Call'))).toBe(true);
  });

  it('缺根目录或缺文件不抛', () => {
    const root = tmpRoot();
    expect(loadLibraryLore(join(root, 'missing'))).toEqual([]);
    mkdirSync(join(root, 'empty'));
    expect(() => loadLibraryLore(root)).not.toThrow();
    expect(loadLibraryLore(root)).toEqual([]);
  });
});

describe('loadSpeechExamples', () => {
  it('缺文件返回空字符串', () => {
    expect(loadSpeechExamples(join(tmpdir(), 'no-such-speech-examples.md'))).toBe('');
  });
});
