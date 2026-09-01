# 主播说话装配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 梦可每次开口能看见自己的对话史、作品世界书和口吻示例；主指令缩短；不再用种子/护栏立法。

**Architecture:** 纯函数在 `packages/core`：解析 lore、按 haystack 选条目、拼三明治 prompt。`apps/station` 读 `config/library/<style>/lore.md`、`tracks.md`、`config/speech-examples.md`，并把最近已播口播交给 producer。节目引擎「何时开口」不改。core 零 IO。

**Tech Stack:** TypeScript / Vitest / 现有 `@ambient-radio/core` + `apps/station`。无新依赖。

**Spec:** `docs/specs/2026-09-01-host-speech-design.md`

---

## File map

| 文件 | 职责 |
|---|---|
| Create: `packages/core/src/lore.ts` | `LoreEntry`、`selectLoreEntries`、`parseLoreMarkdown`、`parseTracksMarkdown` |
| Create: `packages/core/src/lore.test.ts` | 上述纯函数测试 |
| Modify: `packages/core/src/context.ts` | 三明治 prompt；去掉 seeds/guardrails |
| Modify: `packages/core/src/context.test.ts` | 锁对话史 / 世界书 / 示例 / 短指令 |
| Modify: `packages/core/src/producer.ts` | 传入近期口播、lore 条目、示例 |
| Modify: `packages/core/src/producer.test.ts` | 断言 generateSegment 收到的 prompt 含对话史与命中 lore |
| Modify: `packages/core/src/config.ts` | 删除 `InterludeConfig` |
| Modify: `packages/core/src/index.ts` | 已 `export * from './context'`；加 `export * from './lore'` |
| Create: `apps/station/src/lore-files.ts` | 读曲库旁 lore/tracks 与 speech-examples（IO 只在这里） |
| Create: `apps/station/src/lore-files.test.ts` | 用临时目录测加载 |
| Modify: `apps/station/src/radio.ts` | 去掉 interludeConfig；接 lore + 近期已播 |
| Modify: `apps/station/src/index.ts` | 启动时加载 lore 与示例 |
| Modify: `apps/station/src/config.ts` | 去掉 interlude 合并 |
| Modify: `config/station.config.json` | 删除 `interlude` |
| Create: `config/speech-examples.md` | 口吻样本 |
| Create: `config/library/va11halla/lore.md` | VA-11 世界书 |
| Create: `config/library/va11halla/tracks.md` | 曲名备注 |
| Modify: `config/persona.md` | 说话方式与待填，按 spec §7 |
| Modify: `docs/product-requirements.md` | FR-032/034/035/037 |
| Modify: `docs/technical-design.md` §4.3 | 三明治 + 世界书 |
| Modify: `README.md` | 调电台说明：改 lore/示例，不再改 seeds |

不改：`packages/core/src/engine/`（何时开口）。

---

### Task 1: 世界书匹配与解析（core 纯函数）

**Files:**
- Create: `packages/core/src/lore.ts`
- Create: `packages/core/src/lore.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { parseLoreMarkdown, parseTracksMarkdown, selectLoreEntries } from './lore';

describe('selectLoreEntries', () => {
  const va11 = {
    keys: ['Jill', 'VA-11', '格莱德'],
    content: '格莱德市霓虹酒吧。',
    constantForStyles: ['va11halla'],
  };
  const cafe = {
    keys: ['拿铁'],
    content: '咖啡厅下午。',
    constantForStyles: ['cafe'],
  };

  it('当前曲风格命中时注入该风格世界卡（即使 haystack 没提名字）', () => {
    const picked = selectLoreEntries([va11, cafe], '', ['va11halla']);
    expect(picked.map((e) => e.content)).toEqual(['格莱德市霓虹酒吧。']);
  });

  it('haystack 提到 key 时注入，即使当前曲是别的风格（续聊仍带着书）', () => {
    const picked = selectLoreEntries([va11, cafe], 'Jill 那封信', ['cafe']);
    expect(picked.map((e) => e.content)).toEqual(['格莱德市霓虹酒吧。']);
  });

  it('既无风格命中也无 key 则不注入（不硬塞题目）', () => {
    expect(selectLoreEntries([va11], '窗外在下雨', ['cafe'])).toEqual([]);
  });

  it('key 大小写不敏感', () => {
    const picked = selectLoreEntries([va11], 'va-11 真好', ['cafe']);
    expect(picked).toHaveLength(1);
  });
});

describe('parseTracksMarkdown', () => {
  it('解析「曲名 | 备注」，忽略空行和 # 注释', () => {
    const entries = parseTracksMarkdown(`
# 备注
Last Call | 打烊点
Meet the Staff | 员工介绍

`);
    expect(entries).toEqual([
      {
        keys: ['Last Call'],
        content: '《Last Call》：打烊点',
        constantForStyles: [],
      },
      {
        keys: ['Meet the Staff'],
        content: '《Meet the Staff》：员工介绍',
        constantForStyles: [],
      },
    ]);
  });
});

describe('parseLoreMarkdown', () => {
  it('无 frontmatter 时用文件夹名当 key，并 constantForStyles=[style]', () => {
    const entry = parseLoreMarkdown('va11halla', '格莱德市一间酒吧。');
    expect(entry).toEqual({
      keys: ['va11halla'],
      content: '格莱德市一间酒吧。',
      constantForStyles: ['va11halla'],
    });
  });

  it('frontmatter keys 覆盖默认 key', () => {
    const entry = parseLoreMarkdown(
      'va11halla',
      `---
keys: Jill, Dana, VA-11
---
正文`,
    );
    expect(entry.keys).toEqual(['Jill', 'Dana', 'VA-11']);
    expect(entry.content).toBe('正文');
    expect(entry.constantForStyles).toEqual(['va11halla']);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm --filter @ambient-radio/core exec vitest run src/lore.test.ts`

Expected: FAIL，找不到 `./lore`

- [ ] **Step 3: 最小实现**

`packages/core/src/lore.ts`:

```ts
export interface LoreEntry {
  keys: string[];
  content: string;
  constantForStyles: string[];
}

export function selectLoreEntries(
  entries: LoreEntry[],
  haystack: string,
  currentStyles: string[],
): LoreEntry[] {
  const hay = haystack.toLowerCase();
  const styleSet = new Set(currentStyles);
  const picked: LoreEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const byStyle = entry.constantForStyles.some((s) => styleSet.has(s));
    const byKey = entry.keys.some((k) => k.length > 0 && hay.includes(k.toLowerCase()));
    if (!byStyle && !byKey) continue;
    if (seen.has(entry.content)) continue;
    seen.add(entry.content);
    picked.push(entry);
  }
  return picked;
}

export function parseTracksMarkdown(markdown: string): LoreEntry[] {
  const entries: LoreEntry[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const bar = line.indexOf('|');
    if (bar <= 0) continue;
    const title = line.slice(0, bar).trim();
    const note = line.slice(bar + 1).trim();
    if (!title || !note) continue;
    entries.push({
      keys: [title],
      content: `《${title}》：${note}`,
      constantForStyles: [],
    });
  }
  return entries;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseLoreMarkdown(style: string, markdown: string): LoreEntry {
  const trimmed = markdown.trim();
  const match = trimmed.match(FRONTMATTER);
  if (!match) {
    return { keys: [style], content: trimmed, constantForStyles: [style] };
  }
  const keysLine = match[1]
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().startsWith('keys:'));
  const keys = keysLine
    ? keysLine
        .slice(keysLine.indexOf(':') + 1)
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : [style];
  const content = trimmed.slice(match[0].length).trim();
  return { keys, content, constantForStyles: [style] };
}
```

`packages/core/src/index.ts` 增加：`export * from './lore';`

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm --filter @ambient-radio/core exec vitest run src/lore.test.ts`

Expected: PASS（全部）

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lore.ts packages/core/src/lore.test.ts packages/core/src/index.ts
git commit -m "feat(core): add lorebook parse and select  增加世界书解析与按 haystack 选取"
```

---

### Task 2: 三明治 prompt（去掉种子立法）

**Files:**
- Modify: `packages/core/src/context.ts`
- Modify: `packages/core/src/context.test.ts`

- [ ] **Step 1: 改测试为新合同（先红）**

在 `context.test.ts` 顶部 ctx 增加可选字段不需要默认。替换/新增：

1. 把 `it('串场与主题有不同的长度约束（FR-032/033）')` 改成不再断言 `40~90 字`：

```ts
  it('串场与主题仍区分意图，但不设字数下限（FR-032/033）', () => {
    const interlude = buildSegmentPrompt({ ...ctx, kind: 'interlude' });
    const topic = buildSegmentPrompt({ ...ctx, kind: 'topic' });
    expect(interlude.user).toContain('常规串场');
    expect(interlude.user).not.toContain('40~90 字');
    expect(topic.user).toContain('小主题');
    expect(topic.user).toContain('200~450 字');
  });
```

2. 删除整个 `describe('buildSegmentPrompt · 串场起头（可选灵感 + 护栏，不强制单一角度）')` 里依赖种子的用例（灵感池、缺省护栏、护栏对所有 kind）。保留「有记忆时呈现」那条到 P3 describe。新增：

```ts
describe('buildSegmentPrompt · 酒馆式装配', () => {
  it('system 主指令短，不含起头灵感立法', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.system).toContain('写你的下一句');
    expect(p.system).not.toContain('开场千变万化');
    expect(p.user).not.toContain('可选的起头灵感');
    expect(p.user).not.toContain('起头护栏');
  });

  it('近期口播作为对话史出现在曲目信息之后', () => {
    const p = buildSegmentPrompt({
      ...ctx,
      recentSpeech: ['Last Call 这名字也太直白了。', '灯还亮着。'],
    });
    expect(p.user).toContain('Last Call 这名字也太直白了。');
    expect(p.user).toContain('灯还亮着。');
    expect(p.user.indexOf('你刚才说')).toBeGreaterThan(p.user.indexOf('《月光小径》'));
  });

  it('没有近期口播时不出现「你刚才说」', () => {
    const p = buildSegmentPrompt({ ...ctx, recentSpeech: [] });
    expect(p.user).not.toContain('你刚才说');
  });

  it('世界书条目注入正文；空则整段不出现', () => {
    const withLore = buildSegmentPrompt({
      ...ctx,
      lore: [{ content: '格莱德市霓虹酒吧。' }],
    });
    const without = buildSegmentPrompt({ ...ctx, lore: [] });
    expect(withLore.user).toContain('格莱德市霓虹酒吧。');
    expect(without.user).not.toContain('手边的世界书');
  });

  it('示例口播出现在 user 里', () => {
    const p = buildSegmentPrompt({
      ...ctx,
      speechExamples: 'Last Call 这名字也太直白了。',
    });
    expect(p.user).toContain('Last Call 这名字也太直白了。');
    expect(p.user).toContain('口吻样本');
  });

  it('时段不放在 user 第一行', () => {
    const p = buildSegmentPrompt(ctx);
    const first = p.user.split('\n')[0] ?? '';
    expect(first).not.toContain('时段背景');
    expect(p.user).toContain('周三');
  });

  it('最后一句是接着说，不是请播一段小品', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.user.trim().endsWith('接着说就好。') || p.user.includes('接着说就好')).toBe(true);
    expect(p.user).not.toContain('请播一段');
  });
});
```

3. `it('user 含时段、正在播的曲与近期曲目')` 仍应通过（周三、月光小径、晨雾）。

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm --filter @ambient-radio/core exec vitest run src/context.test.ts`

Expected: FAIL（没有 `recentSpeech` / 仍有「可选的起头灵感」/ 仍有「40~90 字」）

- [ ] **Step 3: 改 `context.ts`**

`SegmentPromptContext` 去掉 `interlude?: InterludeConfig`，改为：

```ts
  /** 最近已播口播原文（对话史） */
  recentSpeech?: string[];
  /** 已选中的世界书正文（调用方用 selectLoreEntries 选好） */
  lore?: Array<{ content: string }>;
  /** 口吻样本全文 */
  speechExamples?: string;
```

删 `DEFAULT_SEEDS`、`DEFAULT_GUARDRAILS`、对 `InterludeConfig` 的 import。

`SYSTEM_RULES` 换成：

```ts
const SYSTEM_RULES = `你是梦可，一台 AI 氛围电台的主播，正在直播。音乐在响。写你的下一句。

<persona>
{PERSONA}
</persona>

【输出】
- 严格 JSON：{"text":"要说的话","songRequest":null}
- text 会被 TTS 直接播出。不要前缀、标题、舞台指示。普通话口语。
- songRequest 仅当听众留言明显在点歌时填 {"query":"歌名或风格"}，否则 null。
- 世界书里写过的设定可以当事实；没写的不要编成事实。
- 不编造没有发生过的节目，不编「咱们一起过关」，不点名听众。`;
```

`KIND_BRIEF`：

```ts
const KIND_BRIEF: Record<SegmentKind, string> = {
  station_id:
    '台呼：非个人化的电台识别，15~35 字。带出电台名即可；不得点名、欢迎或识别当前听众，不说「欢迎回来」这类措辞。',
  interlude: '常规串场。写下一句就好，一句也可以，不必收束或祝福。',
  topic: '小主题：200~450 字。可以展开一个话题，有开头也可以没有正式收尾。',
  reply: '回应听众留言：合并理解相关内容再回应；用泛称指代听众，不点名；不确定的不接。',
  request_ack: '点歌回应：接受、延后或婉拒都可以，语气符合人格；不进入任何「模式」话术。',
};
```

`buildSegmentPrompt` 的 `lines` 顺序必须是：

1. 正在播的曲 / 换曲间隙
2. 这之前播过
3. `你刚才说：` + 近期口播（有才写）
4. 留言 / 点歌 ack
5. L1 记忆（有才写）
6. `手边的世界书（用得上再用，不是本题）：` + lore contents（有才写）
7. `口吻样本：` + speechExamples（有才写）
8. `房间：此刻${weekdayZh}${label}，${moodHint}。`（时段放这里，不是第一行）
9. 空行
10. `写「${hostName}」的下一句——${KIND_BRIEF[kind]}接着说就好。不必因为换歌而换话题，也不必提到正在放的歌。`

近期口播格式：

```
你刚才说：
- 「Last Call 这名字也太直白了。」
- 「灯还亮着。」
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm --filter @ambient-radio/core exec vitest run src/context.test.ts`

Expected: PASS。若旧用例仍找 `interlude:` 字段，删掉那些断言。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context.ts packages/core/src/context.test.ts
git commit -m "feat(core): assemble sandwich prompt with speech history  三明治 prompt：对话史与世界书，去掉种子立法"
```

---

### Task 3: producer 接线

**Files:**
- Modify: `packages/core/src/producer.ts`
- Modify: `packages/core/src/producer.test.ts`

- [ ] **Step 1: 写失败测试**

在 `producer.test.ts` 增加（`llmOk` 改成能记下 prompt 的 stub）：

```ts
it('把近期口播和命中的世界书传进 prompt', async () => {
  let seenUser = '';
  const llm: LlmClient = {
    generateSegment: async (prompt) => {
      seenUser = prompt.user;
      return { text: '灯还亮着。', songRequest: null };
    },
    extractMemories: async () => [],
  };
  const producer = createSegmentProducer({
    llm,
    tts: ttsOk,
    persona: PERSONA,
    stationName: '梦可电台',
    hostName: '梦可',
    speechExamples: 'Last Call 这名字也太直白了。',
    loreEntries: [
      {
        keys: ['Jill'],
        content: '格莱德市霓虹酒吧。',
        constantForStyles: ['va11halla'],
      },
    ],
    retrieveMemories: () => [],
    retrieveRecentSpeech: () => ['Last Call 这名字也太直白了。'],
    tracks: [track],
    view: () => ({
      now: Date.UTC(2026, 7, 19, 12, 0, 0),
      currentTrack: { ...track, styles: ['va11halla'] },
      recentTracks: [],
    }),
  });
  await producer.produce({ id: 'seg-1', kind: 'interlude' });
  expect(seenUser).toContain('Last Call 这名字也太直白了。');
  expect(seenUser).toContain('格莱德市霓虹酒吧。');
});

it('当前是 cafe 但上一句提到 Jill 时仍注入 VA-11 世界书', async () => {
  let seenUser = '';
  const llm: LlmClient = {
    generateSegment: async (prompt) => {
      seenUser = prompt.user;
      return { text: '那封信。', songRequest: null };
    },
    extractMemories: async () => [],
  };
  const producer = createSegmentProducer({
    llm,
    tts: ttsOk,
    persona: PERSONA,
    stationName: '梦可电台',
    hostName: '梦可',
    speechExamples: '',
    loreEntries: [
      {
        keys: ['Jill'],
        content: '格莱德市霓虹酒吧。',
        constantForStyles: ['va11halla'],
      },
    ],
    retrieveMemories: () => [],
    retrieveRecentSpeech: () => ['Jill 那封信我还记得。'],
    tracks: [track],
    view: () => ({
      now: Date.UTC(2026, 7, 19, 12, 0, 0),
      currentTrack: track, // styles: cafe
      recentTracks: [],
    }),
  });
  await producer.produce({ id: 'seg-2', kind: 'interlude' });
  expect(seenUser).toContain('格莱德市霓虹酒吧。');
});
```

把 `producerOf` 里的 `interlude: DEFAULT_INTERLUDE_CONFIG` 换成：

```ts
    speechExamples: '',
    loreEntries: [],
    retrieveRecentSpeech: () => [],
```

并删掉 `DEFAULT_INTERLUDE_CONFIG` import。

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm --filter @ambient-radio/core exec vitest run src/producer.test.ts`

Expected: FAIL（`interlude` / 缺少新字段）

- [ ] **Step 3: 改 producer**

`SegmentProducerOptions` 删除 `interlude: InterludeConfig`，增加：

```ts
import { selectLoreEntries, type LoreEntry } from './lore';

  speechExamples: string;
  loreEntries: LoreEntry[];
  retrieveRecentSpeech: () => string[];
```

`produce` 内：

```ts
      const view = options.view();
      const memories = options.retrieveMemories(view.now);
      const recentSpeech = options.retrieveRecentSpeech();
      const styles = view.currentTrack?.styles ?? [];
      const haystack = [
        ...recentSpeech,
        view.currentTrack?.title ?? '',
        ...styles,
      ].join('\n');
      const lore = selectLoreEntries(options.loreEntries, haystack, styles);
      const prompt = buildSegmentPrompt({
        kind: plan.kind,
        persona: options.persona,
        stationName: options.stationName,
        hostName: options.hostName,
        dayPart: getDayPartContext(new Date(view.now)),
        currentTrack: view.currentTrack,
        recentTracks: view.recentTracks,
        recentSpeech,
        lore,
        speechExamples: options.speechExamples,
        replyTo: plan.replyTo,
        ackTitle: plan.ackTitle,
        memories: memories.map((m) => ({
          kind: m.kind,
          text: m.text,
          importance: m.importance,
        })),
      });
```

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter @ambient-radio/core exec vitest run src/producer.test.ts src/context.test.ts src/lore.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/producer.ts packages/core/src/producer.test.ts
git commit -m "feat(core): feed speech history and lore into producer  段落生产接入对话史与世界书"
```

---

### Task 4: 删掉 InterludeConfig（干净切换）

**Files:**
- Modify: `packages/core/src/config.ts`（删除 `InterludeConfig` 与 `DEFAULT_INTERLUDE_CONFIG`）
- Modify: `apps/station/src/config.ts`
- Modify: `apps/station/src/radio.ts`
- Modify: `apps/station/src/index.ts`（先删 interlude 传参；lore 加载在 Task 5 补）
- Modify: `config/station.config.json`（删除整个 `"interlude"` 块）

- [ ] **Step 1: 全仓搜 `InterludeConfig` / `interludeConfig` / `DEFAULT_INTERLUDE`，按调用点删。** `loadStationConfig` 不再读 `raw.interlude`。`RadioDeps` 先改成仍能编译：`speechExamples: string; loreEntries: LoreEntry[]`，index.ts 暂时传 `speechExamples: ''`、`loreEntries: []`（Task 5 填真值）。producer 已不接受 interlude。

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter @ambient-radio/core exec tsc --noEmit -p tsconfig.json`

Run: `pnpm --filter @ambient-radio/station exec tsc --noEmit -p tsconfig.json`

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/config.ts apps/station/src/config.ts apps/station/src/radio.ts apps/station/src/index.ts config/station.config.json
git commit -m "refactor(config): drop interlude seeds  删除串场种子与护栏配置"
```

---

### Task 5: station 读 lore 文件 + 近期已播

**Files:**
- Create: `apps/station/src/lore-files.ts`
- Create: `apps/station/src/lore-files.test.ts`
- Modify: `apps/station/src/radio.ts`
- Modify: `apps/station/src/index.ts`

- [ ] **Step 1: lore-files 测试**

`apps/station` 的 vitest 跟仓库根 `pnpm test`（`packages/*/src/**/*.test.ts` 与 apps 是否包含：看 `vitest.config.ts`）。若 station 测试未被根配置收录，把测试放在 `apps/station/src/lore-files.test.ts` 并确认 vitest include。

当前 `vitest.config.ts` 若只扫 `packages/*/src/**/*.test.ts`，则把加载函数做成纯路径注入、测试放 `packages/core` 已覆盖 parse；station 侧用临时目录测 IO：

检查 `vitest.config.ts`。若 station 不在 include，把 `loadLibraryLore(root: string)` 的测试放到 `packages/core` 不合适（有 IO）。两种做法选一：扩大 vitest include 为 `apps/station/src/**/*.test.ts`，或用 node:test。本仓库惯例是 Vitest —— 改根 `vitest.config.ts` include 增加 `apps/*/src/**/*.test.ts`。

`lore-files.test.ts`：

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLibraryLore, loadSpeechExamples } from './lore-files';

describe('loadLibraryLore', () => {
  it('读每个子文件夹的 lore.md 与 tracks.md；缺文件不抛', () => {
    const root = mkdtempSync(join(tmpdir(), 'lore-'));
    mkdirSync(join(root, 'va11halla'));
    writeFileSync(join(root, 'va11halla', 'lore.md'), '格莱德市酒吧。', 'utf-8');
    writeFileSync(
      join(root, 'va11halla', 'tracks.md'),
      'Last Call | 打烊点\n',
      'utf-8',
    );
    mkdirSync(join(root, 'cafe'));
    const entries = loadLibraryLore(root);
    expect(entries.some((e) => e.content.includes('格莱德市酒吧'))).toBe(true);
    expect(entries.some((e) => e.keys.includes('Last Call'))).toBe(true);
    expect(() => loadLibraryLore(root)).not.toThrow();
  });
});

describe('loadSpeechExamples', () => {
  it('文件不存在时返回空字符串', () => {
    expect(loadSpeechExamples(join(tmpdir(), 'no-such-examples.md'))).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm exec vitest run apps/station/src/lore-files.test.ts`

Expected: FAIL 或文件未被 include。先改 `vitest.config.ts` 的 `include` 为：

```ts
include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
```

再跑，预期找不到模块。

- [ ] **Step 3: 实现 `lore-files.ts`**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLoreMarkdown, parseTracksMarkdown, type LoreEntry } from '@ambient-radio/core';

export function loadLibraryLore(libraryRoot: string): LoreEntry[] {
  const entries: LoreEntry[] = [];
  if (!existsSync(libraryRoot)) return entries;
  for (const dir of readdirSync(libraryRoot, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const style = dir.name;
    const lorePath = join(libraryRoot, style, 'lore.md');
    const tracksPath = join(libraryRoot, style, 'tracks.md');
    if (existsSync(lorePath)) {
      entries.push(parseLoreMarkdown(style, readFileSync(lorePath, 'utf-8')));
    }
    if (existsSync(tracksPath)) {
      entries.push(...parseTracksMarkdown(readFileSync(tracksPath, 'utf-8')));
    }
  }
  return entries;
}

export function loadSpeechExamples(path: string): string {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8').trim();
}
```

`radio.ts`：

- `RadioDeps` 删除 `interludeConfig`，增加 `speechExamples: string; loreEntries: LoreEntry[]`
- producer 传入这两项
- `retrieveRecentSpeech: () => { const segs = deps.store.listSegments().filter((s) => s.status === 'aired' && s.airedAt !== null && s.text.trim().length > 0); segs.sort((a, b) => (a.airedAt ?? 0) - (b.airedAt ?? 0)); return segs.slice(-4).map((s) => s.text); }`

`index.ts`：

```ts
  const speechExamples = loadSpeechExamples(resolve(repoRoot, 'config', 'speech-examples.md'));
  const loreEntries = loadLibraryLore(libraryRoot);
  // createRadio({ ..., speechExamples, loreEntries })
```

- [ ] **Step 4: 测试 + tsc**

Run: `pnpm exec vitest run apps/station/src/lore-files.test.ts packages/core/src/producer.test.ts`

Run: `pnpm --filter @ambient-radio/station exec tsc --noEmit -p tsconfig.json`

Expected: PASS / 无错误

- [ ] **Step 5: Commit**

```bash
git add apps/station/src/lore-files.ts apps/station/src/lore-files.test.ts apps/station/src/radio.ts apps/station/src/index.ts vitest.config.ts
git commit -m "feat(station): load work lore and recent aired speech  组装层加载世界书与近期口播"
```

---

### Task 6: 燃料文件（VA-11 世界书、示例、人格）

**Files:**
- Create: `config/speech-examples.md`
- Create: `config/library/va11halla/lore.md`
- Create: `config/library/va11halla/tracks.md`
- Modify: `config/persona.md`

这些是维护者所有的内容，不是门禁。写完即可听，维护者可改。

- [ ] **Step 1: `config/speech-examples.md`**

```markdown
（几拍口吻，不是立法。模型看样子。）

Last Call 这名字也太直白了。

灯还亮着，杯子该收了。不等客人自己说再见。

Jill 收到前女友那封信的时候，酒吧里谁都不说话。我过到那段就是这种夜。

这边倒是轻快起来了。像有人开始擦杯子。

哦，房间味道有点变。也可以不提。
```

- [ ] **Step 2: `config/library/va11halla/lore.md`**

```markdown
---
keys: Jill, Dana, Gillian, VA-11, VA-11 Hall-A, 格莱德, Glitch City, Kira
---
VA-11 Hall-A：格莱德市（Glitch City）一间霓虹酒吧的游戏。夜班、调酒、客人把话放在吧台上。

梦可可以像呆在吧台内侧那样说话，也可以说「我过到某一段就是这首」——那是作品记忆，不是人生。她没有在格莱德打过工，不是 Jill。

可聊：酒吧的夜、杯子、霓虹、打烊、雨、客人把心事放下又拿走、调酒、员工之间的闲话、Jill 和前女友的信、Dana、Gillian、Kira 那只猫、Sex on the Beach 这杯不该点得那么勤。剧情可以顺着今晚的线往下聊。

不要对听众祝愿或做总结。不要编「咱们一起过关」。
```

- [ ] **Step 3: `config/library/va11halla/tracks.md`**

不必写全 75 首。有钩子的先写：

```
Last Call | 打烊点。灯还亮，杯子该收了。
Meet the Staff | 员工介绍，步子轻，像开始擦杯子。
Welcome to VA-11 Hall-A | 进门。
A Neon Glow Lights the Way | 霓虹把路照出来。
Every Day is Night | 格莱德没有真正的白天。
Who Was I | 问自己是谁的那种夜。
Showtime! | 吧台亮起来。
Snowfall | 店外在下雪。
Dawn Approaches | 夜快结束，不是清晨鸡汤。
Dusk | 黄昏压下来。
You've Got Me | 有人把你接住。
Hopes and Dreams | 还没进门的那点盼头。
```

- [ ] **Step 4: `config/persona.md`「说话方式」整段换成：**

```markdown
## 说话方式

- 普通话清晰，语速舒缓，句子偏短，善用停顿。
- 写下一句就好。不必把事情说完，不必祝福听众，不必因为换歌而换话题。
- 世界书和曲目卡里写过的设定可以当事实来聊，包括剧情；没写的不要编成设定。
- 可以说「我过到这段就是这首」这类作品记忆。不要编童年、打工、在格莱德活过，也不要编与听众一起过关。
- 对听众使用泛称（如「收音机前的你」），不点名、不识别、不建立私人关系。不强制每句都对人说话。
- 婉拒与告别也要温柔得体。
```

待填区「她对哪些话题有天然的偏爱」补一句：游戏夜里的公共空间（酒吧、便利店、车站），不编自己在里面生活过。电台在她口中可以叫「这个频率」。

- [ ] **Step 5: Commit**

```bash
git add config/speech-examples.md config/library/va11halla/lore.md config/library/va11halla/tracks.md config/persona.md
git commit -m "feat(config): add VA-11 lorebook and speech examples  增加 VA-11 世界书与口吻样本"
```

---

### Task 7: PRD / 技术方案 / README 口径

**Files:**
- Modify: `docs/product-requirements.md`
- Modify: `docs/technical-design.md`
- Modify: `README.md`

- [ ] **Step 1: PRD 5.3**

```
- `FR-032` 大多数串场大约 5 至 15 秒；10 至 25 秒仍是舒适上限，不是必须填满。
- `FR-034` 主播可以谈论当前音乐或当前作品，也可以完全不提正在放的歌；不得逐首报幕或把节目变成歌曲解说。
- `FR-035` 主持内容来自主播自己的观察、持续主题、节目记忆、轻松话题和作品世界。跨段续聊、把一条作品线（含剧情）往下聊，都算持续主题。换题是聊天自己飘走，不是播放列表下发的任务。
- `FR-037` 主播不得把未经核实的歌曲背景、作者经历或现实信息当作事实播出。维护者写在世界书 / 曲目卡里的设定视为已核实。
```

`FR-036` 不动。文档顶部修订记录加一行：2026-09-01 说话合同按酒馆式装配放宽（FR-032/034/035/037）。

- [ ] **Step 2: 技术方案 §4.3** 在「防编造机制」旁补：上下文含近期已播口播（对话史）与按 haystack 选取的世界书；主指令短；种子/护栏不再注入。世界书不是实时资讯（FR-036）。

- [ ] **Step 3: README「调电台」表**

删除 interlude 行与「往 seeds 里加灵感」。改成：

| 区块 | 管什么 |
|---|---|
| `config/library/<风格>/lore.md` | 该作品世界书（词典，聊到才进 prompt） |
| `config/library/<风格>/tracks.md` | 曲名备注 |
| `config/speech-examples.md` | 口吻样本 |
| `config/persona.md` | 她是谁（不要写作品百科） |

- [ ] **Step 4: Commit**

```bash
git add docs/product-requirements.md docs/technical-design.md README.md
git commit -m "docs: update speech contract for lorebook assembly  更新说话口径与世界书装配说明"
```

---

### Task 8: 全量验证

- [ ] **Step 1:** `pnpm test`

Expected: 全绿。

- [ ] **Step 2:** `pnpm check`

Expected: biome 通过。若仅格式问题：`pnpm exec biome check --write .` 后再 check。

- [ ] **Step 3:** `pnpm --filter @ambient-radio/core exec tsc --noEmit -p tsconfig.json`

- [ ] **Step 4:** 维护者 Vibe Check（本任务不代替）：开台 30 分钟，对照 spec §8。不在 CI 里做。

---

## Self-review

**Spec coverage**

| spec | task |
|---|---|
| 主指令短 | 2 |
| persona 与世界书分开 | 6 |
| 近期口播当对话史 | 2, 3, 5 |
| 示例 mes_example | 2, 6 |
| 世界书词典、续聊跨风格仍带书 | 1, 3 |
| 切歌不改题目 | 2 最后一句 + 不改 engine |
| 剧情 / 作品记忆可说 | 6 lore + persona |
| 无许可状态机 / 无字数门禁 | 2 删 40~90 与种子 |
| 删 seeds | 4 |
| FR 口径 | 7 |
| core 零 IO | 1–3 纯函数；5 才读文件 |

**Placeholder scan:** 无 TBD。vitest include 若已包含 apps，Task 5 Step 2 的配置改动可跳过。

**类型:** `LoreEntry` 在 Task 1 定义，Task 3/5 沿用；`retrieveRecentSpeech: () => string[]`；`speechExamples: string`。
