import { describe, expect, it } from 'vitest';
import type { Entity } from './types';
import { collectEntityText, findUnlinkedMentions, linkPlainMention, parseWikiLinks, resolveWikiLinks } from './wiki';

const now = new Date('2026-01-01T00:00:00.000Z');
const entity = (id: string, name: string, extra: Partial<Entity> = {}): Entity => ({
  id, worldId: 'w', typeId: 't', name, subtitle: '', parentEntityId: null, document: {}, documentText: '', tags: [], canonStatus: 'draft', revision: 1n, createdAt: now, updatedAt: now, ...extra,
});

describe('wiki links', () => {
  it('parses wikilinks and @mentions', () => {
    const links = parseWikiLinks('阿伦进入[[黑塔]]，遇见@李衡 与 @[北辰皇帝]。');
    expect(links.map((link) => ({ name: link.name, kind: link.kind }))).toEqual([
      { name: '黑塔', kind: 'wikilink' },
      { name: '李衡', kind: 'mention' },
      { name: '北辰皇帝', kind: 'mention' },
    ]);
  });

  it('resolves aliases from tags and finds unlinked names', () => {
    const tower = entity('tower', '黑塔', { tags: ['Black Tower'] });
    const arlen = entity('arlen', '阿伦');
    const text = '阿伦进入黑塔。';
    expect(findUnlinkedMentions(text, [tower, arlen]).map((item) => item.name)).toEqual(['阿伦', '黑塔']);
    const linked = linkPlainMention(text, '阿伦');
    expect(linked).toBe('[[阿伦]]进入黑塔。');
    expect(findUnlinkedMentions(linked, [tower, arlen]).map((item) => item.name)).toEqual(['黑塔']);
    expect(resolveWikiLinks(parseWikiLinks('走进[[Black Tower]]'), [tower])[0]?.entityId).toBe('tower');
  });

  it('collects nested document strings for mention scanning', () => {
    const source = entity('s', 'Scribe', { documentText: 'intro', document: { markdown: '阿伦进入黑塔。', nested: { note: 'again' } } });
    expect(collectEntityText(source)).toContain('阿伦进入黑塔。');
    expect(collectEntityText(source)).toContain('again');
  });
});
