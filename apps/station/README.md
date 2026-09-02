# @ambient-radio/station

电台守护进程：组装 core 的大脑（节目引擎 + 曲库调度器）为真实播出时间线。

- REST：`/api/state`（调频同步）、`/api/config`、`/api/health`、`/audio/track/:id`
- WebSocket：`/ws`（连接即补发 sync；连接数即听众计数）
- 端口：`config/station.config.json` → `station.port`（默认 **9730**）

```bash
pnpm dev:station     # 从仓库根启动
```

启动前置：`config/library/` 里要有音频文件（任意嵌套；空曲库会拒绝启动，ER-005）。
