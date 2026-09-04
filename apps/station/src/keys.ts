/**
 * 密钥服务（组装层）：维护者在本机设置面板配置 MiniMax / 豆包密钥 → 写入仓库根 .env。
 * 安全边界：
 *  - 白名单只来自 station.config.json 声明的 env 名（调电台=改配置，不硬编码）；
 *  - 状态接口只回「是否已配置」，真实值永不出服务器；
 *  - 写入前清洗控制字符/换行（防注入额外 env 行）。
 */
import { upsertEnvFile } from './env';

export interface KeyDef {
  /** .env 里的变量名（同时是接口字段名） */
  env: string;
  /** 面板上的展示名 */
  label: string;
  /** 面板分组标题（同厂商字段放一组） */
  group: string;
}

/** 单个密钥的对外状态：只泄露「有/无」与长度，真实值永不出服务器 */
export interface KeyStatus {
  env: string;
  label: string;
  group: string;
  configured: boolean;
  /** 按真实值长度生成的掩码：点数 = 密钥长度，一眼可辨是否已配置/改过 */
  masked: string;
}

const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const MAX_VALUE_LEN = 512;
/** API key 均为可打印 ASCII（无空格）；掩码字符（•）等一律拒绝 */
const PRINTABLE_ASCII_RE = /^[\x21-\x7e]+$/;

/** 清洗值：去首尾空白、剔除控制字符（换行会被 .env 解析成另一行，必须剔除） */
function sanitizeValue(raw: string): string {
  return raw.replace(/\p{Cc}/gu, '').trim();
}

export function keyStatus(defs: readonly KeyDef[]): KeyStatus[] {
  return defs.map((def) => {
    const value = process.env[def.env] ?? '';
    return {
      env: def.env,
      label: def.label,
      group: def.group,
      configured: value.length > 0,
      masked: '•'.repeat(value.length),
    };
  });
}

export interface ApplyKeysResult {
  ok: true;
  status: KeyStatus[];
}

/**
 * 应用密钥更新：校验白名单 → 清洗 → 写 .env → 同步 process.env（本次进程立即生效）。
 * 空值 = 跳过（前端只在用户输入了新值时提交；清空密钥不是面板职责）。
 * 未知变量名 / 超长 / 清洗后为空 → 抛错（路由转 400）。
 */
export function applyKeys(
  envPath: string,
  defs: readonly KeyDef[],
  updates: Record<string, string>,
): ApplyKeysResult {
  const allowed: Record<string, true> = {};
  for (const def of defs) allowed[def.env] = true;

  const entries: Record<string, string> = {};
  for (const [name, raw] of Object.entries(updates)) {
    if (!ENV_NAME_RE.test(name) || allowed[name] !== true) {
      throw new Error(`不允许写入的环境变量：${name}`);
    }
    if (typeof raw !== 'string') throw new Error(`${name} 的值必须是字符串`);
    const value = sanitizeValue(raw);
    if (value.length === 0) continue;
    if (!PRINTABLE_ASCII_RE.test(value))
      throw new Error(`${name} 含非法字符（仅允许 ASCII 可见字符）`);
    if (value.length > MAX_VALUE_LEN) throw new Error(`${name} 超过 ${MAX_VALUE_LEN} 字符上限`);
    entries[name] = value;
  }

  if (Object.keys(entries).length > 0) {
    upsertEnvFile(envPath, entries);
    for (const [name, value] of Object.entries(entries)) process.env[name] = value;
  }
  return { ok: true, status: keyStatus(defs) };
}

/** 面板可配置的密钥白名单：只列 station.config.json 实际声明的 env 名（铁律 4：不硬编码业务决定） */
export function keyDefsFor(config: {
  llm: { apiKeyEnv: string };
  tts: { provider: 'edge-tts' | 'minimax'; minimax: { apiKeyEnv: string; groupIdEnv: string } };
}): KeyDef[] {
  const defs: KeyDef[] = [
    { env: config.llm.apiKeyEnv, group: '火山引擎（豆包）', label: '方舟 API Key' },
  ];
  if (config.tts.provider === 'minimax') {
    defs.push(
      { env: config.tts.minimax.apiKeyEnv, group: 'MiniMax', label: 'API Key' },
      { env: config.tts.minimax.groupIdEnv, group: 'MiniMax', label: 'GroupId' },
    );
  }
  return defs;
}
