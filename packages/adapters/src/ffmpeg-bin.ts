/**
 * ffmpeg / ffprobe 可执行文件定位。
 *
 * 优先级：环境变量 → 仓库内 tools/ffmpeg → 系统 PATH。
 * 仓库内自带的二进制让用户「克隆即可跑」，无需自己装 FFmpeg。
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function repoRoot(): string {
  // packages/adapters/src → 仓库根
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

/** 按候选顺序找到第一个存在的可执行文件，都没找到返回 undefined（交给 PATH） */
function pickCandidates(names: string[], envVar: string): string | undefined {
  const fromEnv = process.env[envVar];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const dirs = [join(repoRoot(), 'tools', 'ffmpeg'), join(process.cwd(), 'tools', 'ffmpeg')];
  for (const dir of dirs) {
    for (const name of names) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const EXE = process.platform === 'win32' ? '.exe' : '';

let cachedFfmpeg: string | undefined;
let cachedFfprobe: string | undefined;

/** ffmpeg 路径；仓库内不存在时回退到 PATH 上的 `ffmpeg` */
export function ffmpegPath(): string {
  cachedFfmpeg ??= pickCandidates(['ffmpeg', `ffmpeg${EXE}`], 'FFMPEG_PATH');
  return cachedFfmpeg ?? 'ffmpeg';
}

/** ffprobe 路径；仓库内不存在时回退到 PATH 上的 `ffprobe` */
export function ffprobePath(): string {
  cachedFfprobe ??= pickCandidates(['ffprobe', `ffprobe${EXE}`], 'FFPROBE_PATH');
  return cachedFfprobe ?? 'ffprobe';
}
