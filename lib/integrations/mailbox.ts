import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { tokensFor } from './gmail';

/**
 * Which of the caller's Gmail accounts to act through, and its access token.
 *
 * Ownership is decided with the caller's own client, so RLS answers it: a
 * message filed from a colleague's mailbox, or an account that is not yours,
 * is simply not found. Only the token read uses the service role.
 */

export class MailboxError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export interface Mailbox { accountId: string; address: string; token: string }

export async function mailboxFor(supabase: SupabaseClient, accountId?: string | null): Promise<Mailbox> {
  let query = supabase.from('connected_accounts').select('id,external_id').eq('provider', 'gmail');
  if (accountId) query = query.eq('id', accountId);
  const { data } = await query.order('created_at').limit(1).maybeSingle();
  if (!data) {
    throw accountId
      ? new MailboxError('That message came from a colleague\'s mailbox; only they can open it.', 403)
      : new MailboxError('No Gmail account connected. Connect one on the account page.', 404);
  }
  const { access_token } = await tokensFor(createAdminClient(), data.id);
  return { accountId: data.id, address: data.external_id, token: access_token };
}

/** The message's thread and Message-ID, from a history row the caller can see. */
export async function syncedMessage(supabase: SupabaseClient, activityId: string) {
  const { data } = await supabase.from('lead_activity')
    .select('account_id,thread_ref,external_ref,channel').eq('id', activityId).maybeSingle();
  if (!data) throw new MailboxError('No such message.', 404);
  if (data.channel !== 'email' || !data.account_id || !data.thread_ref) {
    throw new MailboxError('That message was not synced from Gmail, so there is no thread to read.', 404);
  }
  const ref = String(data.external_ref ?? '').split('|')[0] ?? '';
  return {
    accountId: data.account_id as string,
    threadId: data.thread_ref as string,
    messageId: ref && !ref.startsWith('gmail:') ? ref : null,
  };
}
