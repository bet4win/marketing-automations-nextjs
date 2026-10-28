/**
 * Turning Slack messages into what gets filed. Pure, so the rules are tested
 * without a workspace.
 *
 * Only conversations with someone outside our own Slack team are read:
 * Slack Connect channels and DMs with external people. Internal chat is
 * never looked at, so colleagues' conversations cannot leak into Lanyard.
 */

export interface SlackMessage {
  ts: string;
  user?: string;
  text?: string;
  subtype?: string;
  bot_id?: string;
  thread_ts?: string;
}

export interface SlackConversation {
  id: string;
  /** Channels only. */
  name?: string;
  is_im?: boolean;
  is_mpim?: boolean;
  is_ext_shared?: boolean;
  is_archived?: boolean;
  /** For a DM: the other person. */
  user?: string;
}

export interface SlackUser {
  id: string;
  team_id?: string;
  deleted?: boolean;
  is_bot?: boolean;
  real_name?: string;
  profile?: { email?: string; real_name?: string; display_name?: string };
}

export const SNIPPET_MAX = 200;

/** Subtypes that are a person writing. Joins, edits, deletions and the like are not. */
const SPOKEN = new Set([undefined, 'thread_broadcast', 'file_share']);

export const isSpoken = (m: SlackMessage) => SPOKEN.has(m.subtype) && !m.bot_id && Boolean(m.user);

export const nameOf = (u: SlackUser | undefined) =>
  u?.profile?.real_name || u?.real_name || u?.profile?.display_name || null;

/**
 * Slack's markup as plain text: `<@U1>` → `@name`, `<url|label>` → label,
 * `<url>` → url, `<!here>` → `@here`, entities decoded, cut to a snippet.
 */
export function slackText(text: string | undefined, names: (id: string) => string | null = () => null): string | null {
  if (!text) return null;
  const out = text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id: string) => `@${names(id) ?? 'someone'}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<!(here|channel|everyone)[^>]*>/g, '@$1')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return out ? out.slice(0, SNIPPET_MAX) : null;
}

/** A DM or group DM is one conversation; in a channel, each thread is. */
export const threadRef = (c: SlackConversation, m: SlackMessage) =>
  c.is_im || c.is_mpim ? c.id : `${c.id}:${m.thread_ts ?? m.ts}`;

export const occurredAt = (ts: string) => new Date(Math.round(Number(ts) * 1000)).toISOString();

/** Someone outside our team, and a person rather than a bot or a deleted account. */
export const isOutsider = (u: SlackUser | undefined, ownTeam: string) =>
  Boolean(u && u.team_id && u.team_id !== ownTeam && !u.is_bot && !u.deleted);
