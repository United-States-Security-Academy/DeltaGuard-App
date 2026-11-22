// A deliberately small Markdown subset for post orders, parsed to plain data
// so the admin console (React DOM) and the phone (React Native) render the
// same thing without an HTML step (nothing to sanitise, no raw HTML).
//
// Supported: # / ## / ### headings, paragraphs (lines joined), "- " or "* "
// bullet lists, "1. " numbered lists, **bold** and *italic* / _italic_.
// Anything else shows as plain text.

export type MdInline = { text: string; bold?: boolean; italic?: boolean };

export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3; content: MdInline[] }
  | { type: 'paragraph'; content: MdInline[] }
  | { type: 'list'; ordered: boolean; items: MdInline[][] };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** **bold**, *italic* and _italic_ (not nested). */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(\S(?:.*?\S)?)\*|_(\S(?:.*?\S)?)_/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ text: text.slice(last, index) });
    if (match[1] !== undefined) out.push({ text: match[1], bold: true });
    else out.push({ text: (match[2] ?? match[3])!, italic: true });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', content: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
    if (list) {
      blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
      list = null;
    }
  };

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        type: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        content: parseInline(heading[2]!.trim()),
      });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (paragraph.length > 0 || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!.trim());
      continue;
    }
    // A line that follows a list item without a blank line continues it.
    if (list && list.items.length > 0 && /^\s+/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
