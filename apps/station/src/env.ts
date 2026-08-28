/**
 * .env 加载（组装层职责）：把仓库根 .env 的 KEY=VALUE 注入 process.env。
 * 只填缺失项，不覆盖已有环境变量（Docker 场景环境变量优先）。
 */
import { existsSync, readFileSync } from 'node:fs';
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
