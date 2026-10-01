import { describe, expect, it } from 'vitest';
import { applyQuery, checkProposal, MAX_RESULT_CHARS, parseArgs, queryArgs, resultText } from './tools';

/** Records the supabase-js calls a query makes. */
function recorder() {
  const calls: unknown[][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'overlaps', 'or', 'order', 'limit']) {
    q[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return q;
    };
  }
  return { q, calls };
}

describe('query tool', () => {
  it('turns filters, or, order and limit into the supabase-js calls', () => {
    const { q, calls } = recorder();
    const args = queryArgs.parse({
      from: 'lead_board',
      select: 'name,booths',
      filters: [
        { column: 'event_id', op: 'eq', value: 'e1' },
        { column: 'name', op: 'ilike', value: '%kiron%' },
        { column: 'contacted_on', op: 'is', value: null },
        { column: 'category_keys', op: 'ov', value: ['aggregator'] },
        { column: 'priority', op: 'in', value: ['High', 'Med'] },
      ],
      or: 'owner.is.null,owner.eq.Gio',
      order: [{ column: 'name' }],
      limit: 20,
    });
    applyQuery(q, args);
    expect(calls).toEqual([
      ['eq', 'event_id', 'e1'],
      ['ilike', 'name', '*kiron*'],
      ['is', 'contacted_on', null],
      ['overlaps', 'category_keys', ['aggregator']],
      ['in', 'priority', ['High', 'Med']],
      ['or', 'owner.is.null,owner.eq.Gio'],
      ['order', 'name', { ascending: true }],
      ['limit', 20],
    ]);
  });

  it('takes an or-filter with or without its own parentheses', () => {
    for (const or of ['(name.ilike.*a*,domain.ilike.*a*)', 'name.ilike.*a*,domain.ilike.*a*']) {
      const { q, calls } = recorder();
      applyQuery(q, queryArgs.parse({ from: 'company_resolved', or }));
      expect(calls[0]).toEqual(['or', 'name.ilike.*a*,domain.ilike.*a*']);
    }
  });

  it('defaults to every column and 50 rows, and refuses what it cannot read', () => {
    expect(queryArgs.parse({ from: 'events' })).toMatchObject({ select: '*', limit: 50, filters: [] });
    expect(queryArgs.safeParse({ from: 'auth.users' }).success).toBe(false);
    expect(queryArgs.safeParse({ from: 'events', limit: 5000 }).success).toBe(false);
    expect(queryArgs.safeParse({ from: 'events', filters: [{ column: 'x;drop', op: 'eq', value: 1 }] }).success).toBe(false);
  });

  it('reads arguments wrapped in a code fence', () => {
    expect(parseArgs('```json\n{"from":"events"}\n```')).toEqual({ from: 'events' });
    expect(parseArgs('')).toEqual({});
  });

  it('says when the limit was reached, and halves rows to fit', () => {
    expect(resultText([{ a: 1 }], 1)).toMatch(/^1 rows \(the limit/);
    const rows = Array.from({ length: 400 }, (_, i) => ({ i, text: 'x'.repeat(100) }));
    const text = resultText(rows, 400);
    expect(text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS + 200);
    expect(text).toMatch(/showing the first \d+/);
  });
});

const proposal = (changes: unknown[]) => JSON.stringify({ summary: 'Test', changes });

describe('propose_changes: the check', () => {
  it('accepts a card: a new company, its person by $ref, and a meeting', () => {
    const check = checkProposal(
      proposal([
        { table: 'companies', action: 'insert', ref: 'acme', values: { name: 'Acme Gaming', domain: 'acme.io' } },
        { table: 'manual_contacts', action: 'upsert', values: { company_id: '$ref:acme', full_name: 'Ana Silva' } },
        { table: 'lead_activity', action: 'insert', values: { company_id: '$ref:acme', kind: 'met', met_name: 'Ana Silva' } },
      ]),
    );
    expect(check.ok).toBe(true);
  });

  it.each([
    [[{ table: 'contacts', action: 'insert', values: { full_name: 'X' } }], /contacts is not writable/],
    [[{ table: 'lead_activity', action: 'update', match: { id: '1' }, values: { body: 'x' } }], /allows insert/],
    [[{ table: 'manual_contacts', action: 'insert', values: { company_id: 'c', full_name: 'A', source: 'x' } }], /not writable columns source/],
    [[{ table: 'lead_states', action: 'upsert', values: { company_id: 'c', notes: 'x' } }], /needs event_id/],
    [[{ table: 'company_states', action: 'update', match: { id: 'x' }, values: { note: 'x' } }], /match with exactly company_id/],
    [[{ table: 'manual_contacts', action: 'insert', values: { company_id: '$ref:nope', full_name: 'A' } }], /no earlier change defines/],
    [[{ table: 'companies', action: 'insert', values: { name: ' ' } }], /needs a name/],
    [[{ table: 'lead_states', action: 'delete', values: {} }], /action/],
  ])('refuses %j', (changes, error) => {
    const check = checkProposal(proposal(changes));
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toMatch(error);
  });

  it('takes an upsert key the model put in match', () => {
    const check = checkProposal(
      proposal([{ table: 'lead_states', action: 'upsert', match: { event_id: 'e', company_id: 'c' }, values: { notes: 'x' } }]),
    );
    expect(check.ok && check.proposal.changes[0]).toEqual({
      table: 'lead_states',
      action: 'upsert',
      values: { notes: 'x', event_id: 'e', company_id: 'c' },
    });
  });

  it('keys person marks the way the app does', () => {
    const check = checkProposal(
      proposal([{ table: 'person_marks', action: 'upsert', values: { company_id: 'c', name_key: ' Ana Silva ', known: true } }]),
    );
    expect(check.ok && check.proposal.changes[0]!.values.name_key).toBe('ana silva');
  });

  it('says so when the arguments are not JSON', () => {
    expect(checkProposal('{nope')).toEqual({ ok: false, error: 'the arguments are not valid JSON.' });
  });
});
