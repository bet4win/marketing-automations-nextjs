/**
 * The readable text of a Gmail thread, for the assistant to read when a
 * snippet is not enough (drafting a reply, a message cut off). Read live and
 * never stored: the sync keeps snippets only.
 *
 * Each message is cut at the quoted history it carries ("On … wrote:",
 * Outlook's "From: … Sent:" block, "> " lines), because the thread already
 * holds those messages in full and a local model's context is small.
 */

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailFullMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPart;
}

export const MESSAGE_MAX = 4000;
export const THREAD_MAX = 15_000;

const decode = (data: string) => Buffer.from(data, 'base64url').toString('utf8');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** The first part of a type that is not an attachment, depth first. */
function find(part: GmailPart | undefined, mime: string): GmailPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && !part.filename && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const hit = find(child, mime);
    if (hit) return hit;
  }
  return undefined;
}

export function bodyText(payload: GmailPart | undefined): string {
  const plain = find(payload, 'text/plain');
  if (plain?.body?.data) return decode(plain.body.data);
  const html = find(payload, 'text/html');
  return html?.body?.data ? htmlToText(decode(html.body.data)) : '';
}

const QUOTE_STARTS = [
  /^\s*On [^\n]{0,300}(\n[^\n]{0,120})?wrote:\s*$/m,
  /^\s*-{2,}\s*Original Message\s*-{2,}/im,
  /^\s*From: [^\n]+\n\s*(Sent|Date): /m,
  /^_{10,}\s*$/m,
];

/** A message without the history it quotes, whitespace evened out. */
export function stripQuoted(text: string): string {
  let cut = text.replace(/\r\n/g, '\n');
  for (const re of QUOTE_STARTS) {
    const m = re.exec(cut);
    if (m) cut = cut.slice(0, m.index);
  }
  return cut
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const headerOf = (m: GmailFullMessage, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

/** The thread as plain text, oldest first, cut to what a small model can hold. */
export function threadText(messages: GmailFullMessage[]): string {
  const ordered = [...messages].sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
  const subject = headerOf(ordered[0] ?? { id: '' }, 'Subject');
  const blocks = ordered.map((m) => {
    const text = stripQuoted(bodyText(m.payload));
    const cc = headerOf(m, 'Cc');
    return [
      `From: ${headerOf(m, 'From')}`,
      `To: ${headerOf(m, 'To')}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Date: ${headerOf(m, 'Date')}`,
      '',
      text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX)}…` : text,
    ].join('\n');
  });
  // Keep the newest messages whole when the thread is too long: they are the
  // ones a reply answers.
  let out: string[] = [];
  let size = 0;
  for (const block of blocks.reverse()) {
    if (size + block.length > THREAD_MAX && out.length) break;
    out = [block, ...out];
    size += block.length;
  }
  const dropped = blocks.length - out.length;
  return [
    `Subject: ${subject}`,
    ...(dropped ? [`(${dropped} earlier message${dropped === 1 ? '' : 's'} left out for length)`] : []),
    ...out,
  ].join('\n\n---\n\n');
}
