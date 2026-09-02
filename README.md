# ambient-radio · 梦可电台

AI 主播驱动的氛围音乐电台。音乐是主体，主播**梦可**按自己的节奏轻轻串场、回应留言。

打开页面就像拧开收音机——**直接跳进正在进行的节目**，音乐已经在放，她偶尔开口，说完音乐平滑涨回来。

**先弄清楚它不是什么**（免得按播放器/聊天机器人的预期去用，然后觉得它坏了）：

- **不能切歌、暂停、回放**，没有歌单和点赞 —— 歌随机播，原则上完整播完。
- **界面上不显示她说的话**，只通过声音播出（刻意设计，不是缺功能）。
- **不能关掉她的声音**，首版没有「只听音乐」开关。
- **不认识你是谁**：不登录、不建档案、不做个性化推荐。

---

## 三步开台

### 1. 装依赖

```bash
pnpm install          # 需要 Node >= 22
```

外加两个外部程序（装一次就行）：

- **Python 3 + edge-tts**（梦可的嗓子）：`pnpm setup:voice`
- **FFmpeg**（读歌曲时长 + 语音响度归一）：Windows `winget install Gyan.FFmpeg` ／ macOS `brew install ffmpeg` ／ Ubuntu `sudo apt install ffmpeg`

> 仓库已自带 FFmpeg（`tools/ffmpeg/`），你什么都不装也能跑。

### 2. 放音乐 + 填密钥

把音频放进 `config/library/` 即可，**子文件夹随便嵌套**（也可以直接丢在根目录）：

```
config/library/
├─ track.flac
├─ 某张专辑/
│  └─ song.mp3
└─ 游戏原声/
   └─ disc1/
      └─ 01. Title.flac
```

支持 `.mp3` `.flac` `.ogg` `.m4a` `.wav` `.opus` `.aac`。所有扫到的歌进同一随机池，**不用改配置**。

然后填 LLM 密钥（串场文案用的，默认 DeepSeek）：

```bash
cp .env.example .env    # 编辑 .env，填入 DEEPSEEK_API_KEY
```

### 3. 启动

```bash
pnpm start
pnpm stop    # 关掉 9730 / 9731 上的残留进程
```

它会自动做完全部准备工作并拉起服务 —— 体检环境、首次自动生成 `.env`、曲库有变动时自动入库，无需你手动 `pnpm scan`：

```
[1/3] 环境体检   [OK] Node / ffmpeg / Python+edge-tts / .env
[2/3] 曲库       [OK] 找到 75 个音频文件 → 正在扫描入库
[3/3] 启动

 收听面板   http://localhost:9731   <- 打开它开始收听
 接口自检   http://localhost:9730/api/health
 后台       http://localhost:9730/admin
```

浏览器打开 **http://localhost:9731** 即可收听。

> **她只在有人听时开口**（`speakWhenAlone: false`）。不开页面 = 空房间，她不会说话。

---

## 日常使用

| 命令 | 作用 |
| --- | --- |
| `pnpm start` | 一键启动（体检 + 自动入库 + 电台 + 面板） |
| `pnpm stop` | 结束占用 9730 / 9731 的进程（上次没 Ctrl+C 干净时用） |
| `pnpm scan` | 手动重扫曲库（通常不需要，启动时会自检） |
| `pnpm voice:compare` | TTS 音色盲听对比（挑她的声音） |

调电台 = 改 **`config/station.config.json`**，改完重启生效。曲库本身不用改这个文件。

| 区块 | 管什么 |
| --- | --- |
| `engine` | 说话频率、留言回应时限、小主题概率、空房间是否开口 |
| `scheduler` | 防重复窗口；可选的文件夹权重/时段加成（空 = 所有文件夹等权） |
| `audio.ducking` | 说话时音乐压低多少、恢复多快 |
| `llm` / `tts` | 模型、音色、语速 |
| `config/persona.md` | 她是谁 |

---

## 排障

| 现象 | 原因与处理 |
| --- | --- |
| 启动即退出并列出原因 | 按提示补依赖；或跑 `node scripts/start.mjs --check` 看体检结果 |
| 一直不说话 | ① 打开 9731 页面了吗 ② `.env` 的 key 填了吗（没填则串场静默，音乐照常）③ `python -m edge_tts` 能跑吗 ④ 串场间隔 5~8 分钟，不是一直说 |
| 某首歌提示「无法读取时长」 | ffprobe 解析失败，该首跳过不入库 |
| 打开页面没声音 | 浏览器拦截了自动播放，点一下页面 |
| 端口被占用 | 改 `station.port`，前端代理在 `apps/web/vite.config.ts` 同步改 |

---

## 参与开发

```bash
pnpm test      # Vitest（core 全是纯逻辑）
pnpm check     # Biome lint + 格式
```

- [`AGENTS.md`](AGENTS.md) —— AI 入口索引；行为/架构/流程见文内文档表

仓库结构：`packages/core`（电台大脑，纯逻辑零 IO）· `packages/adapters`（LLM/TTS/SQLite/ffprobe）· `apps/station`（守护进程 :9730）· `apps/web`（面板 :9731）· `config`（人格、配置、曲库）· `data`（SQLite）。

两条铁律：`config/persona.md` 只读，是梦可的人格层；`packages/core` 不许出现任何 IO。
