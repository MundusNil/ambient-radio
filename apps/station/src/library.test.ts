import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mock-radio/adapters', () => ({
  probeDurationMs: vi.fn(async () => 180_000),
}));

import { cleanTitle, scanLibrary } from './library';

describe('cleanTitle · 入库去掉文件名开头的曲目序号', () => {
  it('去掉「01. Title」这类 OST 序号', () => {
    expect(cleanTitle('01. Lily.flac')).toBe('Lily');
    expect(cleanTitle('07. Holy Land.flac')).toBe('Holy Land');
    expect(cleanTitle('01. Mr. Blue.mp3')).toBe('Mr. Blue');
  });

  it('去掉碟号-曲号与破折号序号', () => {
    expect(cleanTitle('1-01 Hopes and Dreams.mp3')).toBe('Hopes and Dreams');
    expect(cleanTitle('01 - A Fine Glass of Red Wine.mp3')).toBe('A Fine Glass of Red Wine');
    expect(cleanTitle('[01] Title.ogg')).toBe('Title');
  });

  it('零填充空格序号去掉，本身是歌名的数字保留', () => {
    expect(cleanTitle('01 A Fine Glass of Red Wine.mp3')).toBe('A Fine Glass of Red Wine');
    expect(cleanTitle('7 rings.mp3')).toBe('7 rings');
    expect(cleanTitle('1999.flac')).toBe('1999');
    expect(cleanTitle('2077 Night City.wav')).toBe('2077 Night City');
    expect(cleanTitle('Lifebeat of Lilim (Instrumental Version).flac')).toBe(
      'Lifebeat of Lilim (Instrumental Version)',
    );
  });
});

describe('scanLibrary · 任意嵌套都入库', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function library(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ar-lib-'));
    dirs.push(dir);
    return dir;
  }

  function touch(root: string, rel: string): void {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, '');
  }

  it('根目录、一层文件夹、多层嵌套的音频都扫进去', async () => {
    const root = library();
    touch(root, 'root-song.mp3');
    touch(root, 'ENDER LILIES/01. Lily.flac');
    touch(root, 'ENDER LILIES/ost/disc1/02. Prologue.flac');
    touch(root, 'VA-11 HALL-A/soundtrack/night/a drink.ogg');
    touch(root, 'ENDER LILIES/README.md');
    touch(root, '.hidden/secret.mp3');
    touch(root, 'ENDER LILIES/.cache/skip.mp3');

    const tracks = await scanLibrary(root);
    const byPath = Object.fromEntries(tracks.map((t) => [t.path, t]));

    expect(Object.keys(byPath).sort()).toEqual([
      'ENDER LILIES/01. Lily.flac',
      'ENDER LILIES/ost/disc1/02. Prologue.flac',
      'VA-11 HALL-A/soundtrack/night/a drink.ogg',
      'root-song.mp3',
    ]);
    expect(byPath['root-song.mp3']?.styles).toEqual([]);
    expect(byPath['ENDER LILIES/01. Lily.flac']?.title).toBe('Lily');
    expect(byPath['ENDER LILIES/01. Lily.flac']?.styles).toEqual(['ENDER LILIES']);
    expect(byPath['ENDER LILIES/ost/disc1/02. Prologue.flac']?.title).toBe('Prologue');
    expect(byPath['ENDER LILIES/ost/disc1/02. Prologue.flac']?.styles).toEqual(['ENDER LILIES']);
    expect(byPath['VA-11 HALL-A/soundtrack/night/a drink.ogg']?.styles).toEqual(['VA-11 HALL-A']);
  });
});
