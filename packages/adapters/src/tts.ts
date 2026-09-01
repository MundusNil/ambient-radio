/**
 * TTS 适配器（D8：候选池随时换）。
 * 两种实现共用一条流水线：哈希缓存 → 产出原始音频 → 可选 ffmpeg loudnorm 响度归一（FR-045）→ probe 时长。
 * - edge-tts：python -m edge_tts 子进程合成（免费，D8 默认）。
 * - minimax：MiniMax 同步 T2A HTTP 接口（付费，音质更可控，用户可选）。
 * 任一外部依赖失败都抛错，由组装层（radio.ts）按沉默保底（ER 哲学）静默丢弃该段落。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SynthesizedSpeech, TtsClient } from '@ambient-radio/core';
import { ffmpegPath } from './ffmpeg-bin';
import { probeDurationMs } from './ffprobe';

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

/** 缓存文件名（哈希前 16 位）；把 provider/音色/参数都并进 key，避免跨供应商碰撞 */
function cacheHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * 共享流水线：缓存命中直接返回；否则由 produceRaw 把原始音频写到 rawPath，
 * 再可选 loudnorm 归一，最后落定 finalPath 并 probe 时长。
 * edge 与 minimax 只差「produceRaw 怎么拿到原始音频」，其余步骤完全共用。
 */
async function runCachedPipeline(params: {
  cacheDir: string;
  hash: string;
  loudnorm: boolean;
  timeoutMs: number;
  produceRaw: (rawPath: string) => Promise<void>;
}): Promise<SynthesizedSpeech> {
  const { cacheDir, hash, loudnorm, timeoutMs, produceRaw } = params;
  await mkdir(cacheDir, { recursive: true });
  const finalPath = join(cacheDir, `${hash}.mp3`);

  if (existsSync(finalPath)) {
    return {
      filePath: finalPath,
      durationMs: await probeDurationMs(finalPath),
      cached: true,
    };
  }

  const rawPath = join(cacheDir, `${hash}.raw.mp3`);
  await produceRaw(rawPath);

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

  return {
    filePath: finalPath,
    durationMs: await probeDurationMs(finalPath),
    cached: false,
  };
}

// ---------------------------------------------------------------------------
// edge-tts（免费，D8 默认）
// ---------------------------------------------------------------------------

export interface EdgeTtsOptions {
  voice: string;
  /** edge-tts rate 格式，如 "-10%" */
  rate: string;
  cacheDir: string;
  /** ffmpeg loudnorm 归一（FR-045 音量稳定） */
  loudnorm?: boolean;
  timeoutMs?: number;
}

export function createEdgeTts(options: EdgeTtsOptions): TtsClient {
  const { voice, rate, cacheDir, loudnorm = true, timeoutMs = PROC_TIMEOUT_MS } = options;

  return {
    synthesize(text: string): Promise<SynthesizedSpeech> {
      const hash = cacheHash([`edge:${voice}`, rate, text]);
      return runCachedPipeline({
        cacheDir,
        hash,
        loudnorm,
        timeoutMs,
        produceRaw: (rawPath) =>
          runProc(
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
          ),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// minimax（付费可选，音质更可控）
// ---------------------------------------------------------------------------

export interface MiniMaxTtsOptions {
  /** MiniMax API key（Bearer 鉴权） */
  apiKey: string;
  /** MiniMax GroupId（放进 query 参数 GroupId） */
  groupId: string;
  /** 系统音色 ID，如 Chinese_wenrounvxing（温柔女性） */
  voice: string;
  model?: string;
  /** 语速 0.5~2.0，默认 1 */
  speed?: number;
  /** 音量 0~10，默认 1 */
  vol?: number;
  /** 音调 -12~12，默认 0 */
  pitch?: number;
  cacheDir: string;
  loudnorm?: boolean;
  /** 备用接口地址（如 https://api-bj.minimaxi.com/v1/t2a_v2） */
  baseUrl?: string;
  timeoutMs?: number;
  /** 注入 fetch 便于单测（默认全局 fetch） */
  fetchImpl?: typeof fetch;
}

export function createMiniMaxTts(options: MiniMaxTtsOptions): TtsClient {
  const {
    apiKey,
    groupId,
    voice,
    model = 'speech-02-hd',
    speed = 1,
    vol = 1,
    pitch = 0,
    cacheDir,
    loudnorm = true,
    baseUrl = 'https://api.minimaxi.com/v1/t2a_v2',
    timeoutMs = PROC_TIMEOUT_MS,
    fetchImpl = fetch,
  } = options;

  return {
    async synthesize(text: string): Promise<SynthesizedSpeech> {
      const hash = cacheHash([`minimax:${model}:${voice}`, String(speed), text]);
      return runCachedPipeline({
        cacheDir,
        hash,
        loudnorm,
        timeoutMs,
        produceRaw: async (rawPath) => {
          const sep = baseUrl.includes('?') ? '&' : '?';
          const url = `${baseUrl}${sep}GroupId=${encodeURIComponent(groupId)}`;
          const res = await fetchImpl(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              text,
              stream: false,
              output_format: 'hex',
              voice_setting: { voice_id: voice, speed, vol, pitch },
              audio_setting: {
                sample_rate: 32000,
                bitrate: 128_000,
                format: 'mp3',
                channel: 1,
              },
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`MiniMax TTS HTTP ${res.status}: ${body.slice(0, 300)}`);
          }
          const data = (await res.json()) as {
            base_resp?: { status_code?: number; status_msg?: string };
            data?: { audio?: string } | null;
          };
          if (data.base_resp?.status_code !== 0) {
            throw new Error(`MiniMax TTS 失败：${data.base_resp?.status_msg ?? '未知错误'}`);
          }
          const audioHex = data.data?.audio;
          if (!audioHex) throw new Error('MiniMax TTS 返回空音频');
          // 文档明确 output_format=hex 时 data.audio 为 hex 编码（非 base64）
          await writeFile(rawPath, Buffer.from(audioHex, 'hex'));
        },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 工厂：按 provider 选择实现（组装层接线用）
// ---------------------------------------------------------------------------

export type TtsProviderName = 'edge-tts' | 'minimax';

export interface CreateTtsParams {
  provider: TtsProviderName;
  postProcess: string;
  /** 已解析为绝对路径的缓存目录 */
  cacheDir: string;
  edge: { voice: string; rate: string };
  minimax: {
    voice: string;
    apiKeyEnv: string;
    groupIdEnv: string;
    model: string;
    speed: number;
  };
  /** 从环境变量取值（注入以便测试；运行时传 process.env 的取值函数） */
  resolveEnv: (name: string) => string | undefined;
  /** 注入 fetch 便于单测（仅 minimax 分支使用；默认全局 fetch） */
  fetchImpl?: typeof fetch;
}

export function createTts(params: CreateTtsParams): TtsClient {
  const loudnorm = params.postProcess === 'loudnorm';

  if (params.provider === 'minimax') {
    const { voice, apiKeyEnv, groupIdEnv, model, speed } = params.minimax;
    const apiKey = params.resolveEnv(apiKeyEnv) ?? '';
    const groupId = params.resolveEnv(groupIdEnv) ?? '';
    if (!apiKey || !groupId) {
      console.warn(
        `[tts] 未配置 MiniMax 凭据（环境变量 ${apiKeyEnv} / ${groupIdEnv}）：梦可将保持沉默（音乐照常）。`,
      );
    }
    return createMiniMaxTts({
      apiKey,
      groupId,
      voice,
      model,
      speed,
      cacheDir: params.cacheDir,
      loudnorm,
      fetchImpl: params.fetchImpl,
    });
  }

  return createEdgeTts({
    voice: params.edge.voice,
    rate: params.edge.rate,
    cacheDir: params.cacheDir,
    loudnorm,
  });
}
