/**
 * The markdown subset the assistant's answers are rendered from: headings, lists, tables and
 * paragraphs. Blocks only; inline bold and code are the renderer's (components/assistant/answer-text).
 */

export type Block =
  | { type: 'heading'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'paragraph'; text: string }
  | { type: 'table'; head: string[]; rows: string[][] };

const TABLE_ROW = /^\|.*\|$/;
const TABLE_RULE = /^\|(\s*:?-{2,}:?\s*\|)+$/;
const cells = (line: string) => line.slice(1, -1).split('|').map((c) => c.trim());

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: 'list', ...list });
    list = null;
  };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n] ?? '';
    const trimmed = line.trim();
    if (TABLE_ROW.test(trimmed) && TABLE_RULE.test((lines[n + 1] ?? '').trim().replace(/\s+/g, ''))) {
      flushParagraph();
      flushList();
      const head = cells(trimmed);
      const rows: string[][] = [];
      n += 2;
      for (; n < lines.length && TABLE_ROW.test((lines[n] ?? '').trim()); n += 1) {
        rows.push(cells((lines[n] ?? '').trim()));
      }
      n -= 1;
      blocks.push({ type: 'table', head, rows });
      continue;
    }
    if (!trimmed || /^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(trimmed);
    if (heading?.[1]) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', text: heading[1] });
      continue;
    }
    const item = /^(?:([-*•+])|(\d{1,3})[.)])\s+(.*)$/.exec(trimmed);
    if (item) {
      flushParagraph();
      const ordered = item[2] !== undefined;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item[3] ?? '');
      continue;
    }
    if (list && /^\s/.test(line)) {
      // An indented line continues the item above it.
      list.items[list.items.length - 1] += ` ${trimmed}`;
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks;
}
