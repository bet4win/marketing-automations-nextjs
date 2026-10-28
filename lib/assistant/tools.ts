import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { ToolSpec } from './client';
import { WRITABLE, type Action } from './schema';

/**
 * The assistant's tools (docs/assistant.md). `sql` reads straight away: one SELECT through the
 * `assistant_sql` function, which runs it read-only as the signed-in user. `read_thread` reads an
 * email conversation live from the user's own Gmail. `propose_changes` and `create_draft` never act
 * by themselves: each hands a checked request to a card, and only the user's button carries it out.
 */

export const MAX_ROWS = 200;
/** A tool result the model reads back. Bigger than this and the context fills with one table. */
export const MAX_RESULT_CHARS = 16_000;

const IDENT = /^[a-z_][a-z0-9_]*$/;

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const sqlArgs = z.object({
  sql: z.string().trim().min(1).max(8000),
});

export type SqlArgs = z.infer<typeof sqlArgs>;

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

export const threadArgs = z.object({ activity_id: z.string().uuid() });

const email = z.string().trim().email();
export const draftArgs = z.object({
  to: z.array(email).min(1).max(20),
  cc: z.array(email).max(20).default([]),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
  reply_to: z.string().uuid().nullish(),
});

export type DraftArgs = z.infer<typeof draftArgs>;

export type ProposedChange = z.infer<typeof change>;
export type Proposal = z.infer<typeof proposalArgs>;

export const TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'sql',
      description:
        'Run one read-only PostgreSQL SELECT (or WITH ... SELECT) against the database described in the system ' +
        'prompt, as the user. Join, filter and aggregate here: one query that answers the question beats several. ' +
        `Returns up to ${MAX_ROWS} rows as JSON. No semicolons, no writes.`,
      parameters: {
        type: 'object',
        properties: { sql: { type: 'string', description: 'The SELECT statement.' } },
        required: ['sql'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_thread',
      description:
        'The full text of the email conversation a message belongs to, read live from the user\'s Gmail (nothing ' +
        'stores whole emails: history rows hold a short snippet). Use it before drafting a reply or when a snippet ' +
        'is cut off. Works for synced emails (lead_activity rows with account_id) from the user\'s own mailbox.',
      parameters: {
        type: 'object',
        properties: { activity_id: { type: 'string', description: 'lead_activity.id of any message in the thread.' } },
        required: ['activity_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_draft',
      description:
        'Write an email for the user to save in their Gmail Drafts. Nothing is sent or saved by this call: it ' +
        'shows a draft card the user can edit, then save or discard. For a reply, read_thread first and pass ' +
        'reply_to so it lands in that thread. After calling this, stop and wait.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'array', items: { type: 'string' }, description: 'Email addresses.' },
          cc: { type: 'array', items: { type: 'string' } },
          subject: { type: 'string', description: 'For a reply, the thread\'s subject with "Re: ".' },
          body: {
            type: 'string',
            description: 'Plain text, paragraphs separated by a blank line. **bold** and [text](url) are kept. ' +
              'End with "Best," on its own line and nothing after it: the user\'s signature is added below.',
          },
          reply_to: { type: 'string', description: 'lead_activity.id of the message this answers, if any.' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_changes',
      description:
        'Propose inserts, upserts or updates. Nothing is written: the user reviews every change and applies ' +
        'or discards them. Look up the ids first with sql. After calling this, stop and wait.',
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

/**
 * What follows every result. A small local model otherwise keeps querying after it has the answer
 * (a "next follow-up" question ran out of rounds that way), and it heeds a nudge placed where it's
 * reading far more than the same rule in the system prompt.
 */
export const ANSWER_NUDGE = 'If these rows answer the question, answer now.';
export const EMPTY_NUDGE = 'No rows. Broaden the filter once, or say the data does not hold it.';

/** Rows as compact JSON, cut to what the model can use. */
export function resultText(rows: unknown[], more = false): string {
  if (rows.length === 0) return `0 rows. ${EMPTY_NUDGE}`;
  const note = more ? ` (the limit; there are more: filter or aggregate)` : '';
  let shown = rows;
  let text = JSON.stringify(shown);
  while (text.length > MAX_RESULT_CHARS && shown.length > 1) {
    shown = shown.slice(0, Math.ceil(shown.length / 2));
    text = JSON.stringify(shown);
  }
  const cut = shown.length < rows.length ? `, showing the first ${shown.length} — select fewer columns` : '';
  return `${rows.length} rows${note}${cut}\n${text.slice(0, MAX_RESULT_CHARS)}\n${ANSWER_NUDGE}`;
}

export interface QueryOutcome {
  ok: boolean;
  /** What the model reads back. */
  result: string;
  /** What the panel shows: `next_follow_ups · 12 rows`. */
  label: string;
  rows?: number;
}

/**
 * What a repeated query gets instead of running again. A small model that has lost the thread asks the
 * same thing round after round (seven identical event_prospects reads in one turn) until the rounds
 * run out; the rows are already in its context, so the answer is to point it back at them.
 */
export const REPEAT_NUDGE = 'You already ran this exact query; its result is above. Answer from what you have now.';

/** A query's identity: its SQL with whitespace and a trailing semicolon evened out. Null when it doesn't parse. */
export function queryKey(raw: string): string | null {
  try {
    const parsed = sqlArgs.safeParse(parseArgs(raw));
    return parsed.success ? parsed.data.sql.replace(/;\s*$/, '').replace(/\s+/g, ' ').trim() : null;
  } catch {
    return null;
  }
}

/** The first relation a query reads, for the panel's label. */
export function firstRelation(sql: string): string {
  return /\bfrom\s+(?:public\.)?"?([a-z_][a-z0-9_]*)/i.exec(sql)?.[1] ?? 'sql';
}

export async function runSql(supabase: SupabaseClient, raw: string): Promise<QueryOutcome> {
  let json: unknown;
  try {
    json = parseArgs(raw);
  } catch {
    return { ok: false, result: 'Error: the arguments are not valid JSON.', label: 'sql · bad arguments' };
  }
  const parsed = sqlArgs.safeParse(json);
  if (!parsed.success) {
    return { ok: false, result: `Error: ${issuesText(parsed.error)}`, label: 'sql · bad arguments' };
  }
  const { sql } = parsed.data;
  const from = firstRelation(sql);
  const { data, error } = await supabase.rpc('assistant_sql', { query: sql, max_rows: MAX_ROWS });
  if (error) {
    const detail = [error.message, error.details, error.hint].filter(Boolean).join(' ');
    return { ok: false, result: `Error from the database: ${detail}`, label: `${from} · error` };
  }
  // The function returns one row past the limit, so a cut result can say so.
  const all = Array.isArray(data) ? (data as unknown[]) : [];
  const rows = all.slice(0, MAX_ROWS);
  return { ok: true, result: resultText(rows, all.length > MAX_ROWS), label: `${from} · ${rows.length} rows`, rows: rows.length };
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Every id in a text, lowercased. */
export function idsIn(text: string): Set<string> {
  return new Set((text.match(UUID) ?? []).map((id) => id.toLowerCase()));
}

/**
 * The ids a proposal uses that it never read. A small model will write a plausible uuid rather than
 * look one up (`d2d0b866-…-1c1e1e1e1e1e` for SOFTSWISS, whose id is elsewhere), and the review card can
 * only flag it after the fact. `known` is every id in the conversation that didn't come from the model:
 * query results, the user's messages, the "Now" context. `$ref`s are a proposal's own new companies.
 */
export function unknownIds(proposal: Proposal, known: Set<string>): string[] {
  const used = new Set<string>();
  for (const c of proposal.changes) {
    for (const value of [...Object.values(c.values), ...Object.values(c.match ?? {})]) {
      if (typeof value === 'string') for (const id of idsIn(value)) if (!known.has(id)) used.add(id);
    }
  }
  return [...used];
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

/** Reads a thread through the server, which checks the mailbox is the caller's. */
export async function readThread(raw: string, signal?: AbortSignal): Promise<QueryOutcome> {
  let parsed;
  try {
    parsed = threadArgs.safeParse(parseArgs(raw));
  } catch {
    return { ok: false, result: 'Error: the arguments are not valid JSON.', label: 'thread · bad arguments' };
  }
  if (!parsed.success) return { ok: false, result: `Error: ${issuesText(parsed.error)}`, label: 'thread · bad arguments' };
  const res = await fetch(`/api/integrations/gmail/thread?activity=${parsed.data.activity_id}`, { signal });
  const body = (await res.json().catch(() => ({}))) as { text?: string; messages?: number; error?: string };
  if (!res.ok || !body.text) {
    return { ok: false, result: `Error: ${body.error ?? res.statusText}`, label: 'thread · could not read' };
  }
  return {
    ok: true,
    result: `${body.text.slice(0, MAX_RESULT_CHARS)}\n${ANSWER_NUDGE}`,
    label: `thread · ${body.messages} message${body.messages === 1 ? '' : 's'}`,
  };
}

export type DraftCheck = { ok: true; draft: DraftArgs } | { ok: false; error: string };

export function checkDraft(raw: string): DraftCheck {
  try {
    const parsed = draftArgs.safeParse(parseArgs(raw));
    return parsed.success ? { ok: true, draft: parsed.data } : { ok: false, error: issuesText(parsed.error) };
  } catch {
    return { ok: false, error: 'the arguments are not valid JSON.' };
  }
}
