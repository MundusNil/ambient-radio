import { describe, expect, it } from 'vitest';
import { parseLoreMarkdown, parseTracksMarkdown, selectLoreEntries } from './lore';
import type { LoreEntry } from './lore';

const va11halla: LoreEntry = {
  keys: ['Jill', 'Dana', 'VA-11'],
  content: 'VA-11 Hall-A lore',
  constantForStyles: ['va11halla'],
};

describe('selectLoreEntries', () => {
  it('current track style matches constantForStyles → inject even if haystack empty', () => {
    expect(selectLoreEntries([va11halla], '', ['va11halla'])).toEqual([va11halla]);
  });

  it('haystack mentions a key (e.g. Jill) → inject even if current style is cafe', () => {
    expect(selectLoreEntries([va11halla], 'Jill walked in', ['cafe'])).toEqual([va11halla]);
  });

  it('neither style nor key → empty', () => {
    expect(selectLoreEntries([va11halla], 'a quiet afternoon', ['cafe'])).toEqual([]);
  });

  it('key match is case-insensitive', () => {
    expect(selectLoreEntries([va11halla], 'jill walked in', ['cafe'])).toEqual([va11halla]);
  });
});

describe('parseTracksMarkdown', () => {
  it('Last Call | 打烊点 → keys, content, empty constantForStyles', () => {
    expect(parseTracksMarkdown('Last Call | 打烊点')).toEqual([
      {
        keys: ['Last Call'],
        content: '《Last Call》：打烊点',
        constantForStyles: [],
      },
    ]);
  });

  it('skip blank lines and # comments', () => {
    const markdown = [
      '',
      '# comment',
      'Last Call | 打烊点',
      '',
      '# another',
      'Moon | 月光',
    ].join('\n');

    expect(parseTracksMarkdown(markdown)).toEqual([
      {
        keys: ['Last Call'],
        content: '《Last Call》：打烊点',
        constantForStyles: [],
      },
      {
        keys: ['Moon'],
        content: '《Moon》：月光',
        constantForStyles: [],
      },
    ]);
  });
});

describe('parseLoreMarkdown', () => {
  it('no frontmatter: keys=[style], content=trimmed body, constantForStyles=[style]', () => {
    expect(parseLoreMarkdown('cafe', '  咖啡馆的灯光  \n')).toEqual({
      keys: ['cafe'],
      content: '咖啡馆的灯光',
      constantForStyles: ['cafe'],
    });
  });

  it('YAML frontmatter keys and constantForStyles from style', () => {
    const markdown = `---
keys: Jill, Dana, VA-11
---
正文
`;
    expect(parseLoreMarkdown('va11halla', markdown)).toEqual({
      keys: ['Jill', 'Dana', 'VA-11'],
      content: '正文',
      constantForStyles: ['va11halla'],
    });
  });
});
