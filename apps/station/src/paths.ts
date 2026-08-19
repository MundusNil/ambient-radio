/** 仓库根探测：向上找 pnpm-workspace.yaml（dev / Docker / 任意 cwd 均成立） */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('未找到仓库根（pnpm-workspace.yaml）：请从仓库内启动');
    }
    dir = parent;
  }
}
