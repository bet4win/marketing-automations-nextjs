import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { gmailSyncer } from './gmail';
import { slackSyncer } from './slack-sync';
import { ReauthError, type Syncer } from './syncer';
import type { ConnectedAccount, Provider } from './types';

export { ReauthError };

/**
 * The sync job: every active, unpaused account whose provider has a syncer,
 * oldest-synced first, until the time budget runs out. The next tick picks up
 * where this one stopped, so a slow mailbox delays the others by one tick at
 * most rather than starving them.
 *
 * Runs with the service-role client, because it files messages for every
 * user. Each account's outcome is written on the account, where its owner
 * sees it on the account page; one failing account never stops the rest.
 */

export const SYNCERS: Partial<Record<Provider, Syncer>> = {
  gmail: gmailSyncer,
  slack: slackSyncer,
};

const MAX_ERROR = 500;

/** What a failed sync leaves on the account. */
export function failureFor(error: unknown): Pick<ConnectedAccount, 'status' | 'last_error'> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR);
  return error instanceof ReauthError
    ? { status: 'needs_reauth', last_error: message || 'Connect the account again.' }
    : { status: 'error', last_error: message || 'Sync failed.' };
}

export interface SyncSummary {
  synced: number;
  failed: number;
  filed: number;
  /** Accounts left for the next tick because the budget ran out. */
  deferred: number;
}

export async function runSync(admin: SupabaseClient, budgetMs = 50_000): Promise<SyncSummary> {
  const deadline = Date.now() + budgetMs;
  const providers = Object.keys(SYNCERS) as Provider[];
  const summary: SyncSummary = { synced: 0, failed: 0, filed: 0, deferred: 0 };
  if (!providers.length) return summary;

  const { data, error } = await admin.from('connected_accounts').select('*')
    .in('provider', providers)
    .eq('paused', false)
    .neq('status', 'needs_reauth')
    .order('last_synced_at', { ascending: true, nullsFirst: true });
  if (error) throw new Error(`Could not read connected accounts: ${error.message}`);

  const accounts = (data ?? []) as ConnectedAccount[];
  for (const [i, account] of accounts.entries()) {
    if (Date.now() >= deadline) {
      summary.deferred = accounts.length - i;
      break;
    }
    try {
      const out = await SYNCERS[account.provider]!.sync(account, { admin, deadline });
      await admin.from('connected_accounts').update({
        cursor: out.cursor, last_synced_at: new Date().toISOString(),
        status: 'active', last_error: null,
      }).eq('id', account.id);
      summary.synced += 1;
      summary.filed += out.filed;
    } catch (e) {
      await admin.from('connected_accounts').update(failureFor(e)).eq('id', account.id);
      summary.failed += 1;
    }
  }
  return summary;
}
