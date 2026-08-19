# AGENTS.md · ambient-radio（梦可电台）

> AI 氛围电台：音乐永远是主体，主播**梦可**按自己的节奏轻轻串场。
> 单机 Windows 验证 → 未来 Docker 化部署到服务器成为公共电台。
> 本文件是 AI 助手在本仓库工作的入口宪法。详细规范见文末指针。

## 权威文档（改动前先读，禁止凭记忆推断）

| 文档 | 作用 | 编号体系 |
| --- | --- | --- |
| `docs/product-requirements.md` | 产品需求（唯一行为真相） | FR / CR / ER |
| `docs/technical-design.md` | 技术设计（唯一架构真相） | D1~D9 灵魂决策 |
| `docs/guide/团队协作与开发规范.md` | 协作、流程、验证合同 | — |
| `docs/guide/AI原生工程化SOP.md` | AI 工程化方法论落地 | — |

## 不可违背的铁律

1. **产品规格优先。** 涉及行为、交互、字段、边界时，必须先 read PRD 对应章节再实现。本产品大量需求「反 AI 直觉」——AI 的默认直觉几乎总是错的：
   - 不做播放器：无切歌、无暂停、无回放、无歌单、无点赞点踩（FR-001/007、§8.2）
   - 不显示主播文字回复或字幕（FR-041）
   - 不提供关闭语音的选项（FR-042）
   - 不做模式切换：无安静模式、无点歌模式（FR-002）
   - 听众不被识别为个人，不建画像（FR-083、CR-006）
2. **灵魂决策不可擅改。** 触碰 D1~D9（一条公共时间线、LLM 不选歌、本地曲库、无脸主播、TS monorepo……）的任何改动，必须先经维护者确认；改 PRD 需求同样如此。
3. **core 零 IO。** `packages/core` 不 import 任何网络、文件、时钟实现；随机数与时钟全部依赖注入（测试确定性的根基）。
4. **persona.md 只读。** `config/persona.md` 是 L0 人格层，维护者所有，任何自动流程不可写（FR-073）。
5. **调电台 = 改配置。** 节奏、SLA、ducking 曲线、供应商参数全部进 `config/station.config.json`，不进代码（`packages/core/src/config.ts` 是它的 TS 镜像，两边同步）。
6. **修改前读全貌。** 改模块前先读它和它的调用方；同一文件编辑超过 3 次仍不通过，停下来重新确认意图——通常是拆的任务太大了。
7. **操作前全局扫描。** 「去掉 X / 修改 Y」类需求，先 `rg` 全局查同类元素一并处理。
8. **密钥与资产红线。** API key 只存在于 `.env`（已 gitignore）；曲库音频文件不进 git；原始留言数据 7 天过期（FR-092），不得复制进测试夹具或文档。

## 词汇表（电台领域语言，写代码/测试/提交请用这套词）

| 名词 | 含义 |
| --- | --- |
| **梦可** | 唯一的 AI 主播。人格档案在 `config/persona.md`。 |
| **维护者** | 电台的制作人（本仓唯一人类）。 |
| **节目引擎** | 电台大脑：每秒 tick 的状态机，决定「何时说话」而非「说什么」（`core/engine`）。 |
| **段落 segment** | 主播一次完整开口。五种：`station_id` 台呼 / `interlude` 串场 / `topic` 小主题 / `reply` 回应留言 / `request_ack` 点歌受理。 |
| **自然节点** | 允许开口的时机：曲目边界或中段安全窗口（前奏 20s、尾奏 10s 保护）。 |
| **曲库调度器** | 确定性选曲器：加权随机 + 防重复 + 时段修正（`core/scheduler`）。LLM 不参与选歌（D2）。 |
| **调频进入** | 听众打开页面即跳进正在进行的节目，不是从头开始（D5）。 |
| **ducking** | 主播说话时音乐平滑压低，说完恢复。 |
| **空房间沉默** | 无人收听时主播不说话不积累记忆（`speakWhenAlone=false`）。 |
| **L0 / L1 / L2** | 人格层（persona.md，只读）/ 节目记忆（策展写入）/ 临时上下文（随会话消散）。 |
| **沉默保底** | 生成失败或来不及时放弃该段落，音乐继续，绝不播报技术错误（ER 哲学）。 |

## 常用命令

```bash
pnpm install          # 安装（workspace 全部）
pnpm test             # Vitest（packages/*/src/**/*.test.ts）
pnpm check            # Biome lint + 格式检查
pnpm exec biome check --write .   # 自动修复格式
pnpm dev:station      # 电台守护进程（Hono，:3000）
pnpm dev:web          # 收音机面板（Vite）
pnpm --filter @ambient-radio/core exec tsc --noEmit -p tsconfig.json   # 单包类型检查
pnpm --filter @ambient-radio/web build   # 前端类型检查 + 构建（含 vue-tsc）
```

## 工作方式

- **TDD**（`.agents/skills/tdd`）：core 纯逻辑红绿循环；seam 先约定，测试只走公共接口。
- **垂直切片**：一个测试 → 一个实现 → 循环；禁止水平铺开（先写全部测试再写全部实现）。
- **提交纪律**：双语 Conventional Commits——`<type>(<scope>): <english>  <中文>`（英文与中文之间两个空格），如 `feat(engine): add natural node window  增加自然节点窗口`。scope 用包名（core/scheduler/engine/station/web/shared/adapters/config/docs）。
- **落主线**：远程仓库配置后，「落主线」流程以 `docs/guide/land-main-workflow.md` 为唯一详细来源（PR 边界按 vertical slice 判断，不机械按目录拆分）。
- **完成后自审**：用 `.agents/skills/code-review` 审查 diff 再提交。
- **体验类改动**：请维护者亲自收听验证（Vibe Check 是本产品的核心门禁）。
- **新技能安装**：优先 SkillHub（`~/.local/bin/skillhub --dir <skills 目录>`，全局策略）。

## 当前状态

P1（能听的电台）进行中——monorepo 骨架与 core 大脑（引擎 + 调度器，28 测试）已完成。里程碑规划见技术方案 §7；实际进度以 `git log` 为准。

---

*本文件是约束的浓缩版。规则不清楚时，先查 PRD / 技术方案 / 两份 guide 文档；仍不明确就停下问维护者，不能用默认值代替业务决定。*
