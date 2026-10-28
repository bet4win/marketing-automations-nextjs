import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanDomain, normalizeName } from '@/lib/company-name';
import { WRITABLE } from './schema';
import type { Proposal, ProposedChange } from './tools';

/**
 * The Review Changes card's logic (docs/assistant.md): what each proposed change would do to the row
 * as it stands, what to warn about, and applying the ones the user kept. Nothing here runs until the
 * user presses Apply.
 */

export type Value = string | number | boolean | null | (string | number | boolean | null)[];
export type Row = Record<string, unknown>;

export interface ReviewItem {
  key: string;
  change: ProposedChange;
  /** The row as it is now: null for an insert, or an upsert that will insert. */
  before: Row | null;
  /** Names for the ids it touches, e.g. company_id → "Kiron". */
  names: Record<string, string>;
  warnings: string[];
  /** A problem that stops the change going in as proposed. It can still be edited. */
  blocked: string | null;
}

export interface Cell {
  column: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Each proposed column against the current row. Unchanged columns are kept, marked, for context. */
export function diff(before: Row | null, values: Record<string, unknown>): Cell[] {
  return Object.entries(values).map(([column, after]) => ({
    column,
    before: before?.[column] ?? null,
    after,
    changed: !before || !same(before[column], after),
  }));
}

/** A change that would leave the row exactly as it is. */
export const isNoop = (item: Pick<ReviewItem, 'before' | 'change'>) =>
  item.change.action !== 'insert' &&
  item.before !== null &&
  diff(item.before, item.change.values).every((c) => !c.changed);

/** The key the row is found by: match for an update, the conflict columns for an upsert. */
export function rowKey(change: ProposedChange): Record<string, unknown> | null {
  const table = WRITABLE[change.table];
  if (!table) return null;
  if (change.action === 'update') return change.match ?? null;
  if (change.action === 'upsert' && table.conflict) {
    return Object.fromEntries(table.conflict.map((k) => [k, change.values[k]]));
  }
  return null;
}

const isRef = (v: unknown): v is string => typeof v === 'string' && v.startsWith('$ref:');

/** SHA-256 of the lowercased, trimmed address: `contact_email_hash` in the database. */
export async function emailHash(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ID_COLUMNS = {
  company_id: 'company',
  met_company_id: 'company',
  via_company_id: 'company',
  event_id: 'event',
  status_id: 'status',
} as const;

/** Reads what the review needs: current rows, names for ids, erased addresses, existing companies. */
export async function prepareReview(supabase: SupabaseClient, proposal: Proposal): Promise<ReviewItem[]> {
  const ids = { company: new Set<string>(), event: new Set<string>(), status: new Set<string>() };
  for (const c of proposal.changes) {
    for (const [column, kind] of Object.entries(ID_COLUMNS)) {
      const v = c.values[column] ?? c.match?.[column];
      if (typeof v === 'string' && !isRef(v)) ids[kind].add(v);
    }
  }
  const [companies, events, statuses] = await Promise.all([
    ids.company.size
      ? supabase.from('company_resolved').select('id,name').in('id', [...ids.company])
      : { data: [] },
    ids.event.size ? supabase.from('events').select('id,name').in('id', [...ids.event]) : { data: [] },
    ids.status.size ? supabase.from('statuses').select('id,label').in('id', [...ids.status]) : { data: [] },
  ]);
  const names = new Map<string, string>();
  for (const r of (companies.data ?? []) as { id: string; name: string }[]) names.set(r.id, r.name);
  for (const r of (events.data ?? []) as { id: string; name: string }[]) names.set(r.id, r.name);
  for (const r of (statuses.data ?? []) as { id: string; label: string }[]) names.set(r.id, r.label);

  const emails = proposal.changes
    .filter((c) => c.table === 'manual_contacts' && typeof c.values.email === 'string' && c.values.email.trim())
    .map((c) => String(c.values.email));
  const hashes = new Map(await Promise.all(emails.map(async (e) => [e, await emailHash(e)] as const)));
  const erased = new Set<string>();
  if (hashes.size) {
    const { data } = await supabase.from('erased_contacts').select('email_hash').in('email_hash', [...hashes.values()]);
    for (const r of (data ?? []) as { email_hash: string }[]) erased.add(r.email_hash);
  }

  const refNames = new Map(
    proposal.changes.filter((c) => c.table === 'companies' && c.ref).map((c) => [c.ref!, String(c.values.name)]),
  );

  return Promise.all(
    proposal.changes.map(async (change, i): Promise<ReviewItem> => {
      const warnings: string[] = [];
      let blocked: string | null = null;
      let before: Row | null = null;
      const key = rowKey(change);
      if (key && Object.values(key).every((v) => v != null && !isRef(v))) {
        const { data } = await supabase.from(change.table).select('*').match(key as Record<string, string>).limit(2);
        const rows = (data ?? []) as Row[];
        if (rows.length > 1) blocked = 'More than one row matches.';
        before = rows[0] ?? null;
        if (change.action === 'update' && !before) blocked = 'No row matches, so there is nothing to update.';
      }
      const own: Record<string, string> = {};
      for (const column of Object.keys(ID_COLUMNS)) {
        const v = change.values[column] ?? change.match?.[column];
        if (typeof v !== 'string') continue;
        const name = isRef(v) ? refNames.get(v.slice(5)) : names.get(v);
        if (name) own[column] = isRef(v) ? `${name} (new)` : name;
        else if (!isRef(v)) warnings.push(`${column} ${v} is not a known record.`);
      }
      if (change.table === 'companies') {
        const name = String(change.values.name ?? '');
        const { data } = await supabase
          .from('companies')
          .select('id,name')
          .eq('normalized_name', normalizeName(name))
          .maybeSingle();
        if (data) blocked = `${(data as { name: string }).name} is already in the database.`;
        else warnings.push('Creates a new company.');
      }
      if (change.table === 'manual_contacts') {
        const email = typeof change.values.email === 'string' ? change.values.email : '';
        const hash = email ? hashes.get(email) : undefined;
        if (hash && erased.has(hash)) blocked = `${email} was erased at that person's request.`;
        if (change.action === 'insert' && change.values.company_id && change.values.full_name) {
          const { data } = await supabase
            .from('manual_contacts')
            .select('id')
            .eq('company_id', String(change.values.company_id))
            .eq('full_name', String(change.values.full_name))
            .limit(1);
          if (data?.length) blocked = `${change.values.full_name} is already listed at this company.`;
        }
      }
      return { key: `${i}`, change, before, names: own, warnings, blocked };
    }),
  );
}

export type Applied = { key: string; ok: true; id?: string } | { key: string; ok: false; error: string };

/** Replaces `$ref:<ref>` values with the id of the company created earlier in this run. */
export function resolveRefs(values: Record<string, unknown>, created: ReadonlyMap<string, string>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (isRef(v)) {
      const id = created.get(v.slice(5));
      if (!id) throw new Error(`${v} was not created, so this change has nothing to point at.`);
      out[k] = id;
    } else {
      out[k] = v === '' ? null : v;
    }
  }
  return out;
}

/** One change, the same calls the app's own forms make. */
async function applyOne(
  supabase: SupabaseClient,
  change: ProposedChange,
  created: Map<string, string>,
): Promise<{ id?: string }> {
  const table = WRITABLE[change.table]!;
  const values = { ...resolveRefs(change.values, created), ...table.fixed };
  if (change.table === 'companies') {
    const name = String(values.name).trim();
    const domain = typeof values.domain === 'string' ? cleanDomain(values.domain) : null;
    const { data, error } = await supabase
      .from('companies')
      .insert({
        name,
        normalized_name: normalizeName(name),
        domain,
        domain_source: domain ? 'manual' : null,
        hq_city: values.hq_city ?? null,
        hq_country: values.hq_country ?? null,
        category_confidence: 'inferred',
        reach: 'Unknown',
        source: 'manual',
      })
      .select('id')
      .single();
    if (error) throw error;
    const id = (data as { id: string }).id;
    if (change.ref) created.set(change.ref, id);
    return { id };
  }
  const builder = supabase.from(change.table);
  const result =
    change.action === 'insert'
      ? await builder.insert(values).select()
      : change.action === 'upsert'
        ? await builder.upsert(values, { onConflict: table.conflict!.join(',') }).select()
        : await builder
            .update(values)
            .match(change.match as Record<string, string>)
            .select();
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as Row[];
  // Accepted with no row back: the erasure trigger skipped it, or the match found nothing.
  if (!rows.length) {
    throw new Error(
      change.table === 'manual_contacts' && values.email
        ? `${values.email} was erased at that person's request.`
        : 'Nothing was written.',
    );
  }
  return { id: typeof rows[0]!.id === 'string' ? (rows[0]!.id as string) : undefined };
}

const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === 'object' && e && 'message' in e
      ? String((e as { message: unknown }).message)
      : 'Failed.';

/**
 * Applies the kept changes in order, one by one, so a failure is reported against its own row and
 * the rest still go in. Not a transaction: PostgREST has none across requests, and a partial result
 * the user can see beats an all-or-nothing that fails on one duplicate name.
 */
export async function applyChanges(
  supabase: SupabaseClient,
  items: readonly Pick<ReviewItem, 'key' | 'change'>[],
): Promise<Applied[]> {
  const created = new Map<string, string>();
  const out: Applied[] = [];
  for (const { key, change } of items) {
    try {
      out.push({ key, ok: true, ...(await applyOne(supabase, change, created)) });
    } catch (e) {
      out.push({ key, ok: false, error: message(e) });
    }
  }
  return out;
}

/** What the model is told after the review, so a follow-up knows what's in the database now. */
export function outcomeText(
  items: readonly Pick<ReviewItem, 'key' | 'change'>[],
  applied: readonly Applied[] | null,
  kept: ReadonlySet<string>,
): string {
  if (!applied) return 'The user discarded the proposed changes. Nothing was written.';
  const byKey = new Map(applied.map((a) => [a.key, a]));
  const lines = items.map((item, i) => {
    const a = byKey.get(item.key);
    const what = `${i + 1}. ${item.change.table} ${item.change.action}`;
    if (!kept.has(item.key) || !a) return `${what}: left out by the user`;
    return a.ok ? `${what}: applied${a.id ? ` (id ${a.id})` : ''}` : `${what}: failed: ${a.error}`;
  });
  const ok = applied.filter((a) => a.ok).length;
  return `The user reviewed the changes. ${ok} of ${items.length} applied.\n${lines.join('\n')}`;
}
