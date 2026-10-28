import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEmailIndex } from './email-index';
import { fileActivity, keepUnmatched, loadHandles, type ActivityRow, type UnmatchedRow } from './filing';
import { matchEmail, normaliseDomain } from './match';
import { slack } from './slack';
import {
  isOutsider, isSpoken, nameOf, occurredAt, slackText, threadRef,
  type SlackConversation, type SlackMessage, type SlackUser,
} from './slack-parse';
import type { Syncer } from './syncer';
import type { ConnectedAccount } from './types';

/**
 * Slack → company history, for the conversations a user has with people
 * outside our workspace: Slack Connect channels, and DMs with external
 * people. Internal conversations are never read: a DM is checked once (is
 * the other person ours?) and remembered as internal, and its messages are
 * not fetched.
 *
 * Polled by the sync job like Gmail. Per conversation the cursor keeps the
 * newest message read; the first read goes back 30 days. Thread replies in
 * channels are not read yet, only top-level messages and broadcasts.
 */

/** What the Vault secret of a Slack account holds. */
export interface SlackSecret { access_token: string; team_id: string; user_id: string }

interface SlackCursor {
  /** Conversation id → ts of the newest message filed. */
  latest?: Record<string, string>;
  /** DMs found to be with colleagues, never read. */
  internal?: string[];
}

const BACKFILL_DAYS = 30;
const MARGIN_MS = 8_000;
const MAX_MEMBERS = 50;

async function tokensFor(admin: SupabaseClient, accountId: string): Promise<SlackSecret> {
  const { data, error } = await admin.rpc('connected_account_secret', { account: accountId });
  if (error || !data) throw new Error(`No stored token for this account${error ? `: ${error.message}` : ''}`);
  return JSON.parse(data as string) as SlackSecret;
}

async function listConversations(token: string): Promise<SlackConversation[]> {
  const out: SlackConversation[] = [];
  let cursor = '';
  do {
    const page = await slack<{ channels: SlackConversation[]; response_metadata?: { next_cursor?: string } }>(
      'users.conversations', token,
      { types: 'im,mpim,public_channel,private_channel', exclude_archived: 'true', limit: '200', ...(cursor ? { cursor } : {}) },
    );
    out.push(...page.channels);
    cursor = page.response_metadata?.next_cursor ?? '';
  } while (cursor);
  return out;
}

export const slackSyncer: Syncer = {
  async sync(account: ConnectedAccount, { admin, deadline }) {
    const secret = await tokensFor(admin, account.id);
    const { access_token: token, team_id: ownTeam, user_id: me } = secret;
    const cursor = account.cursor as SlackCursor;
    const latest = { ...(cursor.latest ?? {}) };
    const internal = new Set(cursor.internal ?? []);

    const users = new Map<string, SlackUser | undefined>();
    const userInfo = async (id: string) => {
      if (!users.has(id)) {
        const u = await slack<{ user: SlackUser }>('users.info', token, { user: id }).then((r) => r.user).catch(() => undefined);
        users.set(id, u);
      }
      return users.get(id);
    };
    const teamDomains = new Map<string, string | null>();
    const teamDomain = async (teamId: string) => {
      if (!teamDomains.has(teamId)) {
        const t = await slack<{ team: { email_domain?: string } }>('team.info', token, { team: teamId })
          .then((r) => normaliseDomain(r.team.email_domain?.split(',')[0]))
          .catch(() => null);
        teamDomains.set(teamId, t);
      }
      return teamDomains.get(teamId) ?? null;
    };

    const [index, handles] = await Promise.all([loadEmailIndex(admin), loadHandles(admin)]);
    /** A person's company: a saved handle, their email, or their team's email domain. */
    const companyOf = async (u: SlackUser): Promise<string | null> => {
      const byHandle = handles.get(`slack:${u.team_id}/${u.id}`);
      if (byHandle) return byHandle;
      const email = u.profile?.email;
      const byEmail = email ? matchEmail(email, index) : null;
      if (byEmail) return byEmail.companyId;
      const domain = u.team_id ? await teamDomain(u.team_id) : null;
      return domain ? matchEmail(`someone@${domain}`, index)?.companyId ?? null : null;
    };

    // Which conversations have someone outside: shared channels, and DMs whose other person is not ours.
    const outside: SlackConversation[] = [];
    for (const c of await listConversations(token)) {
      if (c.is_archived) continue;
      if (c.is_im) {
        if (!c.user || internal.has(c.id)) continue;
        if (isOutsider(await userInfo(c.user), ownTeam)) outside.push(c);
        else internal.add(c.id);
      } else if (c.is_ext_shared) {
        outside.push(c);
      }
    }

    const since = String((Date.now() - BACKFILL_DAYS * 86_400_000) / 1000);
    let filed = 0;
    for (const c of outside) {
      if (Date.now() >= deadline - MARGIN_MS) break;
      const history = await slack<{ messages: SlackMessage[] }>('conversations.history', token, {
        channel: c.id, oldest: latest[c.id] ?? since, limit: '200',
      });
      const messages = history.messages.filter(isSpoken).sort((a, b) => Number(a.ts) - Number(b.ts));
      if (!messages.length) continue;

      // The outside people in the conversation: the DM's other person, or a shared channel's external members.
      let theirs: SlackUser[] = [];
      if (c.is_im) {
        const u = await userInfo(c.user!);
        theirs = u ? [u] : [];
      } else {
        const members = await slack<{ members: string[] }>('conversations.members', token, { channel: c.id, limit: '200' });
        for (const id of members.members.slice(0, MAX_MEMBERS)) {
          const u = await userInfo(id);
          if (u && isOutsider(u, ownTeam)) theirs.push(u);
        }
      }

      const activity: ActivityRow[] = [];
      const unmatched: UnmatchedRow[] = [];
      const label = c.is_im ? null : `#${c.name ?? c.id}`;
      for (const m of messages) {
        const out = m.user === me;
        const author = out ? undefined : await userInfo(m.user!);
        // Theirs from a colleague in a shared channel is not a conversation of ours with them.
        if (!out && !isOutsider(author, ownTeam)) continue;
        const parties = out ? theirs : [author!];
        const text = slackText(m.text, (id) => nameOf(users.get(id)));
        const filedFor = new Set<string>();
        for (const p of parties) {
          const company = await companyOf(p);
          if (company) {
            if (filedFor.has(company)) continue;
            filedFor.add(company);
            activity.push({
              company_id: company, kind: 'message', channel: 'slack', direction: out ? 'out' : 'in',
              subject: label, body: text, occurred_at: occurredAt(m.ts), met_name: nameOf(p),
              created_by: account.user_id, account_id: account.id,
              external_ref: `${c.id}:${m.ts}|${company}`, private: !account.share_activity,
              cc_only: null, thread_ref: threadRef(c, m),
            });
          } else {
            unmatched.push({
              user_id: account.user_id, account_id: account.id, channel: 'slack', direction: out ? 'out' : 'in',
              address: p.profile?.email?.toLowerCase() ?? `slack:${p.team_id}/${p.id}`,
              name: nameOf(p), subject: label, snippet: text, occurred_at: occurredAt(m.ts),
              external_ref: `${c.id}:${m.ts}`,
            });
          }
        }
      }
      filed += await fileActivity(admin, activity);
      await keepUnmatched(admin, unmatched);
      latest[c.id] = messages[messages.length - 1]!.ts;
    }
    return { cursor: { latest, internal: [...internal] }, filed };
  },
};
