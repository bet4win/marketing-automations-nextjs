import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadEmailIndex } from './email-index';
import { fileActivity, keepUnmatched, type ActivityRow, type UnmatchedRow } from './filing';
import { assignable, toFiling, type GmailMessage } from './gmail-parse';
import { HistoryGoneError, freshTokens, gmail, type GoogleTokens } from './google';
import { matchEmail } from './match';
import type { Syncer } from './syncer';
import type { ConnectedAccount } from './types';

/**
 * Gmail → company history.
 *
 * The first sync lists the last 30 days; after that Gmail's history API says
 * which messages arrived since the stored history id. Ids found but not yet
 * read wait in the cursor's `pending`, so a mailbox too big for one tick is
 * finished over the next ones instead of skipped. The history id and the
 * pending list are saved together, so nothing between them is lost.
 */

interface GmailCursor {
  historyId?: string;
  pending?: string[];
}

const BACKFILL = 'newer_than:30d';
/** When the stored history id has expired: the gap is at most a week or so. */
const CATCH_UP = 'newer_than:8d';
const MAX_PENDING = 5000;
const BATCH = 20;
/** Leave the route time to save the cursor before the function is cut off. */
const MARGIN_MS = 8_000;

const METADATA = ['From', 'To', 'Cc', 'Subject', 'Message-ID', 'List-Unsubscribe', 'List-Id', 'Auto-Submitted', 'Precedence'];

export async function tokensFor(admin: SupabaseClient, accountId: string): Promise<GoogleTokens> {
  const { data, error } = await admin.rpc('connected_account_secret', { account: accountId });
  if (error || !data) throw new Error(`No stored tokens for this account${error ? `: ${error.message}` : ''}`);
  const tokens = JSON.parse(data as string) as GoogleTokens;
  const fresh = await freshTokens(tokens);
  if (!fresh) return tokens;
  await admin.rpc('connected_account_set_secret', { account: accountId, secret: JSON.stringify(fresh) });
  return fresh;
}

async function listIds(token: string, q: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(token, 'messages', {
      q, maxResults: '500', ...(pageToken ? { pageToken } : {}),
    });
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < MAX_PENDING);
  return ids;
}

async function historySince(token: string, start: string): Promise<{ ids: string[]; latest: string }> {
  const ids: string[] = [];
  let latest = start;
  let pageToken: string | undefined;
  do {
    const page = await gmail<{
      history?: { messagesAdded?: { message: { id: string } }[] }[];
      historyId?: string;
      nextPageToken?: string;
    }>(token, 'history', {
      startHistoryId: start, historyTypes: 'messageAdded', maxResults: '500',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const h of page.history ?? []) for (const m of h.messagesAdded ?? []) ids.push(m.message.id);
    if (page.historyId) latest = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { ids, latest };
}

async function readMessage(token: string, id: string): Promise<GmailMessage | null> {
  try {
    return await gmail<GmailMessage>(token, `messages/${id}`, { format: 'metadata', metadataHeaders: METADATA });
  } catch (e) {
    // Deleted between listing and reading: nothing to file.
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

/** Files one batch: activity rows for matched companies, the rest for the owner to assign. */
async function fileBatch(
  admin: SupabaseClient, account: ConnectedAccount, messages: GmailMessage[],
): Promise<number> {
  const index = await loadEmailIndex(admin);
  const ownDomain = account.external_id.split('@')[1] ?? '';
  const activity: ActivityRow[] = [];
  const unmatched: UnmatchedRow[] = [];

  for (const message of messages) {
    const f = toFiling(message, account.external_id, ownDomain);
    if (!f) continue;
    const byCompany = new Map<string, (typeof f.parties)[number]>();
    for (const party of f.parties) {
      const hit = matchEmail(party.address, index);
      if (hit) {
        if (!byCompany.has(hit.companyId)) byCompany.set(hit.companyId, party);
      } else if (f.direction === 'out' && assignable(party)) {
        unmatched.push({
          user_id: account.user_id, account_id: account.id, channel: 'email', direction: 'out',
          address: party.address, name: party.name, subject: f.subject, snippet: f.snippet,
          occurred_at: f.occurredAt, external_ref: f.messageId,
        });
      }
    }
    for (const [companyId, party] of byCompany) {
      activity.push({
        company_id: companyId, kind: 'message', channel: 'email', direction: f.direction,
        subject: f.subject, body: f.snippet, occurred_at: f.occurredAt,
        met_name: party.name ?? party.address,
        created_by: account.user_id, account_id: account.id,
        // Per company, so a message to two companies is filed on both, and
        // still once each however many colleagues it reached.
        external_ref: `${f.messageId}|${companyId}`,
        private: !account.share_activity,
        cc_only: f.ccOnly,
        thread_ref: f.threadId,
      });
    }
  }

  const filed = await fileActivity(admin, activity);
  await keepUnmatched(admin, unmatched);
  return filed;
}

export const gmailSyncer: Syncer = {
  async sync(account, { admin, deadline }) {
    const { access_token: token } = await tokensFor(admin, account.id);
    const cursor = account.cursor as GmailCursor;
    let historyId = cursor.historyId;
    let pending = cursor.pending ?? [];

    if (!historyId) {
      historyId = (await gmail<{ historyId: string }>(token, 'profile')).historyId;
      pending = await listIds(token, BACKFILL);
    } else {
      try {
        const since = await historySince(token, historyId);
        pending = [...new Set([...pending, ...since.ids])];
        historyId = since.latest;
      } catch (e) {
        if (!(e instanceof HistoryGoneError)) throw e;
        historyId = (await gmail<{ historyId: string }>(token, 'profile')).historyId;
        pending = [...new Set([...pending, ...(await listIds(token, CATCH_UP))])];
      }
    }
    pending = pending.slice(0, MAX_PENDING);

    let filed = 0;
    while (pending.length && Date.now() < deadline - MARGIN_MS) {
      const batch = pending.slice(0, BATCH);
      const messages = (await Promise.all(batch.map((id) => readMessage(token, id))))
        .filter((m): m is GmailMessage => m !== null);
      filed += await fileBatch(admin, account, messages);
      pending = pending.slice(batch.length);
    }
    return { cursor: { historyId, pending }, filed };
  },
};
