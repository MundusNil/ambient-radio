# AI 氛围电台 · 技术设计文档

- 文档状态：技术方案已定稿，待开工
- 日期：2026-07-20
- 姊妹文档：`ai-ambient-radio-product-requirements.md`（PRD，需求已确认）
- 本文档补齐 PRD 明确排除的部分：架构、技术选型、实施计划
- 来源：与维护者八轮脑暴共识 + Aitune 施工图逆向借鉴 + AIRI/Claude FM 参考查证

---

## 0. 产品一句话

一条 24/7 常开的时间线：音乐永远是主体，一个无脸的 AI 主播按自己的节奏轻轻串场、回应留言、慢慢长出真实的节目记忆。所有人调频进入同一个"地方"。

**这个产品是：** Claude FM 的画面公式 × VA-11 Hall-A 的魂 × Neuro-sama 的自主性。
**这个产品不是：** AITUNE（个性化服务）、聊天机器人、播放器。

---

## 1. 灵魂决策记录（ADR）

以下九条是脑暴阶段逐条确认的决策，是本文档一切设计的依据。改任何一条之前，先重读它为什么被选定。

| # | 决策 | 内容与理由 |
|---|------|-----------|
| D1 | **一条公共时间线** | 所有人听同一个电台、同一秒的节目、同一个主播记忆。系统内部不允许出现"这个听众"概念。这是产品与 AITUNE（学口味、做定制）的根本分野：我们做"地方"，不做"服务"。 |
| D2 | **LLM 只写字，不选歌** | 选歌是确定性调度器 + 维护者亲手维护的曲库（FR-015/016/017）。LLM 只负责口播文案。副产品：LLM 幻觉永远点不出曲库里不存在的歌。 |
| D3 | **本地曲库** | 放弃任何在线音乐 API。文件夹结构即标签体系。ER-005（音源故障）从"随时发生"变为"几乎不可能"。 |
| D4 | **无脸主播 + 收音机面板** | 界面是一张静态图（收音机/DJ 台）+ 极少量动效（ON AIR 灯、指针、说话时呼吸感）。音乐主导，画面只负责氛围在场。不进 Live2D/动画角色领地。 |
| D5 | **音乐常开 + 主播随叫随到** | 曲库引擎 24/7 往前走，调频进来时音乐永远"已经在放"（FR-006 的"随机节目位置"由此成立）；无人在听时主播沉默、不积累记忆。"空房间开口"（真 24/7 电台）做成配置开关，不是被放弃，是被保留。 |
| D6 | **TypeScript monorepo，清洁内核** | 常开电台=常驻守护进程+事件循环；终局是 web 服务，全栈同语言。核心质量来自"纯逻辑核 + 协议解耦"（Aitune 施工图最值钱的思想），不来自框架数量。选型同时对 AI 维护者友好（严格类型+测试）。 |
| D7 | **LLM：DeepSeek 起步，OpenAI 兼容适配器** | 中文好、极便宜（本用量一天几毛钱）、OpenAI 兼容协议。换供应商=改配置。 |
| D8 | **TTS：edge-tts 免费起步，候选池随时换** | 候选：小米 MiMo-V2.5-TTS（OpenAI 兼容协议，`voicedesign` 可用文字描述定制音色——"她"的声音身份的最优路径）、火山/MiniMax、本地 CosyVoice2。适配器后面全部一键切换。 |
| D9 | **借鉴政策** | Aitune 施工图：采纳其验证过的机制，拒绝其个性化轴，改造其"一次成型"为"常驻时间线"。AIRI：不从它 fork（它是看得见的伴侣，我们是看不见的电台），降级为同语言参考资料。 |

---

## 2. 系统总览

```
┌────────────────────────── 本机 Windows（常驻） ──────────────────────────┐
│                                                                          │
│  apps/station —— 电台守护进程（Node，开机自启，24/7）                       │
│  ├─ 节目引擎    每秒 tick 的状态机：何时说话比说什么更重要                    │
│  ├─ 曲库调度器  加权随机 / 防重复 / 时段权重 / 点歌优先队列                  │
│  ├─ 上下文构建  人格 + 时间 + 曲目 + 记忆 + 留言 → 组装 prompt               │
│  ├─ LLM 适配器  DeepSeek（OpenAI 兼容）→ 串场文本（JSON 结构化输出）          │
│  ├─ TTS 管线    edge-tts / MiMo → ffmpeg 响度归一 → 音频缓存                │
│  ├─ 记忆系统    三层，extractMemory 策展写入，分层衰减                       │
│  └─ 留言管线    WebSocket 收发，7 天保留自动清理                            │
│                                                                          │
│  apps/web —— 收音机面板（浏览器打开的同一个页面，发给朋友就是电台入口）        │
│  ├─ Web Audio：双音源 + GainNode ducking（说话降、说完升）                   │
│  ├─ 调频进入：从 /api/state 拿到"现在播到哪"，直接 seek 进正在进行的节目       │
│  └─ 开台/关台(=进入/离开) + 总音量 + 唯一留言输入框                          │
│                                                                          │
│  数据：SQLite（曲目/播放史/段落/留言/记忆） + persona.md + station.config   │
└──────────────────────────────────────────────────────────────────────────┘
```

运行时故事：开机 → 守护进程自启 → 时间线从数据库重建（电台重启不失忆）→ 浏览器打开页面 → 调频进入正在播的歌 → 主播感知到有听众，开始按节奏开口。

---

## 3. Monorepo 结构

```
ambient-radio/                     # pnpm workspaces + TypeScript strict
├─ packages/
│  ├─ core/            # 电台大脑：纯逻辑，零 IO，全部依赖注入
│  │   ├─ engine/      #   节目引擎状态机、tick 决策、段落规划
│  │   ├─ scheduler/   #   曲库调度器（加权随机/防重复/时段/点歌队列）
│  │   ├─ context/     #   上下文构建器（prompt 组装）
│  │   ├─ memory/      #   记忆模型：三层结构、衰减策略、匿名化规则
│  │   └─ types.ts     #   对外契约类型（apps 共享）
│  ├─ adapters/        # 协议的真实实现
│  │   ├─ llm/         #   OpenAI 兼容客户端（DeepSeek/Qwen/GLM 通吃）
│  │   ├─ tts/         #   edge-tts / MiMo / 云 TTS，统一 synthesize() 接口
│  │   ├─ store/       #   SQLite（better-sqlite3）
│  │   ├─ audio/       #   ffmpeg 响度归一、音频元数据读取（music-metadata）
│  │   └─ clock/       #   系统时钟（可注入假时钟做测试）
│  └─ shared/          #   API/WS 事件 schema（前后端共享类型）
├─ apps/
│  ├─ station/         # 守护进程：Hono + ws，跑 core，服务静态资源与音频文件
│  └─ web/             # 收音机面板：Vite + Vue 3 + Web Audio
├─ config/
│  ├─ persona.md       # 她的人格档案（维护者所有，运行时只读，永远不被自动改写）
│  ├─ station.config.json  # 全部可调参数（见 §4.1）
│  └─ library/         # 曲库根目录，子文件夹名 = 子风格标签
└─（未来自然长出，现在不建）
   ├─ apps/admin/      # 维护者记忆审查台（P3）
   └─ apps/desktop/    # Tauri 角落小窗壳，包的还是 web 这页
```

依赖方向铁律：`core` 不 import 任何 IO（网络/文件/时钟全部注入）。这让节目引擎可以在 CLI 里用假时钟和假适配器做单元测试——Aitune 施工图 `AituneCore` 的同款思想。

工具链：pnpm / TypeScript(strict) / Vitest / Biome / Vite / Hono / Vue 3 / better-sqlite3。

---

## 4. 核心子系统设计

### 4.1 节目引擎（core/engine）

**不是定时器，是每秒 tick 的状态机。** 状态在 `MUSIC` 与 `VOICE` 之间流转，VOICE 有五种段落类型：

| 段落类型 | 说明 | 长度约束 |
|---|---|---|
| `station_id` | 台呼，非个人化，开台后首个自然节点播出（FR-004/005） | 5~10s |
| `interlude` | 常规串场 | 10~25s（FR-032）：舒适上限，非常规必须填满（多数约 5~15s） |
| `topic` | 小主题 | 1~2min（FR-033），冷却 ≥40min |
| `reply` | 回应留言 | 15~45s |
| `request_ack` | 点歌受理/婉拒/预告 | 10~20s |

**自然节点**（只在这些位置开口）：曲目边界；曲目进行 ≥20s 且非开头 15s。绝不中途打断一首歌的前奏。

**tick 决策优先级**（从高到低）：

1. 最老未回应留言年龄 > `force_reply_ms`（90s）→ 尽快制造节点
2. 留言年龄 > `prefer_reply_ms`（45s）→ 下一个自然节点优先回应（FR-055 的 30~90s 目标由此达成）
3. `next_talk_due` 到期（从 5~8min 区间采样，对应 8~12 次/小时，FR-031）
4. 已受理点歌待播 → 播出时顺带 `request_ack`
5. 距上次小主题超冷却 → 有概率升级为 `topic`

**生成流水线**：规划段落 → 上下文构建 → LLM → TTS → 缓存 → 节点播出。留言的生成与"等自然节点"**并行进行**，节点到了就播。

**60% 预取规则**（抄 Aitune）：当前曲目播到 60% 时，为曲目边界规划的段落必须已完成文本+TTS 合成；来不及则放弃该段落（沉默保底，FR 的 ER 哲学），绝不为赶时间播劣质内容。

**全部可调参数集中在 `station.config.json`**：说话间隔分布、节点窗口、SLA 阈值、话题冷却、ducking 曲线、TTS/LLM 供应商、`speak_when_alone`（空房开口开关，D5 保留的 a 选项）。调电台=改配置+重启，不是改代码。

### 4.2 曲库调度器（core/scheduler）

- **入库**：丢文件进 `config/library/<子风格>/`，跑扫描命令（`music-metadata` 读时长/标签）写 SQLite。子风格文件夹举例：`game-bgm/`、`cafe/`、`vocal-soft/`、`night-quiet/`。
- **选曲**：加权随机。权重 = 子风格基础权重 × 时段修正（深夜偏安静、白天偏明亮，FR-020）× 近期播放惩罚（FR-019）。
- **防重复**：30 分钟滑窗内同曲不出现（FR-018）；曲库不足时放宽并记录警告。
- **点歌队列**：被受理的点歌进优先队列，由节目引擎决定何时插入（FR-064）。调度器本身没有"点歌模式"概念（FR-066）。
- **故障**：单曲文件损坏 → 跳下一首（ER-004）。本地曲库让"音源整体故障"基本不存在。

### 4.3 上下文构建器（core/context）

Aitune 六要素，砍一留五（**无 User Profile**，D1/D2）：

1. 人格（persona.md 全文）
2. 时间（本地时间、星期、时段氛围）
3. 曲目上下文（刚播完的曲、正在播的曲、下一首，含风格标签）
4. 节目记忆（L1 记忆按重要度+新近度选出 top-N 条）
5. 播放轨迹（最近播放列表，防重复话题）+ 待回应留言（合并相关多条，FR-054）

**防编造机制（FR-034/037/074）**：上下文里只存在结构化的、经过核实的记录；人格 prompt 硬性禁止编造过去事件和不确定的曲目背景。她能说的过去 = 数据库里真实存在的记录。

上下文现含近期已播口播（对话史）与按 haystack 选出的世界书条目；主指令保持短；不再注入 seeds / guardrails。世界书不是实时资讯（FR-036）。

### 4.4 记忆系统（core/memory + adapters/store）

三层（FR-070~103）：

- **L0 人格层**：`persona.md`，维护者所有，运行时只读，任何自动流程不可写（FR-073）。
- **L1 节目记忆**：结构化记录（话题/承诺/内部梗/重要事件），由 `extractMemory()` 策展写入——每段播出后，LLM 按严格 JSON schema 判断"是否有值得长期保留的节目事实"，只记与节目连续性相关的匿名内容（FR-080~085：无用户名、无原句、无个人生活细节）。带 `importance` 和 `created_at`，按 FR-075 分层衰减（核心事件长期保留，普通话题渐淡）。
- **L2 临时上下文**：近期话题、当前会话留言、播放轨迹。内存中存活，随会话消散。

**维护者审查（P3）**：`apps/admin` 极简页——列出 L1 记忆 + 删除按钮 + 原始留言（7 天内）查看（FR-101/091）。

**迁移纪律（FR-102/103）**：本机原型 → 公共电台时，只有维护者勾选的记忆可以成为正式历史。从第一天起 L1 就按"未来要被挑选"的标准写。

### 4.5 LLM 适配器（adapters/llm）

- OpenAI 兼容协议一个客户端通吃：DeepSeek（默认）/ Qwen / GLM / Kimi / OpenAI。`base_url + api_key + model` 三行配置。
- 结构化输出：段落文本 + 可选的元数据（本次话题标签、是否触发记忆提取）一次 JSON 返回。
- 用量估算：每小时约 10 段 × 200 字 + 上下文 ≈ 5 万 token/天，DeepSeek 成本每天几毛钱。

### 4.6 TTS 管线（adapters/tts + adapters/audio）

- 统一接口：`synthesize(text, voiceProfile) → 音频文件`。
- 实现一（默认）：**edge-tts**，微软神经声（如 zh-CN 晓晓，语速 -10%），免费。
- 实现二（重点候选）：**小米 MiMo-V2.5-TTS**，OpenAI 兼容协议；`mimo-v2.5-tts-voicedesign` 可用文字描述定制音色——"她"的专属声音不走克隆路线就能拿到。Aitune 的 `ChatCompletionsTTS` 即此接法，已被上线产品验证。
- 后处理：ffmpeg `loudnorm` 统一响度（FR-045 音量稳定），缓存按文本哈希命中。
- 首周做一次**盲听 A/B**：同一段串场文本用两套 TTS 各合成一版，维护者亲耳选。声音是这个产品的一半生命，这个决定不许外包给"先凑合"。

### 4.7 守护进程（apps/station）

- Hono（`@hono/node-server`）+ `ws`：静态页、REST、WebSocket、音频文件流。
- 常驻方式：Windows 任务计划/服务，崩溃自动重启；启动时从 SQLite 重建时间线（最后一曲 + 起播时间 → 计算当前位置，接着播）。
- 听众感知：WS 连接数即在场人数；`listeners > 0 || speak_when_alone` 才生成语音段落。音乐时间线永远走。

### 4.8 收音机面板（apps/web）

- Vue 3 + Web Audio。调频进入：`GET /api/state` → 当前曲目+服务器时间戳 → `AudioBufferSourceNode.start(0, offset)` 直接跳进正在进行的节目。
- **Ducking**：音乐 GainNode `setTargetAtTime` 降到 22%（τ≈0.25s）；语音结束 1.2s 平滑恢复（FR-043/044）。曲线参数在配置里，不在代码里。
- 界面元素（PRD FR-001）：进入/离开、总音量、唯一留言框、本次会话自己的留言列表（FR-052/057）。视觉：一张收音机面板静态图 + ON AIR 灯 + 说话时轻微动效。**为美学生长留缝但不预建**（D4）。

### 4.9 留言管线

- WS 上行 `message` → 入库（`received_at` + 7 天后过期）→ 进入回应队列。
- 回应时序（满足 FR-055/056）：到达即并行生成（LLM 2~5s + TTS 2~5s，等节点期间完成）→ 自然节点播出。全程 30~90s，上限 2min 由引擎的 force 机制兜底。
- 定时任务：每日清理 `expires_at` 到期的原始留言（FR-092）。原始留言永不自动进入 L1（FR-093）。

### 4.10 故障哲学（ER 映射）

| PRD | 实现 |
|---|---|
| ER-001~003 | LLM/TTS 失败 → 本段放弃，音乐照常，主播沉默，下个节点自然接回，绝不播报技术错误 |
| ER-004 | 单曲损坏 → 调度器跳下一首 |
| ER-005/006 | 本地曲库下几乎不存在；保留兜底：连续 3 首失败 → 广播"信号丢失"状态 |
| ER-007 | 故障期间 SLA 时钟暂停（故障不计入 2min 上限） |

---

## 5. 数据模型（SQLite）

```sql
tracks(id, path, title, artist, duration_ms, styles_json, enabled, added_at)
plays(id, track_id, started_at, ended_at, listener_count)     -- listener_count 供"节目真实发生过"判定
segments(id, kind, text, audio_path, planned_at, aired_at, status)
messages(id, body, received_at, expires_at)                   -- 原始留言，7 天清理
memories(id, kind, text, importance, created_at, last_used_at, status)  -- L1 节目记忆
```

记忆分类 `kind`：`topic` / `promise` / `meme` / `event`。检索打分：`importance × 时间衰减 × 最近引用加权`。

---

## 6. API / WebSocket 契约

**REST**

- `GET /api/state` → `{ trackId, startedAt, durationMs, positionMs, hostTalking, serverTime }`（调频同步）
- `GET /audio/track/:id` / `GET /audio/segment/:id` → 音频文件流
- `POST /api/message` → `{ body }`（WS 断连时的降级通道）
- （P3）`GET /api/admin/memories`、`DELETE /api/admin/memories/:id`、`GET /api/admin/messages`

**WebSocket `/ws`**

- 上行：`{ type: "message", body }`
- 下行：`{ type: "track", trackId, startedAt, durationMs }`、`{ type: "voice", segmentId, startedAt, durationMs }`、`{ type: "sync", ... }`（补发当前状态）

所有事件 schema 定义在 `packages/shared`，前后端共享同一套类型，协议变更编译期报错。

---

## 7. 里程碑

| 阶段 | 交付 | 验证什么 | 对应 PRD 验收 |
|---|---|---|---|
| **P1 能听的电台**（约数天） | monorepo 脚手架 + 节目引擎 + 曲库调度 + 收音机面板 + edge-tts + persona.md + 临时记忆（近期话题 JSON） | **电台感成立吗**：音乐主导、节奏对、ducking 顺滑 | §9.1 |
| **P2 会回应的电台** | 留言管线、SLA 内语音回应、多留言合并、点歌意图识别与插播 | 互动回路不破坏电台感 | §9.2 + §9.3 |
| **P3 有记性的电台** | 三层记忆、提取与衰减、匿名摘要、7 天清理、admin 审查台 | 真实连续性成立且可控 | §9.4 + §9.5 |

P1 结束的标志：维护者自己连听 30 分钟不想关。**P1 之前不做任何 P2/P3 的事**——假设 A 不成立时，精致的记忆系统是沉没成本。

---

## 8. 维护者作业（非技术，但决定灵魂）

1. **她的名字。**
2. **种子曲库**：每个子风格至少 15~20 首，定义电台的审美范围（FR-015）。
3. **人格档案 persona.md**：她的核心设定、表达习惯、内容边界（PRD §3.1 + §6）。这份文件是她的"不可被节目经历改写的部分"。
4. **声音的耳朵**：P1 首周做 TTS 盲听 A/B，亲手选出她的声音。
5. **长期**：定期进 admin 看一眼她长出了什么记忆，删掉不对的（FR-101）。你是她的制作人。

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 免费 TTS 音色像导航播报，毁掉电台感 | 适配器 + 首周盲听 A/B + MiMo voicedesign 定制音色（D8） |
| LLM 编造节目历史 | 上下文只含结构化事实 + prompt 硬约束 + L1 只收核实的策展记录（§4.3/4.4） |
| 守护进程崩溃 | 开机自启 + 自动重启 + 时间线从 DB 重建（电台重启不失忆） |
| gray-zone 免费服务（edge-tts 等）失效 | 全部外部服务都在适配器后面，切换=改配置 |
| 单机依赖（PC 关机=电台停播） | v1 接受；未来迁 NAS/小主机，代码零改动 |
| 维护者倦怠 | 所有节奏参数在配置文件里；电台为"自己听着舒服"而生，不为 KPI 而生 |

---

## 10. 参考与致敬

- **Aitune 施工图**（独立开发者，已上线）：状态机循环、上下文构建器、`extractMemory()`、60% 预取保底、协议解耦、双播放器分离——直接采纳。其个性化轴（taste/auto_taste/User Profile）——明确拒绝。
- **AIRI**（moeru-ai，开源）：soul container 的组织方式（stage 划分、记忆、多形态分发）作为同语言参考资料。不从它 fork。
- **Claude FM**（Anthropic）：证明了"[循环氛围场景]+[连续音乐]+[什么都不解释]"的公式成立；`/radio` 的入口哲学（一个网址就是电台）被我们继承。
- **VA-11 Hall-A**：第三场所的安定感——电台的魂。
- **Neuro-sama**：AI 可以真的主持一场节目，而不是被调用。

---

*本文档由八轮脑暴共识固化而成。改动灵魂决策（§1）需要维护者重新确认，其余技术细节随实施演进。*
