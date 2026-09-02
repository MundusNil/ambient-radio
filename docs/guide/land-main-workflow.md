# 落主线 Workflow · ambient-radio

> 本文档由维护者在 ParseQ 项目中定稿的落主线工作流移植适配而来，流程骨架与纪律保持一致。

`落主线` 在本仓库中表示：把已完成的本地工作通过一个或多个 PR 合入远程 `main`，合入后清理对应工作分支，并按需从最新 `main` 创建后续工作分支。

**适用条件**：本流程需要远程仓库（GitHub 等）。当前仓库处于单人本地阶段、尚未配置 remote——配置后本流程即刻生效；在此之前的等价纪律见《团队协作与开发规范》§5（本地小切片 + 全量验证 + 双语提交格式即刻生效）。

**默认不是固定 PR 数量，而是先判断 PR 边界**：Agent 必须根据变更的产品意图、review 成本、回滚边界、依赖关系和验证方式，自主判断应该是一个 PR 还是多个 PR。一个 PR 应该对应一个端到端可验证的 vertical slice（tracer bullet），而不是机械对应某个目录、层、文件数或当前分支。

用户说「所有的都落主线」时，表示范围上全部处理；Agent 仍要先判断最佳 PR 边界，并按判断结果组织一个或多个 PR。

## 分支边界检查（Agent 必须遵守）

在 **第一次** `git add` / `git commit` / `git push` 之前，必须先确认当前工作分支的目标、已提交与未提交改动、以及建议的 PR 边界。若建议拆分，先输出 **PR 边界清单**（见下文第 2 步），再提交或推送。

PR 边界只看真实工程边界：是否能端到端完成、独立 review、独立验证、独立回滚，以及依赖关系是否清楚。目录、文件数、scope 数和当前分支形态都只是辅助观察，不直接决定 PR 数量。

## 核心逻辑

- 必须通过 PR 合入远程 `main`，禁止直接更新远程 `main`。
- **一个端到端可验证切片 = 一个 PR 候选**；同一切片可以包含 core、adapters、station、web、配置和测试等多个必要 scope。
- **多个独立切片 = 多个 PR 候选**；是否拆分取决于 review / revert / deploy / verify 边界，不取决于文件数或目录数。
- 当前分支只是输入状态，不是 PR 边界的唯一依据；必要时可以保留一个 PR，也可以拆成多个 PR。
- 默认自动推进，只有遇到真实阻塞或继续执行会违反仓库规则时才停下来。
- 合入前待落地分支必须基于最新 `origin/main`，并保持线性历史；多 PR 时每个分支都要这样处理。
- PR 标题和落地主线的每条 commit message 必须符合中英双语 Conventional Commits：`<type>(<scope>): <english-description>  <中文描述>`。`type` 和 `scope` 必须使用小写 ASCII，scope 不得省略（本仓 scope 用包名：core / scheduler / engine / station / web / shared / adapters / config / docs）；英文描述和中文描述之间使用两个空格。不得使用中文 type/scope 或编造 issue/ticket ID。PR 正文只写实际变化、业务价值、验证和限制。
- PR 合入成功后，清理对应远程和本地分支，并同步本地 `main`；只有多 PR 时才继续处理下一组。

## 默认流程

当用户说 `落主线` 时，按下面流程执行。

1. 自动收集最小输入。

   Agent 自行从当前仓库状态收集：
   - 本次要落地的工作分支（通常是当前 checkout 分支）
   - 建议的 PR 边界，以及判断理由
   - 合入后是否需要创建后续分支；用户未明确要求时，默认不创建

   若用户只说「落主线」或「所有的都落主线」而未给分支名，以当前 checkout 分支为输入做 PR 边界判断；不要默认单 PR，也不要默认拆多 PR。

2. PR 边界判断与必要拆分（落主线前必做）。

   在 push 之前，先盘点本地已提交与未提交改动，按 vertical slice 判断最佳 PR 边界。每个 PR 候选应尽量满足：

   - 端到端完成一条窄但完整的用户价值、修复路径或清理目标
   - 可独立 review，评审者能在一个上下文里理解它
   - 可独立验证，有明确测试、截图、日志或手动验收方式
   - 可独立回滚，回滚后不会留下半套依赖
   - 依赖关系清楚；有前置 PR 时，按依赖顺序落地

   文件数多、scope 多、子模块多层改动都只是检查信号。若这些改动共同组成一个窄而完整、可 demo / verify 的端到端切片，可以保持一个 PR；若它们形成多个独立切片，应拆成多个 PR。

   PR 边界以切片完整性为准：同一切片内的必要层次放在一起；彼此独立的切片分开处理。
   不应入库的本地文档、缓存、分析草稿和工具产物不属于任何 PR 候选。

   **分支命名**（每个 PR 候选一个）：

   ```text
   feat/<主题>
   fix/<主题>
   chore/<主题>
   docs/<主题>
   ```

   主题使用简洁的小写 ASCII kebab-case，例如 `feat/message-pipeline`、`fix/ducking-curve`、`chore/deps-bump`；整个主题作为分支名，不拆成 `<scope>-<summary>`；分支名不使用中文、空格或未确认的 issue/ticket ID。

   **若单一分支确实混入多个独立 PR 候选**，在 push 前从最新 `origin/main` 重建分支，只迁移该 PR 候选实际需要的 commit 或文件：

   ```bash
   git fetch origin
   git checkout main
   git merge --ff-only origin/main

   git checkout -b <type>/<主题>
   git cherry-pick <commit-hash>
   ```

   需要拆分时，输出 **PR 边界清单**（分支名 → vertical slice → 包含 commit / 文件 → 验证方式 → 计划 PR 标题）后继续执行；不要等待人工确认。多个 PR 候选之间无依赖时，合入顺序建议：`fix` → `feat` → `chore`；有依赖时按依赖链从前到后合入。

3. 推送前校验本地分支（默认校验当前工作分支；多 PR 时对每个待落地分支重复）。

   必须确认：
   - 当前分支就是要落主线的目标分支
   - 目标变更已经提交；如果检测到本地还有未提交内容，先判断提交边界并完成本地提交
   - 提交后 working tree 干净
   - **本仓验证全绿**（本仓无 CI，这是合入前唯一门禁）：
     ```bash
     pnpm test                            # Vitest 全绿
     pnpm check                           # Biome 零 error
     pnpm --filter @ambient-radio/web build   # 类型检查 + 构建
     ```
     守护进程改动追加冒烟：`pnpm dev:station` 后 `curl /api/health`。
   - 没有不明确的暂存、未暂存、遗漏提交或提交边界问题

   如果未提交变更明确属于本次落主线范围，先运行必要验证并本地提交，再继续后续流程。
   明显不应进入主线的本地资产、缓存、工具产物或个人临时文件不要提交；需要保留时先用 stash 或其它可恢复方式隔离，并在回复中说明恢复点。
   如果有部分暂存、提交归属不清、文件是否应进入主线不明确，先用 `git diff` / `git status` / 最近提交和文件路径自行判断；只有仍无法判断且继续会污染主线时，才停下来问用户。

4. 同步最新 `origin/main`，且严格使用 rebase（默认处理当前工作分支；多 PR 时每个待落地分支各做一次）。

   执行顺序：
   - `git fetch origin`
   - `git rebase origin/main`

   禁止用 `git merge origin/main` 或普通 `git pull` 制造本地 merge commit。
   如果 rebase 冲突可以根据代码意图明确解决，则本地解决并继续；只有需要产品或技术取舍且无法从上下文判断时，才停下来问用户。
   处理共享配置、流程文档、规则文件（`AGENTS.md`、`docs/guide/*`、`station.config.json` 的参数结构）等公共资产冲突时，必须先读取并比较双方语义，优先做并集合并；只有确认某一侧是模板噪音、重复内容或已废弃内容时，才可以删除。不要为了当前功能分支方便而覆盖其它切片的公共配置。

5. 推送工作分支（按 PR 边界判断结果推送；每个 PR 候选推一个分支）。

   如果远程分支不存在，正常 push 创建远程分支。
   如果 rebase 后需要更新已存在的远程分支，优先使用 `git push --force-with-lease`，并先确认远程没有他人新增提交。禁止无脑 force push。

6. 创建或更新 PR 到远程 `main`（每个 PR 候选创建或更新一个 PR）。

   PR 标题必须使用 Conventional Commits：

   ```text
   type(scope): english-result-description  中文结果描述
   ```

   `type` 使用 `feat`、`fix`、`docs`、`refactor`、`test` 或 `chore`；`scope` 使用小写 ASCII 且必须填写；英文描述和中文描述之间使用两个空格，不加句号。不要使用中文 type/scope，也不要使用无法说明实际动作的标题。

   推荐示例：`feat(engine): add natural node window  增加自然节点窗口`、`fix(scheduler): mark relaxed no-repeat  标记滑窗放宽选曲`、`docs(guide): add land-main-workflow  增加落主线工作流`。

   PR 正文不要直接堆本地 commit message，也不要保留 `fix typo`、`update` 之类噪音。应简要说明：
   - 本次实际改了什么
   - 对产品或收听体验的价值
   - 已做的验证
   - 仍需关注的风险或限制

   如果分支名中包含明确的 issue/ticket ID，在 PR 正文中自动提及或链接该 ID。没有真实来源时不要编造 ticket ID。

7. 验证 PR 中文写入结果（每个 PR 各验证一次）。

   只要 PR 标题或正文包含中文，并且经过 shell、CLI、API、GitHub/GitLab 等链路写入，就必须读取最终 PR 内容确认中文正常显示，不是 `?`、乱码或残留转义。未验证前不要继续 merge。

8. 默认使用 rebase-and-merge，保留 PR 内每条有效 commit 的独立记录；每个 PR 各 merge 一次。只有用户明确要求，或推送前已确认这些提交只是无业务意义的 fixup，才允许 squash。

   rebase-and-merge 可能为提交生成新的 SHA，但必须保留每条有效提交的顺序、标题和正文。平台默认值不得把无关日志拼进主线提交。

   主线 commit 标题格式：

   ```text
   type(scope): english-result-description  中文结果描述
   ```

   主线提交正文只保留变更原因、影响和验证，不保留杂乱工具日志或重复的本地提交列表。
   `scope` 从变更目录、包名或主要功能模块的真实来源推断；无法从真实来源推断时，停下来请求用户确认，不要硬编。

9. 验证最终落地主线 commit message（每个 PR 合入后各验证一次）。

   合入后，读取远程 `main` 新增的每条 commit，确认：
   - 标题是预期的 `type(scope): english-result-description  中文结果描述`
   - 正文是干净摘要
   - 每条有效本地提交都被保留，没有被无提示 squash 或丢弃
   - 中文没有乱码、`?` 或转义残留

   如果验证失败，停止后续自动化并说明问题；不要继续清理到无法追踪状态。

10. 处理 CI、Review 和权限等待状态。

    当前仓库没有 CI 流水线；本地三件套（第 3 步）是合入前门禁。远程仓库建立 CI 后，CI pending、required checks 未完成、缺少 human approval、分支保护未放行，都属于等待状态，不算流程失败。
    遇到这类状态时：
    - 不要 abort
    - 能用 CLI/API 轮询状态时，先自动等待并刷新状态
    - 检测到已满足 merge 条件时，继续 merge 和清理
    - 清楚输出 PR URL
    - 只有缺少人工审批、权限不足、外部门禁长期未放行或当前会话无法继续等待时，才暂停 merge 和清理步骤

    PR、commit、merge commit、变更日志等长期保存文本中不要写入会话内的临时性称呼。

    推荐阻塞说明：

    ```text
    PR created successfully. Waiting on CI/Review/branch protection: <PR URL>
    ```

11. 合入成功后清理分支（默认清理当前工作分支；多 PR 时每个 PR 各做一轮）。

    单个 PR 成功合入远程 `main` 后，执行：
    - 删除该 PR 对应的远程分支
    - 切回本地 `main`
    - 同步本地 `main` 到最新 `origin/main`
    - 删除该 PR 对应的本地分支
    - 若还有下一组待落地，从最新 `main` 对下一分支 `rebase` 后继续步骤 5–11

12. 按需创建后续分支。

    如果用户要求继续新工作：
    - 从已同步的本地 `main` 创建新分支
    - checkout 到新分支

    如果用户没有要求继续，默认停在干净且最新的本地 `main`。

## 阻塞规则

只有出现下列情况才停下来问用户：

- PR 候选归属不清，且 Agent 已用 git 状态、diff、最近提交和文件路径仍无法判断
- 最佳 PR 边界无法判断，且自行选择会明显增加 review / revert 风险
- working tree 脏且意图不明确，且继续会污染主线
- 有遗漏提交、部分暂存或提交归属不清，且无法安全归入 PR 候选
- rebase 冲突需要用户判断产品或技术意图，且无法从上下文推断
- 共享配置、流程文档、规则文件（AGENTS.md / guide / station.config.json）冲突无法确认双方语义
- 远程权限不足或平台规则阻止自动操作
- CI、required checks、review gates 或 branch protection 尚未放行
- merge title/body、PR title/body 或 ticket ID 缺少真实来源
- 中文写入验证失败，出现 `?`、乱码或转义残留
- 继续执行会违反仓库规则（《团队协作与开发规范》或 PRD 边界）

## 快速记忆

如果用户说 `落主线`，理解为：

- 不直接更新远程 `main`
- 默认自动推进，只有真实阻塞、外部门禁或继续会违反规则时才停下来
- 先判断 PR 边界，不固定一个 PR，也不固定多个 PR
- 一个端到端可验证的 vertical slice 通常对应一个 PR 候选
- 多次本地提交可以留在同一个 PR 候选里，PR 合入时默认使用 rebase-and-merge 保留每条有效提交；纯 fixup 才在推送前整理或经明确要求 squash
- 文件多、scope 多、子模块多层只是检查信号，不是强制拆分标准
- 多个可独立 review / revert / verify 的 vertical slice，拆成多分支 + 多 PR
- 「全部落主线」表示范围全部处理，不等于必须拆分，也不等于允许无关改动混进一个 PR
- 检测到明确属于本次落主线的未提交内容时，先归入正确 PR 候选、本地提交，再继续
- 明显的本地资产、缓存和临时文件不要进 PR，必要时先 stash 隔离
- 每个分支推送前先 `fetch` 并 `rebase origin/main`；推送前本地三件套验证必须全绿
- rebase 冲突涉及共享配置或公共规则时，先比较双方语义并优先并集合并
- 每个 PR 候选各创建一个 PR 到 `main`
- PR 正文用中文总结该 PR 的实际变化和产品价值，不写无关内容
- 默认 rebase-and-merge（保留每条有效主线 commit）
- 每条主线 commit message 都必须符合 `<type>(<scope>): <english-description>  <中文描述>`，scope 必须填写（包名），不拼接杂乱日志
- 中文 PR 和 commit 文本必须验证最终写入结果
- CI 或 Review 等待时输出 PR URL 并暂停，不视为失败
- PR 合入后删除对应远程和本地分支，同步 `main`；多 PR 时再处理下一组
- 未要求继续新工作时，默认不创建后续分支，停在干净且最新的本地 `main`
