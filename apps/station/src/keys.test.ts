import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyKeys, type KeyDef, keyDefsFor, keyStatus } from './keys';

const DEFS: KeyDef[] = [
  { env: 'TEST_ARK_KEY', label: '方舟 API Key', group: '火山引擎（豆包）' },
  { env: 'TEST_MINIMAX_KEY', label: 'MiniMax API Key', group: 'MiniMax' },
];

describe('upsertEnvFile · 经 applyKeys 写 .env', () => {
  const dirs: string[] = [];
  const touchedEnvKeys: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    for (const key of touchedEnvKeys.splice(0)) delete process.env[key];
  });

  function envFile(content?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'keys-test-'));
    dirs.push(dir);
    const path = join(dir, '.env');
    if (content !== undefined) writeFileSync(path, content, 'utf-8');
    return path;
  }

  it('已有键：原位替换，注释与顺序保留', () => {
    const path = envFile(['# 注释保留', 'OTHER=x', 'TEST_ARK_KEY=old', '', 'TAIL=y'].join('\n'));
    touchedEnvKeys.push('TEST_ARK_KEY');
    const res = applyKeys(path, DEFS, { TEST_ARK_KEY: 'new-value' });
    const lines = readFileSync(path, 'utf-8').split(/\r?\n/);
    expect(lines[0]).toBe('# 注释保留');
    expect(lines[1]).toBe('OTHER=x');
    expect(lines[2]).toBe('TEST_ARK_KEY=new-value');
    expect(lines[4]).toBe('TAIL=y');
    expect(res.status.find((s) => s.env === 'TEST_ARK_KEY')?.configured).toBe(true);
  });

  it('缺失键：追加到文件末尾', () => {
    const path = envFile('OTHER=x\n');
    touchedEnvKeys.push('TEST_MINIMAX_KEY');
    applyKeys(path, DEFS, { TEST_MINIMAX_KEY: 'mk' });
    expect(readFileSync(path, 'utf-8')).toBe('OTHER=x\nTEST_MINIMAX_KEY=mk\n');
  });

  it('文件不存在：创建', () => {
    const path = envFile();
    touchedEnvKeys.push('TEST_ARK_KEY');
    applyKeys(path, DEFS, { TEST_ARK_KEY: 'a' });
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe('TEST_ARK_KEY=a\n');
  });

  it('同步 process.env：本次进程立即生效', () => {
    const path = envFile('');
    touchedEnvKeys.push('TEST_ARK_KEY');
    applyKeys(path, DEFS, { TEST_ARK_KEY: 'live' });
    expect(process.env.TEST_ARK_KEY).toBe('live');
  });

  it('拒绝白名单外的变量名', () => {
    const path = envFile('');
    expect(() => applyKeys(path, DEFS, { PATH: '/tmp/evil' })).toThrow(/不允许/);
    expect(() => applyKeys(path, DEFS, { lowercase_key: 'x' })).toThrow(/不允许/);
  });

  it('剔除换行与控制字符（防注入额外 env 行）', () => {
    const path = envFile('');
    touchedEnvKeys.push('TEST_ARK_KEY');
    applyKeys(path, DEFS, { TEST_ARK_KEY: 'a\nEVIL=1\r\nb' });
    expect(readFileSync(path, 'utf-8')).toBe('TEST_ARK_KEY=aEVIL=1b\n');
    expect(process.env.EVIL).toBeUndefined();
  });

  it('非 ASCII 值拒绝（掩码字符 • 等不可能落进 .env）', () => {
    const path = envFile('');
    expect(() => applyKeys(path, DEFS, { TEST_ARK_KEY: '••••••••' })).toThrow(/非法字符/);
    expect(readFileSync(path, 'utf-8')).toBe('');
  });

  it('空值跳过：不写文件也不报错', () => {
    const path = envFile('OTHER=x\n');
    const res = applyKeys(path, DEFS, { TEST_ARK_KEY: '   ' });
    expect(readFileSync(path, 'utf-8')).toBe('OTHER=x\n');
    expect(res.ok).toBe(true);
  });

  it('超长值拒绝', () => {
    const path = envFile('');
    expect(() => applyKeys(path, DEFS, { TEST_ARK_KEY: 'k'.repeat(513) })).toThrow(/上限/);
  });
});

describe('keyStatus · 只暴露有/无', () => {
  afterEach(() => {
    delete process.env.TEST_ARK_KEY;
  });

  it('configured 反映 process.env 当前值；不泄露值本身', () => {
    delete process.env.TEST_ARK_KEY;
    const before = keyStatus(DEFS);
    expect(before.find((s) => s.env === 'TEST_ARK_KEY')?.configured).toBe(false);
    process.env.TEST_ARK_KEY = 'secret-value';
    const after = keyStatus(DEFS);
    expect(after.find((s) => s.env === 'TEST_ARK_KEY')?.configured).toBe(true);
    expect(JSON.stringify(after)).not.toContain('secret-value');
  });

  it('masked 点数跟随真实长度', () => {
    process.env.TEST_ARK_KEY = '12345';
    expect(keyStatus(DEFS).find((s) => s.env === 'TEST_ARK_KEY')?.masked).toBe('•••••');
    process.env.TEST_ARK_KEY = 'k'.repeat(100);
    expect(keyStatus(DEFS).find((s) => s.env === 'TEST_ARK_KEY')?.masked).toBe('•'.repeat(100));
  });
});

describe('keyDefsFor · 白名单来自配置', () => {
  const base = {
    llm: { apiKeyEnv: 'ARK_API_KEY' },
    tts: {
      provider: 'minimax' as const,
      minimax: { apiKeyEnv: 'MINIMAX_API_KEY', groupIdEnv: 'MINIMAX_GROUP_ID' },
    },
  };

  it('minimax：豆包 + MiniMax key + GroupId 三项', () => {
    expect(keyDefsFor(base).map((d) => d.env)).toEqual([
      'ARK_API_KEY',
      'MINIMAX_API_KEY',
      'MINIMAX_GROUP_ID',
    ]);
  });

  it('edge-tts：只有豆包一项', () => {
    expect(
      keyDefsFor({ ...base, tts: { ...base.tts, provider: 'edge-tts' } }).map((d) => d.env),
    ).toEqual(['ARK_API_KEY']);
  });
});
