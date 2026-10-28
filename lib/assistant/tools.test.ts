import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  ANSWER_NUDGE,
  checkProposal,
  EMPTY_NUDGE,
  firstRelation,
  idsIn,
  MAX_RESULT_CHARS,
  MAX_ROWS,
  parseArgs,
  queryKey,
  resultText,
  runSql,
  unknownIds,
} from './tools';

/** A client whose `rpc` records its call and answers with `data` or `error`. */
function rpcClient(answer: { data?: unknown; error?: { message: string; details?: string; hint?: string } }) {
  const calls: unknown[][] = [];
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push([fn, args]);
      return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('sql tool', () => {
  it('runs the SELECT through assistant_sql and labels it by the first relation', async () => {
    const { client, calls } = rpcClient({ data: [{ company_name: 'Games Valley' }] });
    const outcome = await runSql(client, JSON.stringify({ sql: 'select company_name from next_follow_ups limit 1' }));
    expect(calls).toEqual([['assistant_sql', { query: 'select company_name from next_follow_ups limit 1', max_rows: MAX_ROWS }]]);
    expect(outcome).toMatchObject({ ok: true, label: 'next_follow_ups · 1 rows', rows: 1 });
    expect(outcome.result).toContain('Games Valley');
  });

  it('says the result was cut when the function returns the extra row', async () => {
    const data = Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({ i }));
    const outcome = await runSql(rpcClient({ data }).client, JSON.stringify({ sql: 'select i from t' }));
    expect(outcome.rows).toBe(MAX_ROWS);
    expect(outcome.result).toMatch(/^200 rows \(the limit/);
  });

  it('hands back the database error to fix', async () => {
    const error = { message: 'column "company_name" does not exist', hint: 'Perhaps you meant "name".' };
    const outcome = await runSql(rpcClient({ error }).client, JSON.stringify({ sql: 'select company_name from lead_board' }));
    expect(outcome).toMatchObject({ ok: false, label: 'lead_board · error' });
    expect(outcome.result).toContain('Perhaps you meant "name".');
  });

  it('refuses arguments that are not JSON or have no sql', async () => {
    const { client, calls } = rpcClient({ data: [] });
    expect((await runSql(client, 'select 1')).label).toBe('sql · bad arguments');
    expect((await runSql(client, '{}')).label).toBe('sql · bad arguments');
    expect(calls).toHaveLength(0);
  });

  it('reads arguments wrapped in a code fence', () => {
    expect(parseArgs('```json\n{"sql":"select 1"}\n```')).toEqual({ sql: 'select 1' });
    expect(parseArgs('')).toEqual({});
  });

  it('finds the first relation for the label', () => {
    expect(firstRelation('select a from public.lead_board lb join events e on true')).toBe('lead_board');
    expect(firstRelation('with x as (select 1) select * from x')).toBe('x');
    expect(firstRelation('select 1')).toBe('sql');
  });

  it('says when the limit was reached, and halves rows to fit', () => {
    expect(resultText([{ a: 1 }], true)).toMatch(/^1 rows \(the limit/);
    const rows = Array.from({ length: 400 }, (_, i) => ({ i, text: 'x'.repeat(100) }));
    const text = resultText(rows);
    expect(text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS + 200);
    expect(text).toMatch(/showing the first \d+/);
  });

  it('ends every result with a nudge to answer, and says what to do with none', () => {
    expect(resultText([{ a: 1 }]).endsWith(ANSWER_NUDGE)).toBe(true);
    expect(resultText([])).toBe(`0 rows. ${EMPTY_NUDGE}`);
  });
});

describe('sql tool: a repeat', () => {
  it('gives the same key to the same query however it is spaced', () => {
    const a = queryKey('{"sql":"select name from events limit 5"}');
    const b = queryKey('```json\n{ "sql": "select name\\n  from events   limit 5;" }\n```');
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  it('tells different queries apart, and leaves bad arguments to fail normally', () => {
    expect(queryKey('{"sql":"select 1"}')).not.toBe(queryKey('{"sql":"select 2"}'));
    expect(queryKey('not json')).toBeNull();
    expect(queryKey('{}')).toBeNull();
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

/** A client whose query fails with `error` unless it asks for `*`, which returns `row`. */

describe('propose_changes: ids it never read', () => {
  const softswiss = '7ffd8bcf-4b9c-4647-bcdc-1487bfe186db';
  const invented = 'd2d0b866-9b61-4b3f-8f6c-1c1e1e1e1e1e';
  const check = (companyId: string) => {
    const result = checkProposal(
      proposal([{ table: 'lead_activity', action: 'insert', values: { company_id: companyId, kind: 'note', body: 'Replied' } }]),
    );
    if (!result.ok) throw new Error(result.error);
    return result.proposal;
  };

  it('finds an id that is in no result, message or context', () => {
    const known = idsIn(`[{"id":"${softswiss}","name":"SOFTSWISS"}]`);
    expect(unknownIds(check(invented), known)).toEqual([invented]);
  });

  it('accepts an id the model read, whatever its case', () => {
    expect(unknownIds(check(softswiss.toUpperCase()), idsIn(`{"id":"${softswiss}"}`))).toEqual([]);
  });
});
