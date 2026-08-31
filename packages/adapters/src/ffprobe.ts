/** ffprobe：读音频时长（本地 ffmpeg 工具链，D3 曲库与 TTS 共用） */
import { spawn } from 'node:child_process';
import { ffprobePath } from './ffmpeg-bin';

export function probeDurationMs(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath(), [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '--',
      file,
    ]);
    let out = '';
    proc.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exit ${code}`));
        return;
      }
      try {
        const duration = Number.parseFloat(JSON.parse(out).format?.duration ?? '');
        if (Number.isFinite(duration) && duration > 0) {
          resolve(Math.round(duration * 1000));
        } else {
          reject(new Error('invalid duration'));
        }
      } catch (err) {
        reject(err);
      }
    });
  });
}
