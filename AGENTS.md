# AGENTS.md · ambient-radio（梦可电台）

> AI 氛围电台：音乐永远是主体，主播**梦可**按自己的节奏轻轻串场。
> 本文件是入口索引，不展开细则。行为、架构、流程以下列文档为准。

## 去哪查

| 要什么 | 文档 |
| --- | --- |
| 行为 / 交互 / 字段 / 边界 | [`docs/product-requirements.md`](docs/product-requirements.md)（FR / CR / ER；反播放器清单见 §8.2） |
| 架构 / 灵魂决策 D1~D9 | [`docs/technical-design.md`](docs/technical-design.md) |
| 词汇、流程、验证、提交、命令 | [`docs/guide/团队协作与开发规范.md`](docs/guide/团队协作与开发规范.md) |
| AI 工作流、熔断、技能用法 | [`docs/guide/AI原生工程化SOP.md`](docs/guide/AI原生工程化SOP.md)、[`.agents/skills/`](.agents/skills/) |
| 落主线 / PR | [`docs/guide/land-main-workflow.md`](docs/guide/land-main-workflow.md) |
| 部署 | [`docs/guide/部署与常驻.md`](docs/guide/部署与常驻.md) |

涉及行为必须先读 PRD 对应章节；涉及结构必须先读技术方案。禁止凭记忆或「通用最佳实践」补产品边界。默认直觉（播放器、字幕、关语音、模式切换、听众画像）几乎总是错的。

## 铁律（细节在协作规范 §6 / §7）

1. **D1~D9 与 PRD 不可擅改。** 触碰须维护者确认并先改文档。
2. **`packages/core` 零 IO。** 网络 / 文件 / 时钟全部注入。
3. **`config/persona.md` 只读。** 任何自动流程不可写。
4. **调电台 = 改 `config/station.config.json`。** `packages/core/src/config.ts` 是它的 TS 镜像，两边同步。
5. **密钥只在 `.env`；曲库音频与原始留言不进 git / 测试夹具。**

规则不清楚：PRD → 技术方案 → 协作规范 → 停下问维护者。不能用默认值代替业务决定。进度以 `git log` 为准，里程碑见技术方案 §7。
