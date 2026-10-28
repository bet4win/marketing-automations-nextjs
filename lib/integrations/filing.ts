import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Writing what a sync found, the same way for every provider: history rows
 * (merged on the provider's id, so a re-read fills in rather than repeats),
 * the lead's contacted/replied dates for each new row, and the people no
 * company matched, for their owner to assign.
 */

export interface ActivityRow {
  company_id: string;
  kind: 'message';
  channel: 'email' | 'slack' | 'telegram';
  direction: 'in' | 'out';
  subject: string | null;
  body: string | null;
  occurred_at: string;
  met_name: string | null;
  created_by: string;
  account_id: string;
  external_ref: string;
  private: boolean;
  cc_only: boolean | null;
  thread_ref: string | null;
}

export interface UnmatchedRow {
  user_id: string;
  account_id: string;
  channel: 'email' | 'slack' | 'telegram';
  direction: 'in' | 'out';
  address: string;
  name: string | null;
  subject: string | null;
  snippet: string | null;
  occurred_at: string;
  external_ref: string;
}

/** Files rows and moves each company's lead dates. Returns how many rows were written. */
export async function fileActivity(admin: SupabaseClient, rows: ActivityRow[]): Promise<number> {
  if (!rows.length) return 0;
  const { data, error } = await admin.from('lead_activity')
    .upsert(rows, { onConflict: 'channel,external_ref' })
    .select('company_id,direction,occurred_at');
  if (error) throw new Error(`Could not file messages: ${error.message}`);
  const written = (data ?? []) as { company_id: string; direction: 'in' | 'out'; occurred_at: string }[];
  for (const row of written) {
    const { error: te } = await admin.rpc('record_message_touch', {
      company: row.company_id, direction: row.direction, on_date: row.occurred_at.slice(0, 10),
    });
    if (te) throw new Error(`Could not update the lead: ${te.message}`);
  }
  return written.length;
}

export async function keepUnmatched(admin: SupabaseClient, rows: UnmatchedRow[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await admin.from('unmatched_messages')
    .upsert(rows, { onConflict: 'account_id,external_ref,address', ignoreDuplicates: true });
  if (error) throw new Error(`Could not keep unmatched messages: ${error.message}`);
}

const TTL_MS = 5 * 60_000;
let handles: { at: number; byHandle: Map<string, string> } | null = null;

/** `channel:handle` → company id, from contact_handles. Cached briefly per server instance. */
export async function loadHandles(admin: SupabaseClient): Promise<Map<string, string>> {
  if (handles && Date.now() - handles.at < TTL_MS) return handles.byHandle;
  const { data, error } = await admin.from('contact_handles').select('channel,handle,company_id');
  if (error) throw new Error(`Could not read contact handles: ${error.message}`);
  const byHandle = new Map((data ?? []).map((h) => [`${h.channel}:${h.handle}`, h.company_id as string]));
  handles = { at: Date.now(), byHandle };
  return byHandle;
}
