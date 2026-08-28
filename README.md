# ambient-radio · 梦可电台

AI 氛围电台：一条常开的时间线，音乐永远是主体，主播**梦可**按自己的节奏轻轻串场、回应留言、慢慢长出真实的节目记忆。

- 产品需求：[`docs/product-requirements.md`](docs/product-requirements.md)
- 技术设计：[`docs/technical-design.md`](docs/technical-design.md)
- 协作规范：[`docs/guide/团队协作与开发规范.md`](docs/guide/团队协作与开发规范.md)
- AI 工程化 SOP：[`docs/guide/AI原生工程化SOP.md`](docs/guide/AI原生工程化SOP.md)
- AI 入口宪法：[`AGENTS.md`](AGENTS.md)

## 结构

```
ambient-radio/                  # pnpm workspaces + TypeScript strict
├─ packages/
│  ├─ core/        # 电台大脑：节目引擎、曲库调度、上下文构建、记忆（纯逻辑，零 IO）
│  ├─ adapters/    # 协议实现：LLM / TTS / SQLite / 音频 / 时钟
│  └─ shared/      # API / WebSocket 事件 schema（前后端共享）
├─ apps/
│  ├─ station/     # 电台守护进程（Hono + ws）
│  └─ web/         # 收音机面板（Vue 3 + Web Audio）
├─ config/
│  ├─ persona.md   # 梦可的人格档案（维护者所有，运行时只读）
│  ├─ station.config.json  # 全部可调参数（调电台=改配置）
│  └─ library/     # 曲库根目录，子文件夹名 = 子风格标签
├─ data/           # SQLite（tracks/plays/segments；电台重启不失忆）
└─ docs/           # PRD 与技术设计
```

依赖方向铁律：`core` 不 import 任何 IO（网络/文件/时钟全部注入）。

## 开发

```bash
pnpm install
pnpm dev:station   # 电台守护进程
pnpm dev:web       # 收音机面板（Vite）
pnpm test          # 单元测试（Vitest）
pnpm check         # Lint + 格式检查（Biome）
```

## 配置

- `config/station.config.json` —— 说话节奏、节点窗口、SLA、ducking 曲线、LLM/TTS 供应商
- `config/persona.md` —— 梦可的人格（L0 层，任何自动流程不可改写）
- `config/library/<子风格>/` —— 放入音频文件后运行扫描命令入库（P1 提供）
- `.env` —— API key（从 `.env.example` 复制）
