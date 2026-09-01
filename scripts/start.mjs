/**
 * 一键启动：环境体检 → 必要时扫描曲库 → 同时拉起电台守护进程与收音机面板。
 *
 * 用户只需两条命令：pnpm install && pnpm start
 * 直接 spawn node 执行真实 JS 入口，不依赖 pnpm 子命令（绕开 PATH 问题）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_EXT = /\.(flac|mp3|wav|ogg|m4a|aac)$/i;

const CYAN = '\u001b[36m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const RED = '\u001b[31m';
const OFF = '\u001b[0m';
const cy = (s) => CYAN + s + OFF;
const gr = (s) => GREEN + s + OFF;
const ye = (s) => YELLOW + s + OFF;
const rd = (s) => RED + s + OFF;
const OK = gr('[OK]');

const warnings = [];
const blockers = [];

function resolveBin(pkg, entry) {
  const pnpmRoot = join(ROOT, 'node_modules', '.pnpm');
  if (!existsSync(pnpmRoot)) return undefined;
  const prefix = `${pkg.replace('/', '+')}@`;
  for (const dir of readdirSync(pnpmRoot)) {
    if (!dir.startsWith(prefix)) continue;
    const p = join(pnpmRoot, dir, 'node_modules', pkg, entry);
    if (existsSync(p)) return p;
  }
  return undefined;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { ok: r.status === 0, out: String(r.stdout ?? '') + String(r.stderr ?? '') };
}

function listDir(p) {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

console.log(cy('\n[1/3] 环境体检'));

const major = Number(process.versions.node.split('.')[0]);
if (major >= 22) console.log(`  ${OK} Node ${process.versions.node}`);
else blockers.push(`Node 版本过低（当前 ${process.versions.node}），需要 >= 22`);

const localFfmpeg = join(ROOT, 'tools', 'ffmpeg', 'ffmpeg.exe');
const localFfprobe = join(ROOT, 'tools', 'ffmpeg', 'ffprobe.exe');
const hasLocalFf = existsSync(localFfmpeg) && existsSync(localFfprobe);
const onPath = run(process.platform === 'win32' ? 'where' : 'which', ['ffprobe']).ok;
if (hasLocalFf) console.log(`  ${OK} ffmpeg（仓库自带）`);
else if (onPath) console.log(`  ${OK} ffmpeg（系统 PATH）`);
else blockers.push('缺少 ffprobe/ffmpeg：把两个 exe 放进 tools/ffmpeg/，或安装到系统 PATH');

// 语音默认走 MiniMax（云端 TTS，无需本地 Python/edge-tts）；如改回 edge-tts 再按需在 .env 配本地环境。
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  const envTxt = readFileSync(envPath, 'utf8');
  if (/sk-your-|your-key|changeme/i.test(envTxt))
    warnings.push('.env 里的 API key 还是占位符，梦可会保持沉默（音乐照常播放）');
  else console.log(`  ${OK} .env 已配置`);
} else {
  const tpl = join(ROOT, '.env.example');
  if (existsSync(tpl)) {
    copyFileSync(tpl, envPath);
    warnings.push('已生成 .env，请填入 DEEPSEEK_API_KEY，否则梦可会保持沉默（音乐照常播放）');
  } else blockers.push('缺少 .env 与 .env.example');
}

console.log(cy('\n[2/3] 曲库'));

const libRoot = join(ROOT, 'config', 'library');
let audioCount = 0;
for (const dir of listDir(libRoot)) {
  const full = join(libRoot, dir);
  let st;
  try {
    st = statSync(full);
  } catch {
    continue;
  }
  if (!st.isDirectory()) continue;
  for (const f of listDir(full)) if (AUDIO_EXT.test(f)) audioCount += 1;
}
if (audioCount === 0) blockers.push('曲库是空的。把音乐按风格放进 config/library/<风格名>/');
else console.log(`  ${OK} 找到 ${audioCount} 个音频文件`);

if (blockers.length > 0) {
  console.log(`\n${rd('无法启动：')}`);
  for (const b of blockers) console.log(`  ${rd('[X]')} ${b}`);
  process.exit(1);
}

const tsx = resolveBin('tsx', join('dist', 'cli.mjs'));
if (tsx && audioCount > 0) {
  const inDb = countTracks(join(ROOT, 'data', 'station.db'));
  if (inDb === audioCount) {
    console.log(`  ${OK} 数据库已是最新（${inDb} 首）`);
  } else {
    console.log(`  曲库 ${audioCount} 首 / 数据库 ${inDb} 首 → 正在扫描入库...`);
    const r = run(process.execPath, [tsx, join('apps', 'station', 'src', 'scan.ts')], {
      cwd: ROOT,
    });
    if (r.ok) console.log(`  ${OK} 入库完成`);
    else console.log(`  ${ye('[!]')} 扫描未完全成功，电台仍会启动：\n${r.out.slice(-300)}`);
  }
}

function countTracks(dbPath) {
  if (!existsSync(dbPath)) return -1;
  try {
    const req = createRequire(join(ROOT, 'packages', 'adapters', 'package.json'));
    const Database = req('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT COUNT(*) AS c FROM tracks').get();
    db.close();
    return row.c;
  } catch {
    return -1;
  }
}

if (process.argv.includes('--check')) {
  if (warnings.length === 0) console.log(`\n${gr('体检通过，可以启动。')}\n`);
  else {
    console.log(ye('\n需要你处理：'));
    for (const w of warnings) console.log(`  ${ye('[!]')} ${w}`);
    console.log('');
  }
  process.exit(0);
}

console.log(cy('\n[3/3] 启动'));

const node = process.execPath;
const vite = resolveBin('vite', join('bin', 'vite.js'));
if (!tsx || !vite) {
  console.log(rd('缺少 tsx 或 vite，请先运行 pnpm install'));
  process.exit(1);
}

const station = spawn(node, [tsx, 'src/index.ts'], {
  cwd: join(ROOT, 'apps', 'station'),
  stdio: 'inherit',
});
const web = spawn(node, [vite], { cwd: join(ROOT, 'apps', 'web'), stdio: 'inherit' });

console.log(`\n${gr('电台已启动')}`);
console.log(`  ${cy('收听面板')}   http://localhost:9731   <- 打开它开始收听`);
console.log(`  ${cy('接口自检')}   http://localhost:9730/api/health`);
console.log(`  ${cy('后台')}       http://localhost:9730/admin`);
if (warnings.length > 0) {
  console.log(ye('\n提示：'));
  for (const w of warnings) console.log(`  ${ye('[!]')} ${w}`);
}
console.log(`\n${ye('梦可只在有人听时开口 —— 打开上面的面板，她才会开始说话。')}`);
console.log('Ctrl+C 停止\n');

const shutdown = () => {
  station.kill();
  web.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
station.on('exit', (code) => {
  console.log(rd(`电台进程退出（${code}）`));
  web.kill();
  process.exit(code ?? 1);
});
