/**
 * edge-tts 适配器（D8）：文本 → 语音文件。
 * 流水线：edge-tts 合成 → ffmpeg loudnorm 响度归一（FR-045）→ 文本哈希缓存。
 * 外部进程（python -m edge_tts / ffmpeg）都在 30s 超时与失败抛错内，由组装层静默降级。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SynthesizedSpeech, TtsClient } from '@ambient-radio/core';
import { ffmpegPath } from './ffmpeg-bin';
import { probeDurationMs } from './ffprobe';

export interface EdgeTtsOptions {
  voice: string;
  /** edge-tts rate 格式，如 "-10%" */
  rate: string;
  cacheDir: string;
  /** ffmpeg loudnorm 归一（FR-045 音量稳定） */
  loudnorm?: boolean;
  timeoutMs?: number;
}

const PROC_TIMEOUT_MS = 30_000;

function runProc(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`${cmd} 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 300)}`));
      }
    });
  });
}

export function createEdgeTts(options: EdgeTtsOptions): TtsClient {
  const { voice, rate, cacheDir, loudnorm = true, timeoutMs = PROC_TIMEOUT_MS } = options;

  return {
    async synthesize(text: string): Promise<SynthesizedSpeech> {
      await mkdir(cacheDir, { recursive: true });
      const hash = createHash('sha256')
        .update(`${voice}|${rate}|${text}`)
        .digest('hex')
        .slice(0, 16);
      const finalPath = join(cacheDir, `${hash}.mp3`);

      if (existsSync(finalPath)) {
        return { filePath: finalPath, durationMs: await probeDurationMs(finalPath), cached: true };
      }

      // 1) edge-tts 合成原始音频
      const rawPath = join(cacheDir, `${hash}.raw.mp3`);
      await runProc(
        'python',
        [
          '-m',
          'edge_tts',
          '--voice',
          voice,
          `--rate=${rate}`,
          '--text',
          text,
          '--write-media',
          rawPath,
        ],
        timeoutMs,
      );

      // 2) loudnorm 响度归一
      if (loudnorm) {
        const normPath = join(cacheDir, `${hash}.norm.mp3`);
        await runProc(
          ffmpegPath(),
          ['-y', '-i', rawPath, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-q:a', '2', normPath],
          timeoutMs,
        );
        await rm(rawPath, { force: true });
        await rename(normPath, finalPath);
      } else {
        await rename(rawPath, finalPath);
      }

      return { filePath: finalPath, durationMs: await probeDurationMs(finalPath), cached: false };
    },
  };
}
