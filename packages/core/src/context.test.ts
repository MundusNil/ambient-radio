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
