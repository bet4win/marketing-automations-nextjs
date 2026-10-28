/**
 * Building a draft email for Gmail's drafts.create: the body the assistant
 * writes (plain text, with **bold** and [text](url) links) as HTML and plain
 * text, and the MIME message around it. Pure, so the encoding is tested
 * without a mailbox.
 */

export interface DraftInput {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** The Message-ID this answers, so mail clients thread it. */
  inReplyTo?: string | null;
  /** Gmail's signature for the sending address, as HTML. */
  signatureHtml?: string | null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** **bold** and [text](https://…) inside one escaped line. */
function inline(line: string): string {
  return escapeHtml(line)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) => `<a href="${url}">${text}</a>`);
}

export function bodyHtml(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p>${para.split('\n').map(inline).join('<br>')}</p>`)
    .join('\n');
}

/** The plain-text part: links as "text (url)", bold markers dropped. */
export function bodyPlain(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .trim()
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');
}

/** RFC 2047 for a header that is not plain ASCII. */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

const b64Lines = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');

/** The whole message, base64url-encoded as drafts.create wants it in `raw`. */
export function draftRaw(d: DraftInput, boundary = `lanyard-${Date.now().toString(36)}`): string {
  const html = d.signatureHtml ? `${bodyHtml(d.body)}\n<br>${d.signatureHtml}` : bodyHtml(d.body);
  const headers = [
    `From: ${d.from}`,
    `To: ${d.to.join(', ')}`,
    ...(d.cc.length ? [`Cc: ${d.cc.join(', ')}`] : []),
    `Subject: ${encodeHeader(d.subject)}`,
    ...(d.inReplyTo ? [`In-Reply-To: <${d.inReplyTo}>`, `References: <${d.inReplyTo}>`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, content: string) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset="UTF-8"`,
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(content),
  ].join('\r\n');
  const mime = [
    headers.join('\r\n'),
    '',
    part('text/plain', bodyPlain(d.body)),
    part('text/html', `<div>${html}</div>`),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
}

/** "Re: " once, the way mail clients do it. */
export const replySubject = (subject: string) => (/^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`);
