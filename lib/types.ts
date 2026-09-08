/** Row of the `lead_board` view: one company at one event. */
export type Lead = {
  event_id: string;
  event_slug: string;
  company_id: string;
  name: string;
  category_key: string | null;
  category_label: string | null;
  category_group: string | null;
  /** Every category, primary first. `category_key/label` remain the primary. */
  category_labels: string[] | null;
  category_keys: string[] | null;
  category_confidence: 'verified' | 'classified' | 'inferred' | null;
  domain: string | null;
  domain_source: string | null;
  hq_country: string | null;
  hq_city: string | null;
  reach: Reach | null;
  reach_source: 'apollo' | 'estimate' | null;
  linkedin_url: string | null;
  x_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  telegram_url: string | null;
  apollo_industry: string | null;
  apollo_employees: number | null;
  apollo_revenue: number | null;
  apollo_founded: number | null;
  apollo_bd_headcount: number | null;
  apollo_sales_headcount: number | null;
  apollo_note: string | null;
  data_note: string | null;
  booths: string[] | null;
  zones: string[] | null;
  stand_count: number;
  event_count: number;
  /** Which events this company is on — not just how many. */
  event_ids: string[] | null;
  event_names: string[] | null;
  event_status_id: string | null;
  event_status: string | null;
  priority: Priority | null;
  owner: string | null;
  starred: boolean | null;
  notes: string | null;
  company_status_id: string | null;
  company_status: string | null;
  company_status_terminal: boolean | null;
  /**
   * open | won | lost. `is_terminal` alone lumped Active partner in with Not
   * a fit, so the board faded live partners as if they were disabled.
   */
  company_status_outcome: 'open' | 'won' | 'lost' | null;
  company_status_label: string | null;
  company_status_color: string | null;
  company_note: string | null;
  /**
   * Downstream of a partner we have terms with, and not somewhere we are
   * already live. Never true at the same time as a `won` relationship — the
   * partner mark says that better.
   */
  in_reach?: boolean | null;
  /** What the best known route pays, as % of their GGR. Null if unpriced. */
  reach_ggr_pct?: number | null;
  /** Already joined by the view — the client only ever displayed it. */
  reach_chain?: string | null;
  reach_unpriced?: number | null;
  /** 'manual' = created from the UI rather than by ingestion. */
  source?: 'ingest' | 'manual';
  contacted_on: string | null;
  replied_on: string | null;
  next_action: string | null;
  next_action_on: string | null;
  /** When any scraped fact here was last confirmed. Null means unknown. */
  last_enriched_at?: string | null;
  domain_verified_at?: string | null;
  /** Override layer: hidden rows are excluded, not deleted. */
  hidden?: boolean | null;
  hidden_reason?: string | null;
  /** Field names a human has taken over — the rest are as ingested. */
  overridden?: string[] | null;
  /** The scraped name, when a correction has replaced it. */
  ingested_name?: string | null;
};

/** A row of `schedule_board`: one dated next action. */
export type ScheduleItem = {
  event_id: string;
  event_name: string;
  event_slug: string;
  event_kind: 'event' | 'list' | 'all' | null;
  company_id: string;
  company_name: string;
  domain: string | null;
  category_label: string | null;
  category_key: string | null;
  category_group: string | null;
  reach: Reach | null;
  hq_country: string | null;
  apollo_employees: number | null;
  /** Stand numbers at this event — an array, since a company can hold two. */
  booths: string[] | null;
  zones: string[] | null;
  next_action: string | null;
  next_action_on: string;
  contacted_on: string | null;
  replied_on: string | null;
  owner: string | null;
  notes: string | null;
  event_status_id: string | null;
  event_status: string | null;
  event_status_label: string | null;
  status_color: string | null;
  priority: Priority | null;
  /** Company-wide relationship, which outlives any one event. */
  company_status: string | null;
  company_status_label: string | null;
  company_status_color: string | null;
  company_status_terminal: boolean | null;
  company_status_outcome: 'open' | 'won' | 'lost' | null;
  in_reach: boolean | null;
  reach_ggr_pct: number | null;
  reach_chain: string | null;
  /** Derived in the view, so the wording cannot drift between callers. */
  contact_state: 'replied' | 'awaiting' | 'not_contacted';
  /** False means this follow-up is research, not outreach. */
  has_email: boolean;
  /** The company is hidden by an override. Marked, not dropped — see the view. */
  hidden: boolean | null;
  overdue: boolean;
  days_until: number;
};

/**
 * The `lead_states` columns a scheduled item owns.
 *
 * Written with an UPDATE rather than an upsert: `schedule_board` does not carry
 * every `lead_states` column, so upserting this shape would null the ones it
 * omits — `starred`.
 */
export type SchedulePatch = {
  status_id: string | null;
  owner: string | null;
  contacted_on: string | null;
  replied_on: string | null;
  next_action: string | null;
  next_action_on: string | null;
  notes: string | null;
};

export type Contact = {
  id: string;
  company_id: string;
  kind: 'person' | 'role' | 'switchboard';
  full_name: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  /** Profile of a named individual — not the company page, which is on Lead. */
  linkedin_url: string | null;
  attribution: Attribution | null;
  source_url: string | null;
  is_personal_data: boolean;
  /** false = the domain publishes no MX, so mail to it bounces. */
  mx_ok?: boolean | null;
  /**
   * Which table it came from. Absent means `contacts`, i.e. scraped — the two
   * are merged wherever contacts are listed, and must never read alike.
   */
  origin?: 'scraped' | 'entered';
};

/** A person typed in by a user. Kept out of `contacts` so a re-crawl can't touch it. */
export type ManualContact = {
  id: string;
  company_id: string;
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  note: string | null;
  source: 'manual' | 'pasted' | 'import';
  is_personal_data: boolean;
};

/**
 * A named individual, joined to the company they were found at.
 * `origin` says which table it came from — scraped facts and hand-entered
 * records must not be indistinguishable in the UI.
 */
export type Person = Contact & {
  full_name: string;
  company_name: string;
  origin: 'scraped' | 'entered';
};

export type EventRow = {
  id: string;
  slug: string;
  name: string;
  /**
   * event = a trade show with booths. list = a curated outreach set.
   * all = the indefinite catch-all every company belongs to.
   */
  kind?: 'event' | 'list' | 'all';
  city: string | null;
  country: string | null;
  venue: string | null;
  starts_on: string | null;
  ends_on: string | null;
  website: string | null;
  source_url: string | null;
  floorplan_url: string | null;
};

/**
 * One igamingcalendar.com listing, from the `industry_calendar` view.
 *
 * Deliberately not an `EventRow`. These are context for "should I be there",
 * not shows with a company board behind them — the switcher holds four
 * curated events and would be worse holding eighty-eight scraped listings.
 * A listing becomes an `EventRow` only through a promotion, which is the
 * `igaming-calendar` skill's job.
 */
export type IndustryEvent = {
  igc_id: string;
  name: string;
  slug: string | null;
  starts_on: string;
  /** null means a single-day event, not "the same as starts_on". */
  ends_on: string | null;
  /** The organiser's own line, verbatim. city/country/venue are populated
   *  only behind a confident split and are otherwise null. */
  location: string | null;
  city: string | null;
  country: string | null;
  venue: string | null;
  /** igamingcalendar's own labels, not our `categories` taxonomy. */
  categories: string[];
  description: string | null;
  /** The organiser's site, and the starting point for researching exhibitors. */
  website: string | null;
  source_url: string;
  fetched_at: string;
  dismissed: boolean;
  /** Set by a human promotion. */
  promoted_event_id: string | null;
  /** Derived on every read, never stored: a show we already hold under a
   *  different name. Storing it would make ingestion the author of human
   *  state. */
  matched_event_id: string | null;
  /** The human answer resolved over the guess. */
  event_id: string | null;
  event_name: string | null;
  event_slug: string | null;
  companies_known: number;
};

export type Category = { key: string; label: string; group_name: string; sort_order: number };

export type Status = {
  id: string;
  scope: 'company' | 'event';
  key: string;
  label: string;
  color: string | null;
  sort_order: number;
  is_default: boolean;
  is_terminal: boolean;
};

/**
 * A Supabase auth user, as the owner dropdowns see them.
 *
 * Deliberately three fields. `listUsers` returns far more — phone, sign-in
 * records, identities, app metadata — and none of it belongs in the browser
 * just to render a picker. See app/api/owners/route.ts.
 *
 * `lead_states.owner` stores the **email**, not the id: it is a `text` column
 * that already holds free-typed names, and an email survives a CSV export
 * legibly where a uuid would not. The trade-off is that a row keeps the old
 * address if someone's email changes — acceptable for a small team, and the
 * picker shows any such orphan rather than silently dropping it.
 */
export type Owner = { id: string; email: string; name: string | null };

/** A row of `activity_feed`: one thing that happened, at one time. */
export type Activity = {
  id: string;
  company_id: string;
  event_id: string | null;
  /** `stage` rows are written by a trigger on a status change, not typed. */
  kind: 'met' | 'call' | 'email' | 'note' | 'stage';
  /** When it happened, not when it was typed. */
  occurred_at: string;
  body: string | null;
  met_name: string | null;
  met_role: string | null;
  created_at: string;
  /** Resolved against the account list in the client — see the view's comment. */
  created_by: string | null;
  company_name: string;
  event_name: string | null;
};

/** What the capture sheet sends. `occurred_at` defaults to now in the table. */
export type ActivityDraft = {
  kind: Exclude<Activity['kind'], 'stage'>;
  body: string | null;
  met_name: string | null;
  met_role: string | null;
  occurred_at?: string;
};

/** A row of `opportunity_board`: one piece of business. */
export type Opportunity = {
  id: string;
  company_id: string;
  route: 'direct' | 'via_aggregator' | 'aggregator_listing';
  via_company_id: string | null;
  stage: 'exploring' | 'negotiating' | 'contracted' | 'integrating' | 'live' | 'lost';
  title: string | null;
  games: string | null;
  rev_share_pct: number | null;
  markets: string[] | null;
  expected_live_on: string | null;
  monthly_value: number | null;
  currency: string | null;
  owner: string | null;
  note: string | null;
  lost_reason: string | null;
  created_at: string;
  company_name: string;
  via_company_name: string | null;
  days_to_live: number | null;
};

/**
 * A row of `distribution_edges`: the upstream carries the downstream.
 *
 * The downstream is not always an operator — an aggregator can pass our games
 * to another aggregator, which is why the ends are named by direction.
 */
export type DistributionEdge = {
  upstream_id: string;
  downstream_id: string;
  confidence: 'confirmed' | 'likely' | 'assumed';
  source_url: string | null;
  note: string | null;
  /** What the upstream charges. Null means nobody has told us yet. */
  rate_pct: number | null;
  /** ggr = the downstream pays this share of its GGR (terminal).
      pass_through = it passes this share of what it collects (chains). */
  rate_basis: 'ggr' | 'pass_through';
  rate_note: string | null;
  upstream_name: string;
  downstream_name: string;
  downstream_category: string | null;
  upstream_status: string | null;
  upstream_status_label: string | null;
  /** We already have a live relationship with the upstream. */
  partner_live: boolean;
};

/**
 * A company's own logo, scraped from its site.
 *
 * `ink` is which way round the mark runs, and the tile behind it follows:
 * white wordmarks are common on B2B sites with dark headers, and one fixed
 * tile colour makes half of them invisible.
 */
export type CompanyLogo = {
  /** Data URI — see the migration for why it is not a URL. */
  uri: string;
  ink: 'light' | 'dark';
};

/** A row of `distribution_reach`: one company reachable through a partner. */
export type ReachRoute = {
  root_id: string;
  root_name: string;
  via_id: string;
  via_name: string;
  depth: number;
  reached_id: string;
  reached_name: string;
  /** What the upstream charges that company, as % of its GGR. */
  their_ggr_pct: number | null;
  /** Our share of the collecting party's take, along the chain. */
  our_share_of_take: number | null;
  /** What reaches us, as % of that company's GGR. Null if any rate is unknown. */
  our_ggr_pct: number | null;
  confidence: 'confirmed' | 'likely' | 'assumed';
  chain: string[];
};

/** A row of `reach_summary`: one company we can reach, and how well we know it. */
export type ReachRow = {
  reached_id: string;
  reached_name: string;
  routes: number;
  /** Routes whose yield cannot be computed — each is a question to ask. */
  routes_unpriced: number;
  best_our_ggr_pct: number | null;
  shortest_chain: number;
  best_chain: string[] | null;
};

export type Reach = 'Global' | 'Multi-market' | 'Regional' | 'Emerging' | 'Unknown';
export type Priority = 'High' | 'Med' | 'Low';
export type Attribution = 'confirmed' | 'from_address' | 'role' | 'unattributed';
