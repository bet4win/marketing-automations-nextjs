import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { ToolSpec } from './client';
import { READABLE, WRITABLE, type Action } from './schema';

/**
 * The assistant's two tools (docs/assistant.md). `query` reads straight away: it is a PostgREST GET,
 * which cannot write. `propose_changes` never writes: it hands a checked change set to the review
 * card, and only the user's Apply runs it.
 */

export const MAX_ROWS = 200;
/** A tool result the model reads back. Bigger than this and the context fills with one table. */
export const MAX_RESULT_CHARS = 16_000;

const IDENT = /^[a-z_][a-z0-9_]*$/;

const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs', 'ov'] as const;

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const queryArgs = z.object({
  from: z.enum(READABLE),
  select: z.string().trim().min(1).max(1000).default('*'),
  filters: z
    .array(
      z.object({
        column: z.string().regex(/^[a-z_][a-z0-9_]*(->>?[a-z0-9_]+)*$/),
        op: z.enum(OPS),
        value: z.union([scalar, z.array(scalar)]),
      }),
    )
    .max(20)
    .default([]),
  /** PostgREST's own `or` syntax, e.g. `name.ilike.*kiron*,domain.ilike.*kiron*`. */
  or: z.string().max(1000).optional(),
  order: z
    .array(z.object({ column: z.string().regex(IDENT), ascending: z.boolean().default(true) }))
    .max(5)
    .default([]),
  limit: z.number().int().positive().max(MAX_ROWS).default(50),
});

export type QueryArgs = z.infer<typeof queryArgs>;

const change = z.object({
  table: z.string(),
  action: z.enum(['insert', 'update', 'upsert']),
  match: z.record(z.string(), scalar).optional(),
  values: z.record(z.string(), z.union([scalar, z.array(scalar)])),
  reason: z.string().max(500).optional(),
  /** A name for a new company, so later changes can point at it as `$ref:<ref>`. */
  ref: z.string().regex(IDENT).optional(),
});

export const proposalArgs = z.object({
  summary: z.string().trim().min(1).max(500),
  changes: z.array(change).min(1).max(50),
});

export type ProposedChange = z.infer<typeof change>;
export type Proposal = z.infer<typeof proposalArgs>;

export const TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'query',
      description:
        'Read rows from one table or view through the Supabase API. Embed related rows over foreign keys in select ' +
        '(e.g. "name,domain,manual_contacts(full_name,email)"), and aggregate with count() or sum(col) ' +
        '(e.g. "category_label,count()"). Returns JSON rows.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', enum: [...READABLE] },
          select: { type: 'string', description: 'PostgREST select list. Default *. Prefer naming the columns.' },
          filters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                column: { type: 'string' },
                op: { type: 'string', enum: [...OPS] },
                value: { description: 'A value; an array for in/cs/ov; null with is. like/ilike use * or %.' },
              },
              required: ['column', 'op', 'value'],
            },
          },
          or: { type: 'string', description: 'PostgREST or-filter, e.g. "name.ilike.*acme*,domain.ilike.*acme*"' },
          order: {
            type: 'array',
            items: {
              type: 'object',
              properties: { column: { type: 'string' }, ascending: { type: 'boolean' } },
              required: ['column'],
            },
          },
          limit: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Default 50.' },
        },
        required: ['from'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_changes',
      description:
        'Propose inserts, upserts or updates. Nothing is written: the user reviews every change and applies ' +
        'or discards them. Look up the ids first with query. After calling this, stop and wait.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One line: what these changes do.' },
          changes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                table: { type: 'string', enum: Object.keys(WRITABLE) },
                action: { type: 'string', enum: ['insert', 'update', 'upsert'] },
                match: { type: 'object', description: 'update only: the key columns of the row to change.' },
                values: { type: 'object', description: 'Column → new value.' },
                reason: { type: 'string', description: 'Why, in a few words (e.g. "from card 2").' },
                ref: { type: 'string', description: 'companies insert only: a name later changes use as $ref:<ref>.' },
              },
              required: ['table', 'action', 'values'],
            },
          },
        },
        required: ['summary', 'changes'],
      },
    },
  },
];

/** A model's arguments: JSON text, sometimes wrapped in a code fence. */
export function parseArgs(text: string): unknown {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(body || '{}');
}

/** zod's issues as one line the model can act on. */
export function issuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`)
    .join('; ');
}

type Filterable = {
  eq: (c: string, v: unknown) => Filterable;
  neq: (c: string, v: unknown) => Filterable;
  gt: (c: string, v: unknown) => Filterable;
  gte: (c: string, v: unknown) => Filterable;
  lt: (c: string, v: unknown) => Filterable;
  lte: (c: string, v: unknown) => Filterable;
  like: (c: string, v: string) => Filterable;
  ilike: (c: string, v: string) => Filterable;
  is: (c: string, v: null | boolean) => Filterable;
  in: (c: string, v: readonly unknown[]) => Filterable;
  contains: (c: string, v: unknown) => Filterable;
  overlaps: (c: string, v: unknown) => Filterable;
  or: (f: string) => Filterable;
  order: (c: string, o: { ascending: boolean }) => Filterable;
  limit: (n: number) => Filterable;
};

const asList = (v: unknown) => (Array.isArray(v) ? v : [v]);
const asPattern = (v: unknown) => String(v ?? '').replace(/%/g, '*');

/** Applies the filters, order and limit to a supabase-js select, the same calls the app itself makes. */
export function applyQuery<Q>(query: Q, args: QueryArgs): Q {
  let q = query as unknown as Filterable;
  for (const f of args.filters) {
    switch (f.op) {
      case 'like':
        q = q.like(f.column, asPattern(f.value));
        break;
      case 'ilike':
        q = q.ilike(f.column, asPattern(f.value));
        break;
      case 'is':
        q = q.is(f.column, f.value === null || f.value === 'null' ? null : Boolean(f.value));
        break;
      case 'in':
        q = q.in(f.column, asList(f.value));
        break;
      case 'cs':
        q = q.contains(f.column, asList(f.value));
        break;
      case 'ov':
        q = q.overlaps(f.column, asList(f.value));
        break;
      default:
        q = q[f.op](f.column, f.value);
    }
  }
  // supabase-js adds the parentheses itself; models often write them too, which would nest them.
  if (args.or) q = q.or(args.or.trim().replace(/^\((.*)\)$/, '$1'));
  for (const o of args.order) q = q.order(o.column, { ascending: o.ascending });
  return q.limit(args.limit) as unknown as Q;
}

/** Rows as compact JSON, cut to what the model can use. */
export function resultText(rows: unknown[], limit: number): string {
  const note = rows.length >= limit ? ` (the limit; there may be more — filter or aggregate)` : '';
  let shown = rows;
  let text = JSON.stringify(shown);
  while (text.length > MAX_RESULT_CHARS && shown.length > 1) {
    shown = shown.slice(0, Math.ceil(shown.length / 2));
    text = JSON.stringify(shown);
  }
  const cut = shown.length < rows.length ? `, showing the first ${shown.length} — select fewer columns` : '';
  return `${rows.length} rows${note}${cut}\n${text.slice(0, MAX_RESULT_CHARS)}`;
}

export interface QueryOutcome {
  ok: boolean;
  /** What the model reads back. */
  result: string;
  /** What the panel shows: `lead_board · 12 rows`. */
  label: string;
  rows?: number;
}

export async function runQuery(supabase: SupabaseClient, raw: string): Promise<QueryOutcome> {
  let json: unknown;
  try {
    json = parseArgs(raw);
  } catch {
    return { ok: false, result: 'Error: the arguments are not valid JSON.', label: 'query · bad arguments' };
  }
  const parsed = queryArgs.safeParse(json);
  if (!parsed.success) {
    return { ok: false, result: `Error: ${issuesText(parsed.error)}`, label: 'query · bad arguments' };
  }
  const args = parsed.data;
  const { data, error } = await applyQuery(supabase.from(args.from).select(args.select), args);
  if (error) {
    const detail = [error.message, error.details, error.hint].filter(Boolean).join(' ');
    return { ok: false, result: `Error from the database: ${detail}`, label: `${args.from} · error` };
  }
  const rows = (data ?? []) as unknown[];
  return { ok: true, result: resultText(rows, args.limit), label: `${args.from} · ${rows.length} rows`, rows: rows.length };
}

export type ProposalCheck = { ok: true; proposal: Proposal } | { ok: false; error: string };

const REF = /^\$ref:([a-z_][a-z0-9_]*)$/;

/**
 * Checks a proposal against what the app lets the browser write: known tables, their actions and
 * columns, the keys an upsert or update needs, and `$ref`s that point at an earlier new company.
 * Errors go back to the model, which can fix and propose again.
 */
export function checkProposal(raw: string): ProposalCheck {
  let json: unknown;
  try {
    json = parseArgs(raw);
  } catch {
    return { ok: false, error: 'the arguments are not valid JSON.' };
  }
  const parsed = proposalArgs.safeParse(json);
  if (!parsed.success) return { ok: false, error: issuesText(parsed.error) };

  const errors: string[] = [];
  const refs = new Set<string>();
  parsed.data.changes.forEach((c, i) => {
    const at = `changes.${i} (${c.table} ${c.action})`;
    const table = WRITABLE[c.table];
    if (!table) return void errors.push(`${at}: ${c.table} is not writable`);
    if (!table.actions.includes(c.action as Action)) {
      return void errors.push(`${at}: ${c.table} allows ${table.actions.join(', ')}`);
    }
    const unknown = Object.keys(c.values).filter((k) => !table.columns.includes(k));
    if (unknown.length) errors.push(`${at}: not writable columns ${unknown.join(', ')}`);
    if (c.action === 'upsert') {
      // Models often put an upsert's key in match, as for an update: take it from there.
      for (const k of table.conflict ?? []) {
        if ((c.values[k] == null || c.values[k] === '') && c.match?.[k] != null) c.values[k] = c.match[k];
      }
      delete c.match;
      const missing = (table.conflict ?? []).filter((k) => c.values[k] == null || c.values[k] === '');
      if (missing.length) errors.push(`${at}: an upsert needs ${missing.join(', ')} in values`);
    }
    if (c.action === 'update') {
      const keys = Object.keys(c.match ?? {}).sort();
      const want = [...(table.match ?? [])].sort();
      if (keys.join() !== want.join() || Object.values(c.match ?? {}).some((v) => v == null || v === '')) {
        errors.push(`${at}: an update needs match with exactly ${want.join(', ')}`);
      }
    }
    if (c.table === 'companies') {
      if (!String(c.values.name ?? '').trim()) errors.push(`${at}: a company needs a name`);
      if (c.ref) refs.add(c.ref);
    } else if (c.ref) {
      errors.push(`${at}: only a companies insert takes a ref`);
    }
    for (const [column, value] of Object.entries(c.values)) {
      const ref = typeof value === 'string' ? REF.exec(value) : null;
      if (ref && !refs.has(ref[1]!)) errors.push(`${at}: ${column} points at $ref:${ref[1]}, which no earlier change defines`);
    }
    if (c.table === 'person_marks' && typeof c.values.name_key === 'string') {
      c.values.name_key = c.values.name_key.trim().toLowerCase();
    }
  });
  return errors.length ? { ok: false, error: errors.join('; ') } : { ok: true, proposal: parsed.data };
}
