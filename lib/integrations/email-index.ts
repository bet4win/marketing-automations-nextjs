import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildEmailIndex, type EmailIndex } from './match';

/**
 * The address and domain index the sync matches against, read with the
 * service-role client. Kept for a few minutes per server instance: one sync
 * tick matches hundreds of messages against the same few thousand rows, and a
 * contact added a minute ago matching on the next tick instead of this one
 * costs nothing.
 */

const TTL_MS = 5 * 60_000;
const PAGE = 1000;

let cached: { at: number; index: EmailIndex } | null = null;

async function readAll<T>(admin: SupabaseClient, table: string, select: string, notNull: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select(select).not(notNull, 'is', null)
      .order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

export async function loadEmailIndex(admin: SupabaseClient): Promise<EmailIndex> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.index;
  const [manual, found, companies] = await Promise.all([
    readAll<{ email: string; company_id: string }>(admin, 'manual_contacts', 'email,company_id', 'email'),
    readAll<{ email: string; company_id: string }>(admin, 'contact_resolved', 'email,company_id', 'email'),
    readAll<{ id: string; domain: string; hidden: boolean | null }>(admin, 'company_resolved', 'id,domain,hidden', 'domain'),
  ]);
  const index = buildEmailIndex(
    // Typed contacts after found ones, so a hand-entered address wins a clash.
    [...found, ...manual],
    // A hidden company is one a correction took off the board; filing mail
    // there would hide it too.
    companies.filter((c) => !c.hidden).map((c) => ({ domain: c.domain, company_id: c.id })),
  );
  cached = { at: Date.now(), index };
  return index;
}
