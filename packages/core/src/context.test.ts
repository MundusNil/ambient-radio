import { describe, expect, it } from 'vitest';
import { buildSegmentPrompt } from './context';
import { getDayPartContext } from './time';

const PERSONA = '# 梦可\n温柔、安静、细腻、克制。';

const ctx = {
  kind: 'interlude' as const,
  persona: PERSONA,
  stationName: '梦可电台',
  hostName: '梦可',
  dayPart: getDayPartContext(new Date(2026, 7, 19, 20, 0)),
  currentTrack: { title: '月光小径', artist: null, styles: ['cafe'] },
  recentTracks: [{ title: '晨雾', artist: null, styles: ['game-bgm'] }],
};

describe('buildSegmentPrompt', () => {
  it('system 注入人格全文与直播规则', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.system).toContain(PERSONA);
    expect(p.system).toContain('TTS');
    expect(p.system).not.toContain('{PERSONA}');
  });

  it('user 含时段、正在播的曲与近期曲目（FR-036）', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.user).toContain('周三');
    expect(p.user).toContain('《月光小径》');
    expect(p.user).toContain('《晨雾》');
  });

  it('台呼约束明确禁止点名与「欢迎回来」（FR-005）', () => {
    const p = buildSegmentPrompt({ ...ctx, kind: 'station_id' });
    expect(p.user).toContain('不得点名');
    expect(p.user).toContain('欢迎回来');
  });

  it('串场与主题有不同的长度约束（FR-032/033）', () => {
    const interlude = buildSegmentPrompt({ ...ctx, kind: 'interlude' });
    const topic = buildSegmentPrompt({ ...ctx, kind: 'topic' });
    expect(interlude.user).toContain('40~90 字');
    expect(topic.user).toContain('200~450 字');
  });

  it('换曲间隙没有曲目信息时不出现《》', () => {
    const p = buildSegmentPrompt({ ...ctx, kind: 'interlude', currentTrack: null });
    expect(p.user).toContain('换曲的间隙');
    expect(p.user).not.toContain('《月光小径》');
  });
});

describe('buildSegmentPrompt · P2 互动（reply / request_ack）', () => {
  it('reply 提示词包含听众留言（合并多条，FR-054）', () => {
    const p = buildSegmentPrompt({
      ...ctx,
      kind: 'reply',
      replyTo: [
        { id: 'm1', body: '今晚的歌好好听' },
        { id: 'm2', body: '主播晚安' },
      ],
    });
    expect(p.user).toContain('今晚的歌好好听');
    expect(p.user).toContain('主播晚安');
  });

  it('request_ack 提示词包含被受理的曲名', () => {
    const p = buildSegmentPrompt({ ...ctx, kind: 'request_ack', ackTitle: '月光小径' });
    expect(p.user).toContain('月光小径');
  });

  it('reply 提示词明确要求不点名（FR-005 延伸）', () => {
    const p = buildSegmentPrompt({ ...ctx, kind: 'reply', replyTo: [{ id: 'm1', body: '嗨' }] });
    expect(p.user).toContain('泛称');
  });
});

describe('buildSegmentPrompt · P3 记忆（FR-071/072）', () => {
  it('L1 记忆进入提示词，标注只可引用真实发生过的事（FR-074）', () => {
    const p = buildSegmentPrompt({
      ...ctx,
      kind: 'interlude',
      memories: [
        { kind: 'promise', text: '答应过听众下次放一首安静的歌', importance: 0.8 },
        { kind: 'meme', text: '「暖色调」成了节目内部梗', importance: 0.6 },
      ],
    });
    expect(p.user).toContain('答应过听众下次放一首安静的歌');
    expect(p.user).toContain('「暖色调」成了节目内部梗');
    expect(p.user).toContain('只可引用这些真实发生过的事');
  });

  it('没有记忆时不出现记忆段落', () => {
    const p = buildSegmentPrompt({ ...ctx, kind: 'interlude' });
    expect(p.user).not.toContain('你记得的节目历史');
  });
});

describe('buildSegmentPrompt · 串场起头多样性（去掉报时式死板开场）', () => {
  it('时段背景仍作为参考出现，但没有强制「现在是周X」起头（FR-036）', () => {
    const p = buildSegmentPrompt({ ...ctx, kind: 'interlude', openerSeed: 0.5 });
    expect(p.user).toContain('时段背景');
    expect(p.user).toContain('周三');
    expect(p.user).toContain('起头建议');
  });

  it('同样上下文、不同 seed → 起头角度不同（不再千篇一律）', () => {
    const a = buildSegmentPrompt({ ...ctx, kind: 'interlude', openerSeed: 0.05 });
    const b = buildSegmentPrompt({ ...ctx, kind: 'interlude', openerSeed: 0.5 });
    const c = buildSegmentPrompt({ ...ctx, kind: 'interlude', openerSeed: 0.95 });
    const set = new Set([a.user, b.user, c.user]);
    expect(set.size).toBeGreaterThan(1);
  });

  it('seed < timeOpenerRatio 用「瞥一眼钟」式起头；否则从音乐/观察起头', () => {
    const cfg = { timeOpenerRatio: 0.2, seeds: ['从音乐感受起头。'] };
    const time = buildSegmentPrompt({ ...ctx, kind: 'interlude', interlude: cfg, openerSeed: 0.1 });
    const other = buildSegmentPrompt({
      ...ctx,
      kind: 'interlude',
      interlude: cfg,
      openerSeed: 0.9,
    });
    expect(time.user).toContain('窗外');
    expect(other.user).toContain('从音乐感受起头');
    expect(other.user).not.toContain('窗外');
  });

  it('有记忆时额外提供「接记忆」起头角度', () => {
    const p = buildSegmentPrompt({
      ...ctx,
      kind: 'interlude',
      openerSeed: 0.5,
      memories: [{ kind: 'meme', text: '「暖色调」成了节目内部梗', importance: 0.6 }],
    });
    expect(p.user).toContain('内部梗');
  });

  it('station_id / reply 等段落也保留起头建议（统一去报时）', () => {
    const p = buildSegmentPrompt({ ...ctx, kind: 'station_id', openerSeed: 0.7 });
    expect(p.user).toContain('起头建议');
  });
});
