import { FREE_MAIL, normaliseAddress } from './match';

/**
 * Turning a Gmail message's metadata into what gets filed. Pure, so the rules
 * about which mail counts are tested without a mailbox.
 *
 * Which mail counts: a person writing to a person. Newsletters (a
 * List-Unsubscribe header, Gmail's promotions/updates/social/forums tabs),
 * auto-replies (Auto-Submitted) and no-reply senders are skipped, or an
 * out-of-office would mark a lead replied and a company's newsletter would
 * read as them writing to us. Drafts, spam, trash and chat are skipped too.
 */

export interface GmailHeader { name: string; value: string }

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
}

export interface Party { address: string; name: string | null }

export interface Filing {
  direction: 'in' | 'out';
  /** The other side: recipients when we wrote, the sender when they did. */
  parties: Party[];
  subject: string | null;
  snippet: string | null;
  occurredAt: string;
  /** The RFC Message-ID, the same in every mailbox the message reached. */
  messageId: string;
  /** Gmail's conversation id, within this mailbox. */
  threadId: string | null;
  /** Inbound only: we were copied, not addressed. */
  ccOnly: boolean | null;
}

const SKIP_LABELS = new Set([
  'DRAFT', 'SPAM', 'TRASH', 'CHAT',
  'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS',
]);

const MACHINE = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce[s]?)([+.@-]|$)/i;

export const SNIPPET_MAX = 200;

export function header(message: GmailMessage, name: string): string | null {
  const want = name.toLowerCase();
  return message.payload?.headers?.find((h) => h.name.toLowerCase() === want)?.value ?? null;
}

/**
 * `"Doe, Jane" <jane@x.com>, bob@y.com` → two parties. Commas inside quotes
 * belong to the name, which is why this is not a split on ",".
 */
export function parseAddressList(value: string | null): Party[] {
  if (!value) return [];
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angled = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (ch === '<' && !quoted) angled = true;
    else if (ch === '>' && !quoted) angled = false;
    if (ch === ',' && !quoted && !angled) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);

  return parts.flatMap((part) => {
    const angle = /<([^>]+)>/.exec(part);
    const address = (angle ? angle[1]! : part).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return [];
    const name = angle ? part.slice(0, angle.index).trim().replace(/^"|"$/g, '').trim() : '';
    return [{ address: normaliseAddress(address), name: name || null }];
  });
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Gmail's snippet arrives HTML-escaped. */
export function decodeSnippet(snippet: string | undefined): string | null {
  if (!snippet) return null;
  const text = snippet
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, SNIPPET_MAX) : null;
}

const isMachine = (address: string) => MACHINE.test(address.split('@')[0] ?? '') || MACHINE.test(address);

/**
 * What to file for one message, or null when it is not a conversation.
 * `ownDomain` takes colleagues out: mail inside the company is not a lead's.
 */
export function toFiling(message: GmailMessage, ownAddress: string, ownDomain: string): Filing | null {
  const labels = new Set(message.labelIds ?? []);
  if ([...labels].some((l) => SKIP_LABELS.has(l))) return null;
  if (header(message, 'List-Unsubscribe') || header(message, 'List-Id')) return null;
  const auto = header(message, 'Auto-Submitted');
  if (auto && auto.trim().toLowerCase() !== 'no') return null;
  if (/^(bulk|list|junk|auto_reply)$/i.test(header(message, 'Precedence')?.trim() ?? '')) return null;

  const own = normaliseAddress(ownAddress);
  const outsider = (p: Party) => p.address !== own && p.address.split('@')[1] !== ownDomain && !isMachine(p.address);

  const out = labels.has('SENT');
  const parties = (out
    ? [...parseAddressList(header(message, 'To')), ...parseAddressList(header(message, 'Cc'))]
    : parseAddressList(header(message, 'From'))
  ).filter(outsider);
  if (!parties.length) return null;

  const unique = [...new Map(parties.map((p) => [p.address, p])).values()];
  const ms = Number(message.internalDate);
  const rawId = header(message, 'Message-ID')?.trim().replace(/^<|>$/g, '');

  const addressed = parseAddressList(header(message, 'To')).some((p) => p.address === own);

  return {
    direction: out ? 'out' : 'in',
    parties: unique,
    subject: header(message, 'Subject')?.trim().slice(0, 300) || null,
    snippet: decodeSnippet(message.snippet),
    occurredAt: new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now()).toISOString(),
    messageId: rawId || `gmail:${message.id}`,
    threadId: message.threadId ?? null,
    ccOnly: out ? null : !addressed,
  };
}

/** A party worth keeping for the owner to assign: not free mail, so most likely business. */
export const assignable = (p: Party) => !FREE_MAIL.has(p.address.split('@')[1] ?? '');
