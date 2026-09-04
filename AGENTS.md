# AGENTS.md · mock-radio（梦可电台）

> AI 氛围电台：音乐永远是主体，主播**梦可**按自己的节奏轻轻串场。
> 本文件是入口索引，不展开细则。行为、架构、流程以下列文档为准。

## 去哪查

> 详细文档（PRD、技术设计、协作规范、SOP）在维护者本机 `docs/`，不随仓库分发。公开仓库以本文件 + `README.md` + `CONTEXT.md` 为准。

| 要什么 | 看哪里 |
| --- | --- |
| 产品行为 / 反播放器清单 | [`README.md`](README.md) 开头「它不是什么」 |
| 领域用语（梦可 / 段落 / 自然节点 / ducking…） | [`CONTEXT.md`](CONTEXT.md) |
| 架构 / 运行时 | 直接读代码：`packages/core`（引擎）+ `apps/station/src`（组装）；本机 `docs/technical-design.md` |
| 可调参数 | [`config/station.config.json`](config/station.config.json)（TS 镜像：`packages/core/src/config.ts`） |
| 她是谁 | [`config/persona.md`](config/persona.md)（L0，只读） |

涉及行为先读 README 边界清单；涉及结构先读代码与配置。禁止凭记忆或「通用最佳实践」补产品边界。默认直觉（播放器、字幕、关语音、模式切换、听众画像）几乎总是错的。

## 铁律（细节在协作规范 §6 / §7）

1. **D1~D9 与 PRD 不可擅改。** 触碰须维护者确认并先改文档。
2. **`packages/core` 零 IO。** 网络 / 文件 / 时钟全部注入。
3. **`config/persona.md` 只读。** 任何自动流程不可写。
4. **调电台 = 改 `config/station.config.json`。** `packages/core/src/config.ts` 是它的 TS 镜像，两边同步。
5. **密钥只在 `.env`；曲库音频与原始留言不进 git / 测试夹具。**

规则不清楚：PRD → 技术方案 → 协作规范 → 停下问维护者。不能用默认值代替业务决定。进度以 `git log` 为准，里程碑见技术方案 §7。
