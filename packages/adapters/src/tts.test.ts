import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMiniMaxTts, createTts } from './tts';

// ffprobe 需要真实音频文件，单元测试用假数据跑不通；mock 掉，只验证 TTS 逻辑。
vi.mock('./ffprobe', () => ({
  probeDurationMs: vi.fn(async () => 1234),
}));

/** 把一段文本变成 hex（模拟 MiniMax output_format=hex 的返回） */
function toHex(s: string): string {
  return Buffer.from(s, 'utf-8').toString('hex');
}

type FetchCall = { url: string; headers: Record<string, string>; body: unknown };

/** MiniMax t2a_v2 请求体形状（只声明本测试要断言的字段） */
type MiniMaxRequestBody = {
  model: string;
  stream: boolean;
  output_format: string;
  voice_setting: { voice_id: string; speed: number };
  audio_setting: { format: string };
};

function makeFetch(overrides: {
  status?: number;
  statusCode?: number;
  statusMsg?: string;
  audio?: string | null;
  dataNull?: boolean;
}): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers as Record<string, string> | undefined;
    if (rawHeaders) {
      for (const [k, v] of Object.entries(rawHeaders)) {
        headers[k.toLowerCase()] = String(v);
      }
    }
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, headers, body });
    const status = overrides.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return '';
      },
      async json() {
        if (overrides.dataNull) {
          return {
            base_resp: { status_code: overrides.statusCode ?? 0, status_msg: overrides.statusMsg },
            data: null,
          };
        }
        return {
          base_resp: { status_code: overrides.statusCode ?? 0, status_msg: overrides.statusMsg },
          data: { audio: overrides.audio ?? null },
        };
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const CACHE = mkdtempSync(join(tmpdir(), 'ambient-tts-'));

afterEach(() => {
  rmSync(CACHE, { recursive: true, force: true });
});

describe('createMiniMaxTts', () => {
  it('用 hex 音频写盘，并返回时长与缓存未命中', async () => {
    const sample = '周五的傍晚，天色暗得刚刚好。';
    const hex = toHex(sample);
    const { fetchImpl } = makeFetch({ audio: hex });
    const tts = createMiniMaxTts({
      apiKey: 'k',
      groupId: 'g',
      voice: 'female-tianmei',
      cacheDir: CACHE,
      loudnorm: false,
      fetchImpl,
    });

    const speech = await tts.synthesize(sample);

    expect(speech.cached).toBe(false);
    expect(speech.durationMs).toBeGreaterThan(0);
    expect(readFileSync(speech.filePath, 'utf-8')).toBe(sample);
  });

  it('请求带上 GroupId(query)、Bearer 鉴权与正确请求体', async () => {
    const { fetchImpl, calls } = makeFetch({ audio: toHex('hi') });
    const tts = createMiniMaxTts({
      apiKey: 'MY_KEY',
      groupId: 'MY_GROUP',
      voice: 'female-tianmei',
      model: 'speech-02-hd',
      speed: 1.1,
      cacheDir: CACHE,
      loudnorm: false,
      fetchImpl,
    });

    await tts.synthesize('hi');

    expect(calls).toHaveLength(1);
    const [call0] = calls;
    if (!call0) throw new Error('未捕获到 MiniMax 请求');
    const { authorization, 'content-type': contentType } = call0.headers;
    expect(call0.url).toContain('GroupId=');
    expect(call0.url).toContain(encodeURIComponent('MY_GROUP'));
    expect(authorization).toBe('Bearer MY_KEY');
    expect(contentType).toBe('application/json');
    const body = call0.body as MiniMaxRequestBody;
    expect(body.model).toBe('speech-02-hd');
    expect(body.stream).toBe(false);
    expect(body.output_format).toBe('hex');
    expect(body.voice_setting.voice_id).toBe('female-tianmei');
    expect(body.voice_setting.speed).toBe(1.1);
    expect(body.audio_setting.format).toBe('mp3');
  });

  it('命中缓存时不再请求远程接口', async () => {
    const hex = toHex('缓存测试');
    const { fetchImpl, calls } = makeFetch({ audio: hex });
    const tts = createMiniMaxTts({
      apiKey: 'k',
      groupId: 'g',
      voice: 'female-tianmei',
      cacheDir: CACHE,
      loudnorm: false,
      fetchImpl,
    });

    const first = await tts.synthesize('缓存测试');
    const second = await tts.synthesize('缓存测试');

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('HTTP 非 2xx 抛错', async () => {
    const { fetchImpl } = makeFetch({ status: 401, statusMsg: 'unauthorized' });
    const tts = createMiniMaxTts({
      apiKey: 'k',
      groupId: 'g',
      voice: 'female-tianmei',
      cacheDir: CACHE,
      loudnorm: false,
      fetchImpl,
    });
    await expect(tts.synthesize('x')).rejects.toThrow(/401/);
  });

  it('base_resp.status_code 非 0 抛错', async () => {
    const { fetchImpl } = makeFetch({ statusCode: 1001, statusMsg: 'bad voice' });
    const tts = createMiniMaxTts({
      apiKey: 'k',
      groupId: 'g',
      voice: 'female-tianmei',
      cacheDir: CACHE,
      loudnorm: false,
      fetchImpl,
    });
    await expect(tts.synthesize('x')).rejects.toThrow(/bad voice/);
  });

  it('返回空音频抛错', async () => {
    const { fetchImpl } = makeFetch({ audio: null });
    const tts = createMiniMaxTts({
      apiKey: 'k',
      groupId: 'g',
      voice: 'female-tianmei',
      cacheDir: CACHE,
      loudnorm: false,
      fetchImpl,
    });
    await expect(tts.synthesize('x')).rejects.toThrow(/空音频/);
  });

  it('data 为 null 时也抛错', async () => {
    const { fetchImpl } = makeFetch({ dataNull: true });
    const tts = createMiniMaxTts({
      apiKey: 'k',
      groupId: 'g',
      voice: 'female-tianmei',
      cacheDir: CACHE,
      loudnorm: false,
      fetchImpl,
    });
    await expect(tts.synthesize('x')).rejects.toThrow();
  });
});

describe('createTts 工厂', () => {
  const baseEnv: Record<string, string> = {
    MINIMAX_API_KEY: 'env-key',
    MINIMAX_GROUP_ID: 'env-group',
  };
  const resolveEnv = (n: string) => baseEnv[n];

  it('minimax provider 时从环境变量取 key / groupId 并调用 MiniMax', async () => {
    const hex = toHex('工厂测试');
    const { fetchImpl, calls } = makeFetch({ audio: hex });
    const tts = createTts({
      provider: 'minimax',
      postProcess: 'none',
      cacheDir: CACHE,
      edge: { voice: 'zh-CN-XiaoxuanNeural', rate: '-10%' },
      minimax: {
        voice: 'female-tianmei',
        model: 'speech-02-hd',
        speed: 1,
        apiKeyEnv: 'MINIMAX_API_KEY',
        groupIdEnv: 'MINIMAX_GROUP_ID',
      },
      resolveEnv,
      fetchImpl,
    });

    const speech = await tts.synthesize('工厂测试');
    expect(calls).toHaveLength(1);
    const [call0] = calls;
    if (!call0) throw new Error('未捕获到 MiniMax 请求');
    expect(call0.headers.authorization).toBe('Bearer env-key');
    expect(speech.durationMs).toBeGreaterThan(0);
  });

  it('edge-tts provider 时走 edge 分支（不调远程 fetch）', async () => {
    // edge 走 python 子进程，无网络；这里只验证工厂返回了可用的客户端且 synthesize 存在。
    const tts = createTts({
      provider: 'edge-tts',
      postProcess: 'loudnorm',
      cacheDir: CACHE,
      edge: { voice: 'zh-CN-XiaoxuanNeural', rate: '-10%' },
      minimax: {
        voice: 'female-tianmei',
        model: 'speech-02-hd',
        speed: 1,
        apiKeyEnv: 'MINIMAX_API_KEY',
        groupIdEnv: 'MINIMAX_GROUP_ID',
      },
      resolveEnv,
    });
    expect(typeof tts.synthesize).toBe('function');
  });
});
