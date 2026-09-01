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
  const selected: LoreEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const byStyle = entry.constantForStyles.some((style) => currentStyles.includes(style));
    const byKey = entry.keys.some((key) => key !== '' && hay.includes(key.toLowerCase()));
    if (!byStyle && !byKey) continue;
    if (seen.has(entry.content)) continue;
    seen.add(entry.content);
    selected.push(entry);
  }

  return selected;
}

export function parseTracksMarkdown(markdown: string): LoreEntry[] {
  const entries: LoreEntry[] = [];

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const pipe = line.indexOf('|');
    if (pipe < 0) continue;
    const title = line.slice(0, pipe).trim();
    const note = line.slice(pipe + 1).trim();
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
  const match = markdown.match(FRONTMATTER);
  if (!match) {
    return {
      keys: [style],
      content: markdown.trim(),
      constantForStyles: [style],
    };
  }

  const yaml = match[1] ?? '';
  const body = markdown.slice(match[0].length);
  let keys = [style];
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^keys:/i.test(line)) continue;
    keys = line
      .slice(line.indexOf(':') + 1)
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key !== '');
    break;
  }

  return {
    keys,
    content: body.trim(),
    constantForStyles: [style],
  };
}
