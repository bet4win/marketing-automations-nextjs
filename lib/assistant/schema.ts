/**
 * What the assistant may propose to change (docs/assistant.md): the tables the app's own forms write,
 * with the same actions and columns. Policy, so it is written here; what the database *looks like*
 * is read live from Postgres instead (introspect.ts), so it can't drift from the migrations.
 */

export const WRITING_TEXT = `
## Writing (propose_changes only)

- manual_contacts: insert | upsert (conflict: company_id, full_name) | update (match: id). Columns: company_id,
  full_name, job_title, email, phone, linkedin_url, note. The source is set for you.
- lead_activity: insert. Columns: company_id, event_id, kind (met|call|email|note|message), occurred_at (ISO
  timestamp; leave it out unless the user says when, and it is recorded as now), body, met_name, met_role,
  met_company_id. A message also takes channel (whatsapp|teams|telegram|slack|linkedin|other) and direction
  (out = we wrote, in = they wrote). Emails sync from Gmail by themselves; log one only when asked.
- lead_states: upsert (conflict: event_id, company_id) | update (match: event_id, company_id). Columns: status_id,
  priority, owner, starred, notes, contacted_on, replied_on, next_action, next_action_on (dates as YYYY-MM-DD).
- company_states: upsert (conflict: company_id) | update (match: company_id). Columns: status_id, owner, note,
  priority.
- person_marks: upsert (conflict: company_id, name_key). Columns: known, georgian. name_key is the person's
  full_name, lowercased and trimmed.
- opportunities: insert | update (match: id). Columns: company_id, route, via_company_id, stage, title, games,
  rev_share_pct, markets, expected_live_on, monthly_value, currency, owner, note, lost_reason.
- companies: insert only, and only when nothing matches by name, alias or domain. Columns: name, domain, hq_city,
  hq_country. Give it a "ref" and use "$ref:<ref>" as company_id in later changes of the same proposal.
`.trim();

export type Action = 'insert' | 'update' | 'upsert';

export interface WritableTable {
  actions: readonly Action[];
  columns: readonly string[];
  /** Upsert's conflict target. Its columns must be in the values. */
  conflict?: readonly string[];
  /** Update's match: exactly these columns identify the row. */
  match?: readonly string[];
  /** Columns the app fills in, whatever the model says. */
  fixed?: Readonly<Record<string, unknown>>;
}

export const WRITABLE: Readonly<Record<string, WritableTable>> = {
  manual_contacts: {
    actions: ['insert', 'upsert', 'update'],
    columns: ['company_id', 'full_name', 'job_title', 'email', 'phone', 'linkedin_url', 'note'],
    conflict: ['company_id', 'full_name'],
    match: ['id'],
    fixed: { source: 'assistant' },
  },
  lead_activity: {
    actions: ['insert'],
    columns: [
      'company_id', 'event_id', 'kind', 'occurred_at', 'body', 'met_name', 'met_role', 'met_company_id',
      'channel', 'direction',
    ],
  },
  lead_states: {
    actions: ['upsert', 'update'],
    columns: [
      'event_id',
      'company_id',
      'status_id',
      'priority',
      'owner',
      'starred',
      'notes',
      'contacted_on',
      'replied_on',
      'next_action',
      'next_action_on',
    ],
    conflict: ['event_id', 'company_id'],
    match: ['event_id', 'company_id'],
  },
  company_states: {
    actions: ['upsert', 'update'],
    columns: ['company_id', 'status_id', 'owner', 'note', 'priority'],
    conflict: ['company_id'],
    match: ['company_id'],
  },
  person_marks: {
    actions: ['upsert'],
    columns: ['company_id', 'name_key', 'known', 'georgian'],
    conflict: ['company_id', 'name_key'],
  },
  opportunities: {
    actions: ['insert', 'update'],
    columns: [
      'company_id',
      'route',
      'via_company_id',
      'stage',
      'title',
      'games',
      'rev_share_pct',
      'markets',
      'expected_live_on',
      'monthly_value',
      'currency',
      'owner',
      'note',
      'lost_reason',
    ],
    match: ['id'],
  },
  companies: {
    actions: ['insert'],
    columns: ['name', 'domain', 'hq_city', 'hq_country'],
  },
};

/** How the review names a table's rows. */
export const TABLE_LABELS: Readonly<Record<string, string>> = {
  manual_contacts: 'Person',
  lead_activity: 'Activity',
  lead_states: 'Event pipeline',
  company_states: 'Relationship',
  person_marks: 'Person mark',
  opportunities: 'Deal',
  companies: 'New company',
};
