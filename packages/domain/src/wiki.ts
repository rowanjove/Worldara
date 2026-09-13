import type { Entity } from './types';

export type WikiLinkKind = 'wikilink' | 'mention';

export interface WikiLink {
  raw: string;
  name: string;
  display?: string;
  kind: WikiLinkKind;
  start: number;
  end: number;
}

export interface ResolvedWikiLink extends WikiLink {
  entityId: string;
}

export interface UnlinkedMention {
  name: string;
  entityId: string;
  start: number;
  end: number;
}

export interface EntityBacklink {
  entityId: string;
  name: string;
  links: ResolvedWikiLink[];
}

const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const MENTION = /@\[([^\]]+)\]|@([^\s\[\]@]+)/g;

export function entitySearchNames(entity: Pick<Entity, 'id' | 'name' | 'subtitle' | 'tags'>): string[] {
  const names = [entity.name, entity.subtitle, ...entity.tags];
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

export function parseWikiLinks(text: string): WikiLink[] {
  const links: WikiLink[] = [];
  const occupied: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(WIKILINK)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const name = match[1]?.trim() ?? '';
    if (!name) continue;
    const display = match[2]?.trim();
    links.push({ raw: match[0], name, ...(display ? { display } : {}), kind: 'wikilink', start, end });
    occupied.push({ start, end });
  }
  for (const match of text.matchAll(MENTION)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (occupied.some((span) => start < span.end && end > span.start)) continue;
    const name = (match[1] ?? match[2] ?? '').trim();
    if (!name) continue;
    links.push({ raw: match[0], name, kind: 'mention', start, end });
    occupied.push({ start, end });
  }
  return links.sort((left, right) => left.start - right.start);
}

export function resolveWikiLinks(links: WikiLink[], entities: Array<Pick<Entity, 'id' | 'name' | 'subtitle' | 'tags'>>): ResolvedWikiLink[] {
  const catalog = entities.flatMap((entity) => entitySearchNames(entity).map((name) => ({ name: name.toLocaleLowerCase(), entityId: entity.id })));
  const resolved: ResolvedWikiLink[] = [];
  for (const link of links) {
    const match = catalog.find((item) => item.name === link.name.toLocaleLowerCase());
    if (match) resolved.push({ ...link, entityId: match.entityId });
  }
  return resolved;
}

export function findUnlinkedMentions(text: string, entities: Array<Pick<Entity, 'id' | 'name' | 'subtitle' | 'tags'>>): UnlinkedMention[] {
  const linked = parseWikiLinks(text);
  const occupied = linked.map((link) => ({ start: link.start, end: link.end }));
  const candidates = entities
    .flatMap((entity) => entitySearchNames(entity).map((name) => ({ name, entityId: entity.id })))
    .sort((left, right) => right.name.length - left.name.length);
  const mentions: UnlinkedMention[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.name.length < 2) continue;
    const pattern = mentionPattern(candidate.name);
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (occupied.some((span) => start < span.end && end > span.start)) continue;
      const key = `${candidate.entityId}:${start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mentions.push({ name: candidate.name, entityId: candidate.entityId, start, end });
      occupied.push({ start, end });
    }
  }
  return mentions.sort((left, right) => left.start - right.start);
}

export function linkPlainMention(text: string, name: string): string {
  const linked = parseWikiLinks(text);
  const pattern = mentionPattern(name);
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (linked.some((link) => start < link.end && end > link.start)) continue;
    return `${text.slice(0, start)}[[${name}]]${text.slice(end)}`;
  }
  return text;
}

export function collectEntityText(entity: Pick<Entity, 'documentText' | 'document'>): string {
  const parts = [entity.documentText ?? ''];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(entity.document);
  return parts.join('\n');
}

export function rewriteEntityStrings<T extends { documentText: string; document: Record<string, unknown> }>(entity: T, rewrite: (text: string) => string): T {
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return rewrite(value);
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, visit(nested)]));
    return value;
  };
  return {
    ...entity,
    documentText: rewrite(entity.documentText),
    document: visit(entity.document) as Record<string, unknown>,
  };
}

function mentionPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/[\u4e00-\u9fff]/.test(name)) return new RegExp(escaped, 'g');
  return new RegExp(`\\b${escaped}\\b`, 'gi');
}
