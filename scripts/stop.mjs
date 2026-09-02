/**
 * 一键停台：关掉占用 9730 / 9731（或配置里的端口）的进程。
 * 用法：pnpm stop
 */
import { freeRadioPorts, radioPorts } from './ports.mjs';

const CYAN = '\u001b[36m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const OFF = '\u001b[0m';
const cy = (s) => CYAN + s + OFF;
const gr = (s) => GREEN + s + OFF;
const ye = (s) => YELLOW + s + OFF;

const ports = radioPorts();
console.log(cy(`\n停止电台（端口 ${ports.join(' / ')}）`));

const freed = freeRadioPorts();
if (freed.length === 0) {
  console.log(`  ${gr('[OK]')} 没有在跑的电台进程\n`);
  process.exit(0);
}

for (const { port, pids } of freed) {
  console.log(`  ${ye('[!]')} 端口 ${port} ← 结束 PID ${pids.join(', ')}`);
}
console.log(`  ${gr('[OK]')} 已停止\n`);
