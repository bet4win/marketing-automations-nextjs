/**
 * What the assistant knows about the database (docs/assistant.md): the relations it reads, and the
 * few it may propose changes to.
 *
 * Hand-written rather than introspected. The model needs to know *which* relation answers a
 * question — `lead_board` for a company at a show, `company_resolved` for the company as corrected —
 * and a column dump says none of that. Kept to what the migrations define; a column added later is
 * readable with `select=*` whether or not it's listed here.
 */

/** Readable relations, most useful first. RLS decides what can actually be read. */
export const READABLE = [
  'lead_board',
  'company_resolved',
  'company_aliases',
  'contact_resolved',
  'contacts',
  'manual_contacts',
  'person_marks',
  'lead_states',
  'company_states',
  'lead_activity',
  'activity_feed',
  'opportunities',
  'opportunity_board',
  'schedule_board',
  'suggestion_board',
  'events',
  'event_entries',
  'statuses',
  'categories',
  'company_categories',
  'distribution',
  'companies',
] as const;

export type Readable = (typeof READABLE)[number];

export const SCHEMA_TEXT = `
## Reading

- lead_board: one row per company per event (the board). ALWAYS filter by event_id. Columns: event_id, company_id,
  name, domain, category_label, category_labels[], hq_country, hq_city, reach, booths[], zones[], event_names[],
  event_status (per-event status key), priority (High|Med|Low), owner, starred, notes, contacted_on, replied_on,
  next_action, next_action_on, company_status, company_status_label, company_status_outcome (open|won|lost),
  company_note, in_reach, reach_chain, apollo_employees, hidden (true = hidden from the board by a correction;
  leave those out unless asked: {"column": "hidden", "op": "is", "value": false}).
  By category: {"column": "category_keys", "op": "cs", "value": ["agg"]} (any of a company's categories).
  Not contacted: {"column": "contacted_on", "op": "is", "value": null}.
- company_resolved: every company with human corrections applied. Use this, not companies, for names and domains.
  Columns: id, name, ingested_name, domain, hq_city, hq_country, reach, category_key, linkedin_url, hidden,
  apollo_industry, apollo_employees, source (ingest|manual).
- company_aliases: company_id, alias, normalized_alias. Other names a company goes by.
- contact_resolved: scraped people and mailboxes with human corrections applied. Use this, not contacts. id,
  company_id, kind (person|role|switchboard), full_name, job_title, email, phone, linkedin_url, attribution,
  source_url, overridden (fields a human corrected).
- contacts: scraped people and mailboxes as crawled, before corrections. Read-only.
- manual_contacts: people a user entered. id, company_id, full_name, job_title, email, phone, linkedin_url, note,
  source (manual|pasted|import|assistant), created_at.
- person_marks: company_id, name_key (lower(trim(full_name))), georgian (boolean or null), known (someone on the team
  knows them personally).
- lead_states: per company per event. event_id, company_id, status_id, priority, owner, starred, notes, contacted_on,
  replied_on, next_action, next_action_on. Unique on (event_id, company_id).
- company_states: per company, across events. company_id (key), status_id, owner, note, priority.
- activity_feed: the history (lead_activity with names). id, company_id, company_name, event_id, event_name,
  kind (met|call|email|note), occurred_at, body, met_name, met_role, met_company_id.
- opportunity_board: deals. id, company_id, company_name, route (direct|via_aggregator|aggregator_listing),
  via_company_id, via_company_name, stage (exploring|negotiating|contracted|integrating|live|lost), title, games,
  rev_share_pct, markets[], expected_live_on, monthly_value, currency, owner, note, lost_reason, days_to_live.
- schedule_board: dated next actions. event_id, event_name, company_id, company_name, next_action, next_action_on,
  contact_state (replied|awaiting|not_contacted), overdue, days_until, owner, booths[].
- suggestion_board: suggested targets. list_slug, section_title, rank, company_id, rationale, route, grade, event_id,
  stands (jsonb), stand_via_name.
- events: id, slug, name, city, country, starts_on, ends_on, kind (event|list|all).
- event_entries: event_id, company_id, booth, zone. Who exhibits where.
- statuses: id, scope (company|event), key, label, outcome (open|won|lost), is_terminal. status_id columns point here.
- categories: key, label, group_name. company_categories: company_id, category_key, is_primary. The keys:
  studio (game studio), live (live casino), crash, agg (content aggregator), platform (casino platform / PAM),
  sbplatform (sportsbook platform), sportsdata, esports, psp, apm, crypto, banking, kyc, regtech, rg, testlab,
  regulator, affnet (affiliates), afftech, adnet, crm, agency, media, infra, comms, ai, hr, consult,
  operator (operator / B2C brand), other.
- Status keys: per event (lead_states.status_id, lead_board.event_status) new, researching, contacted, meeting,
  qualified, dropped; per company (company_states.status_id) prospect, in_discussion, negotiating, integrated,
  partner, declined, not_a_fit. Look the id up in statuses by scope and key.
- distribution: aggregator_id, operator_id, confidence (confirmed|likely|assumed), rate_pct, note. Who distributes to
  whom.

## Writing (propose_changes only)

- manual_contacts: insert | upsert (conflict: company_id, full_name) | update (match: id). Columns: company_id,
  full_name, job_title, email, phone, linkedin_url, note. The source is set for you.
- lead_activity: insert. Columns: company_id, event_id, kind (met|call|email|note), occurred_at (ISO timestamp;
  leave it out unless the user says when, and it is recorded as now), body, met_name, met_role, met_company_id.
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
    columns: ['company_id', 'event_id', 'kind', 'occurred_at', 'body', 'met_name', 'met_role', 'met_company_id'],
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
