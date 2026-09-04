/**
 * .env 加载（组装层职责）：把仓库根 .env 的 KEY=VALUE 注入 process.env。
 * 只填缺失项，不覆盖已有环境变量（Docker 场景环境变量优先）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from './paths';

export function loadEnvFile(): void {
  const envPath = join(findRepoRoot(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * 写入 .env（维护者在本机设置面板改密钥时调用）：
 * 替换已有 KEY=VALUE 行、缺失则追加；注释、顺序、行尾风格全部保留。
 * 调用方负责值已清洗（无换行/控制字符）——见 keys.ts。
 */
export function upsertEnvFile(envPath: string, entries: Record<string, string>): void {
  const raw = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.length > 0 ? raw.replace(/\r?\n$/, '').split(/\r?\n/) : [];
  const pending = new Map(Object.entries(entries));
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(lines[i] ?? '');
    const key = m?.[1];
    if (key !== undefined && pending.has(key)) {
      lines[i] = `${key}=${pending.get(key)}`;
      pending.delete(key);
    }
  }
  if (pending.size > 0) {
    for (const [key, value] of pending) lines.push(`${key}=${value}`);
  }
  writeFileSync(envPath, `${lines.join(eol)}${eol}`, 'utf-8');
}
