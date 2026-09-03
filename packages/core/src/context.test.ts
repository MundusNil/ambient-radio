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

/** 2026-09-02 已播失败样例：糖水铺连续剧。护栏必须看见它并禁止续写。 */
const SUGAR_SHOP_SERIAL = [
  '风里飘来点姜糖的甜。是对面糖水铺刚开锅吧。扎马尾的姑娘掀了帘子进去。',
  '它在门槛边蹲住了。尾巴盘成个小毛圈。没敢往里蹭。铜铃又轻响了一声。',
];

describe('buildSegmentPrompt', () => {
  it('system 注入人格全文与直播规则', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.system).toContain(PERSONA);
    expect(p.system).toContain('你是梦可，一台 AI 氛围电台的主播，正在直播');
    expect(p.system).not.toContain('{PERSONA}');
  });

  it('system 注入配置的电台名，台呼不用自报「氛围电台」', () => {
    const p = buildSegmentPrompt({ ...ctx, kind: 'station_id' });
    expect(p.system).toContain('你的电台叫「梦可电台」');
    expect(p.system).not.toContain('{STATION_NAME}');
  });

  it('常规串场不把曲名、时段、moodHint 写成开口指令', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.user).not.toContain('《月光小径》');
    expect(p.user).not.toContain('《晨雾》');
    expect(p.user).not.toContain('周三');
    expect(p.user).not.toContain('渐暗');
    expect(p.user).not.toContain('此刻');
    expect(p.system).toContain('不报时式开场');
  });

  it('reply 才给正在播的曲名，便于回应点歌或问歌', () => {
    const p = buildSegmentPrompt({
      ...ctx,
      kind: 'reply',
      replyTo: [{ id: 'm1', body: '这首是什么' }],
    });
    expect(p.user).toContain('《月光小径》');
    expect(p.user).toContain('这首是什么');
  });

  it('台呼约束明确禁止点名与「欢迎回来」（FR-005）', () => {
    const p = buildSegmentPrompt({ ...ctx, kind: 'station_id' });
    expect(p.user).toContain('不得点名');
    expect(p.user).toContain('欢迎回来');
  });

  it('串场只约束意图不设字数门禁（FR-032/033），但不再教具体意象', () => {
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
    expect(interlude.user).toContain('话少不硬撑');
    expect(interlude.user).toContain('不要描写房间');
  });

  it('开口说完就停，不留半句给下次', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.system).toContain('说完就停');
    expect(p.system).toContain('不要留半句等下次接');
    expect(p.user).toContain('说完再停');
  });

  it('文案与韵律解耦：只要整段 text，不要逐句 emotion/pause', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.system).toContain('"text"');
    expect(p.system).toContain('songRequest');
    expect(p.system).not.toContain('"lines"');
    expect(p.system).not.toContain('emotion');
    expect(p.system).not.toContain('pause');
    expect(p.system).toContain('不要写分镜');
  });

  it('克制规则：禁固定街景连续剧、报时开场、逐首报幕与客套收尾', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.system).toContain('不要凭空搭房间、街景、店');
    expect(p.system).toContain('不报时式开场');
    expect(p.system).toContain('不逐首报幕');
    expect(p.system).toContain('希望你');
  });

  it('换曲间隙的常规串场也不出现曲名', () => {
    const p = buildSegmentPrompt({ ...ctx, kind: 'interlude', currentTrack: null });
    expect(p.user).not.toContain('《月光小径》');
    expect(p.user).not.toContain('换曲的间隙');
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

  it('记忆引用点到为止，不扩写成场景描写', () => {
    const p = buildSegmentPrompt({
      ...ctx,
      kind: 'interlude',
      memories: [{ kind: 'topic', text: '聊过亮着灯的小店', importance: 0.5 }],
    });
    expect(p.user).toContain('引用点到为止，不要扩写成场景描写');
  });

  it('没有记忆时不出现记忆段落', () => {
    const p = buildSegmentPrompt({ ...ctx, kind: 'interlude' });
    expect(p.user).not.toContain('你记得的节目历史');
  });
});

describe('buildSegmentPrompt · 非酒馆装配', () => {
  it('没有上一段口播时不注入续聊燃料', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.user).not.toContain('你刚才说');
    expect(p.user).not.toContain('刚才播出过');
    expect(p.user).not.toContain('口吻参考');
    expect(p.user).not.toContain('口吻样本');
  });

  it('上一段口播只作禁止续写的护栏，不当续聊', () => {
    const p = buildSegmentPrompt({
      ...ctx,
      recentAired: SUGAR_SHOP_SERIAL.map((text) => ({ kind: 'interlude' as const, text })),
    });
    expect(p.user).toContain('不要续写其中的情节、角色或场景');
    expect(p.user).toContain('糖水铺');
    expect(p.user).toContain('门槛');
    expect(p.user).not.toContain('接着说就好');
    expect(p.user).not.toContain('你刚才说');
  });

  it('收尾是播报式「现在开口」，不是续聊式「接着说就好」', () => {
    const p = buildSegmentPrompt(ctx);
    expect(p.user).toContain('现在开口');
    expect(p.user).not.toContain('接着说就好');
    expect(p.user).not.toContain('请播一段');
    expect(p.system).not.toContain('写你的下一句');
  });
});
