import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyChanges, diff, emailHash, isNoop, outcomeText, resolveRefs, rowKey } from './changes';
import type { ProposedChange } from './tools';

describe('review: the diff', () => {
  it('marks what changes against the current row', () => {
    expect(diff({ notes: 'old', owner: 'Gio' }, { notes: 'new', owner: 'Gio' })).toEqual([
      { column: 'notes', before: 'old', after: 'new', changed: true },
      { column: 'owner', before: 'Gio', after: 'Gio', changed: false },
    ]);
    expect(diff(null, { notes: 'x' })[0]).toMatchObject({ before: null, changed: true });
  });

  it('knows a change that would leave the row as it is', () => {
    const change: ProposedChange = { table: 'company_states', action: 'upsert', values: { company_id: 'c', owner: 'Gio' } };
    expect(isNoop({ change, before: { company_id: 'c', owner: 'Gio', note: 'x' } })).toBe(true);
    expect(isNoop({ change, before: null })).toBe(false);
  });

  it('finds the row by match for an update and by the conflict columns for an upsert', () => {
    expect(rowKey({ table: 'lead_states', action: 'upsert', values: { event_id: 'e', company_id: 'c', notes: 'n' } })).toEqual({
      event_id: 'e',
      company_id: 'c',
    });
    expect(rowKey({ table: 'manual_contacts', action: 'update', match: { id: 'm' }, values: { note: 'n' } })).toEqual({ id: 'm' });
    expect(rowKey({ table: 'lead_activity', action: 'insert', values: {} })).toBeNull();
  });
});

describe('review: applying', () => {
  it('hashes an address the way contact_email_hash does', async () => {
    // encode(sha256('ana@acme.io'), 'hex')
    expect(await emailHash('  Ana@Acme.io ')).toBe('8142f7db8ac5e0dec4bf83fa59edf2a19c74284bc4b02afb7205ed400c8c383f');
  });

  it('points $refs at the companies created earlier, and clears empty strings', () => {
    expect(resolveRefs({ company_id: '$ref:acme', note: '' }, new Map([['acme', 'id-1']]))).toEqual({
      company_id: 'id-1',
      note: null,
    });
    expect(() => resolveRefs({ company_id: '$ref:gone' }, new Map())).toThrow(/was not created/);
  });

  it('applies in order, carries a new company id forward, and reports each row', async () => {
    const writes: { table: string; op: string; values: unknown; opts?: unknown }[] = [];
    const result = (data: unknown[], error: unknown = null) => ({
      select: () => Promise.resolve({ data, error }),
      single: () => Promise.resolve({ data: data[0], error }),
    });
    const supabase = {
      from: (table: string) => ({
        insert: (values: Record<string, unknown>) => {
          writes.push({ table, op: 'insert', values });
          // A company is inserted with .select('id').single(), anything else with .select().
          const chain = result(table === 'companies' ? [{ id: 'new-co' }] : [{ id: 'row' }]);
          return { select: () => (table === 'companies' ? chain : chain.select()) };
        },
        upsert: (values: Record<string, unknown>, opts: unknown) => {
          writes.push({ table, op: 'upsert', values, opts });
          // The erasure trigger: accepted, no row back.
          return result(values.email === 'gone@x.io' ? [] : [{ id: 'mc' }]);
        },
      }),
    } as unknown as SupabaseClient;
    const applied = await applyChanges(supabase, [
      { key: '0', change: { table: 'companies', action: 'insert', ref: 'acme', values: { name: 'Acme Ltd', domain: 'https://www.Acme.io/about' } } },
      { key: '1', change: { table: 'manual_contacts', action: 'upsert', values: { company_id: '$ref:acme', full_name: 'Ana' } } },
      { key: '2', change: { table: 'manual_contacts', action: 'upsert', values: { company_id: 'c', full_name: 'Bo', email: 'gone@x.io' } } },
    ]);
    expect(applied).toEqual([
      { key: '0', ok: true, id: 'new-co' },
      { key: '1', ok: true, id: 'mc' },
      { key: '2', ok: false, error: "gone@x.io was erased at that person's request." },
    ]);
    expect(writes[0]).toMatchObject({
      table: 'companies',
      values: { name: 'Acme Ltd', normalized_name: 'acme', domain: 'acme.io', source: 'manual' },
    });
    expect(writes[1]).toMatchObject({
      values: { company_id: 'new-co', full_name: 'Ana', source: 'assistant' },
      opts: { onConflict: 'company_id,full_name' },
    });
  });

  it('tells the model what happened to each change', () => {
    const items = [
      { key: '0', change: { table: 'manual_contacts', action: 'upsert', values: {} } as ProposedChange },
      { key: '1', change: { table: 'lead_activity', action: 'insert', values: {} } as ProposedChange },
      { key: '2', change: { table: 'lead_states', action: 'upsert', values: {} } as ProposedChange },
    ];
    const text = outcomeText(items, [{ key: '0', ok: true, id: 'm1' }, { key: '1', ok: false, error: 'boom' }], new Set(['0', '1']));
    expect(text).toBe(
      'The user reviewed the changes. 1 of 3 applied.\n' +
        '1. manual_contacts upsert: applied (id m1)\n' +
        '2. lead_activity insert: failed: boom\n' +
        '3. lead_states upsert: left out by the user',
    );
    expect(outcomeText(items, null, new Set())).toMatch(/discarded/);
  });
});
