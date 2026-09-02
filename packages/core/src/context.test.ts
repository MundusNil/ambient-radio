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
    expect(p.system).toContain('你是梦可，一台 AI 氛围电台的主播，正在直播');
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

  it('各段落都不再设字数上限或下限（长度自由，FR-032/033）', () => {
    const interlude = buildSegmentPrompt({ ...ctx, kind: 'interlude' });
    const topic = buildSegmentPrompt({ ...ctx, kind: 'topic' });
    const stationId = buildSegmentPrompt({ ...ctx, kind: 'station_id' });
    expect(interlude.user).toContain('常规串场');
    expect(topic.user).toContain('小主题');
    for (const p of [interlude, topic, stationId]) {
      expect(p.user).not.toContain('40~90 字');
      expect(p.user).not.toContain('200~450 字');
      expect(p.user).not.toContain('15~35 字');
    }
    expect(interlude.user).toContain('三五个字也行');
    expect(topic.user).toContain('几十字到几百字都行');
  });

  it('开口说完就停，不留半句给下次', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.system).toContain('说完就停');
    expect(p.system).toContain('不要留半句等下次接');
    expect(p.user).toContain('说完再停');
  });

  it('逐句韵律：system 要求每句给出 emotion / pause，不再要求 speed（语速系统固定）', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.system).toContain('"lines"');
    expect(p.system).not.toContain('speed');
    expect(p.system).toContain('emotion');
    expect(p.system).toContain('pause');
    expect(p.system).toContain('happy');
    expect(p.system).toContain('不要写 <#0.5#> 这类标记');
  });

  it('近期口播用来避免重复同一段话', () => {
    const p = buildSegmentPrompt({ ...ctx, recentSpeech: ['灯还亮着。'] });
    expect(p.user).toContain('你刚才说过');
    expect(p.user).toContain('别重复同一段话');
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

describe('buildSegmentPrompt · 酒馆式装配', () => {
  it('system 主指令短，不含起头灵感立法', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.system).toContain('像跟旁边的人随口聊');
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

  it('示例口播出现在 user 里', () => {
    const p = buildSegmentPrompt({
      ...ctx,
      speechExamples: 'Last Call 这名字也太直白了。',
    });
    expect(p.user).toContain('口吻参考');
    expect(p.user).toContain('Last Call 这名字也太直白了。');
  });

  it('时段不放在 user 第一行', () => {
    const p = buildSegmentPrompt(ctx);
    const first = p.user.split('\n')[0] ?? '';
    expect(first).not.toContain('时段背景');
    expect(p.user).toContain('周三');
  });

  it('收尾指令是「说完再停」，不是「请播一段」', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.user).toContain('说完再停');
    expect(p.user).not.toContain('请播一段');
    expect(p.user).not.toContain('接着说就好');
  });
});
