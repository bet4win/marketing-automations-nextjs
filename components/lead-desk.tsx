'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { usePersistedFilters, useVisibleLeads, type SortKey } from '@/lib/filters';
import { useIsWide } from '@/lib/use-media';
import { today as todayLocal } from '@/lib/dates';
import type {
  Activity, ActivityDraft, Category, Contact, DistributionEdge, EventRow,
  CompanyLogo, IndustryEvent, Lead, ManualContact, Opportunity, Owner, Person, ReachRoute,
  SchedulePatch, ScheduleItem, Status,
} from '@/lib/types';
import { buildCompanyIndex, type CompanyRef } from '@/lib/entity-links';
import { buildPeople, mergeContacts } from '@/lib/people';
import { entryKey, pushEntry, type StackEntry } from '@/lib/drawer-stack';
import { FilterRail } from '@/components/filter-rail';
import { FloorplanDialog } from '@/components/floorplan-dialog';
import { CompanyPanel, type ContactDraft } from '@/components/lead-drawer';
import { LeadTable } from '@/components/lead-table';
import { LeadCards } from '@/components/lead-cards';
import { BulkBar, type BulkPatch } from '@/components/bulk-bar';
import { CompanyAdd } from '@/components/company-add';
import { CompanyOverride } from '@/components/company-override';
import { CaptureSheet } from '@/components/capture-sheet';
import { ScheduleEditor } from '@/components/schedule-editor';
import { ScheduleView } from '@/components/schedule-view';
import { PeopleImport } from '@/components/people-import';
import { PeopleView } from '@/components/people-view';
import { PersonPanel } from '@/components/person-drawer';
import { DrawerStack } from '@/components/drawer-stack';
import { LanyardMark } from '@/components/lanyard-mark';
import { UserMenu } from '@/components/user-menu';

const EVENT_KEY = 'lanyard.event';
const PAGE = 1000;   // PostgREST caps a response at 1000 rows

const CONTACT_COLS =
  'id,company_id,kind,full_name,job_title,email,phone,linkedin_url,attribution,source_url,is_personal_data';

const MANUAL_COLS =
  'id,company_id,full_name,job_title,email,phone,linkedin_url,note,source,is_personal_data';

export type View = 'companies' | 'people' | 'schedule';

/** Tab order, and the single place the label/route pairing lives. */
const VIEWS: View[] = ['companies', 'people', 'schedule'];

export function LeadDesk({
  email, name, events, categories, statuses,
}: {
  email: string;
  /** Display name, when the account has one set. */
  name: string | null;
  events: EventRow[];
  categories: Category[];
  statuses: Status[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  /**
   * Which tab is showing, read from the route rather than held as state.
   *
   * Read here rather than passed as a prop because this component lives in the
   * layout: a prop would come from a page, and a page re-rendering is exactly
   * the remount the layout exists to avoid. `/schedule` and "the schedule is
   * showing" can no longer disagree, and Back works.
   */
  // Which shape the board takes. A hook rather than CSS, so only one of the
  // two virtualisers ever mounts — a hidden one measures a zero-height box.
  const wide = useIsWide(1024);

  const view: View = pathname === '/people' ? 'people'
    : pathname === '/schedule' ? 'schedule' : 'companies';
  const params = useSearchParams();
  const search = params.toString();
  const deepLinkCompany = params.get('company');
  const deepLinkPerson = params.get('person');

  const [eventId, setEventId] = useState<string>(events[0]?.id ?? '');
  const [companyIndex, setCompanyIndex] = useState(() => buildCompanyIndex([]));
  const [leads, setLeads] = useState<Lead[]>([]);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [manualContacts, setManualContacts] = useState<ManualContact[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * The open detail panels, oldest first.
   *
   * Was two mutually exclusive slots, so following a link threw away what you
   * were reading — and from the People tab it changed your tab as well. Now a
   * link pushes, and drawer-stack.tsx shows as many trailing panels as fit.
   */
  const [stack, setStack] = useState<StackEntry[]>([]);
  const [booth, setBooth] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  // Which event's floorplan is showing — not always the selected one.
  const [plan, setPlan] = useState<EventRow | null>(null);
  // Lives here, not in PeopleView, so the company drawer can open it too.
  const [importOpen, setImportOpen] = useState(false);
  const [importCompanyId, setImportCompanyId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [editItem, setEditItem] = useState<ScheduleItem | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [captureLead, setCaptureLead] = useState<Lead | null>(null);
  const [capturing, setCapturing] = useState(false);
  /** Timeline per company, loaded when a panel opens rather than up front. */
  const [activity, setActivity] = useState<Record<string, Activity[]>>({});
  const [deals, setDeals] = useState<Record<string, Opportunity[]>>({});
  const [edges, setEdges] = useState<Record<string, DistributionEdge[]>>({});
  const [routes, setRoutes] = useState<Record<string, ReachRoute[]>>({});
  /** Logo per company. `null` = fetched, there isn't one. */
  const [logos, setLogos] = useState<Record<string, CompanyLogo | null>>({});

  // Named individuals across every company, not just this event's — a person
  // does not stop existing because you switched shows.
  const people = useMemo(
    () => buildPeople(allContacts, manualContacts, companyIndex),
    [allContacts, manualContacts, companyIndex],
  );

  /**
   * Scraped and hand-entered contacts as one list, grouped by company.
   *
   * Everything that asks "who do we know here" reads this: the company panel,
   * the board's Contact column, the has-email filter and the CSV. Merging in
   * one place is what stops a person typed into a panel from being missing
   * from the filter and the export beside it.
   *
   * Deliberately **not** narrowed to the selected event's companies. Lookups
   * are by company id, so the extra keys cost nothing, and the panel can open
   * a company that is not on this board — from the schedule, or a link.
   *
   * Memoised on the contacts alone, not on `leads`: an optimistic patch
   * replaces the leads array on every edit, and a fresh `contactsBy` there
   * would re-render every visible row instead of the one that changed.
   */
  const contactsBy = useMemo(() => {
    const by: Record<string, Contact[]> = {};
    for (const c of mergeContacts(allContacts, manualContacts)) {
      (by[c.company_id] ??= []).push(c);
    }
    return by;
  }, [allContacts, manualContacts]);
  const eventCompanyIds = useMemo(
    () => new Set(leads.map((l) => l.company_id)),
    [leads],
  );

  // Derived rather than held: the newest of each kind in the stack. Everything
  // downstream reads these exactly as it did when they were separate state.
  const selected = useMemo<Lead | null>(() => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i];
      if (e.kind === 'company') return e.lead;
    }
    return null;
  }, [stack]);
  const person = useMemo<Person | null>(() => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i];
      if (e.kind === 'person') return e.person;
    }
    return null;
  }, [stack]);

  const switchable = useMemo<EventRow[]>(
    () => [...events].sort((a, b) => (a.kind === 'all' ? 1 : b.kind === 'all' ? -1 : 0)),
    [events],
  );
  const lookups = useMemo(() => ({ categories, statuses }), [categories, statuses]);
  const { filters, patch, toggle, reset } = usePersistedFilters(eventId || null, lookups);
  const visible = useVisibleLeads(leads, contactsBy, filters);

  const event = switchable.find((e) => e.id === eventId) ?? null;
  /** Where and when the selected event is — empty for a list or the roll-up. */
  const where = [event?.city, event?.country, event?.venue,
    event?.starts_on ? `${event.starts_on} → ${event.ends_on}` : null]
    .filter(Boolean).join(' · ');

  /**
   * The open company exists but the filters are hiding its row.
   *
   * Worth calling out explicitly: a company vanishing from the table because
   * of a filter set days ago is indistinguishable from a company that was
   * deleted, and reads as data loss. "Hide settled companies" used to be the
   * usual culprit because it defaulted to on; it no longer does, but a filter
   * left on from a previous session can still do it.
   *
   * Only meaningful for a company on the board in front of you. The schedule
   * can open a company belonging to another event, and "hidden by a filter"
   * would be a plain lie about that one — it is not in these rows at all.
   */
  const selectedHidden = Boolean(
    selected && selected.event_id === eventId
    && !visible.some((l) => l.company_id === selected.company_id),
  );

  /**
   * Each panel resolves its **own** event and contacts from its own entry, not
   * from a single "selected" value: the stack can hold the same company at two
   * events, or two different companies, and one shared value would describe
   * only the newest. Booth, floorplan and scope labelling all follow the
   * lead's event rather than the switcher's for the same reason.
   */

  // Restore the last event once, on mount.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = localStorage.getItem(EVENT_KEY);
    if (saved && events.some((e) => e.id === saved)) setEventId(saved);
  }, [events]);

  useEffect(() => {
    if (eventId) localStorage.setItem(EVENT_KEY, eventId);
  }, [eventId]);

  /**
   * Page through PostgREST until exhausted — forgetting this truncates at 1000.
   *
   * `orderBy` is required, not optional, and must be unique. Postgres gives no
   * row order without an ORDER BY, so successive `.range()` calls can return
   * the same row on two pages and skip another entirely. That surfaced as React
   * complaining about duplicate keys once company_board grew past two pages.
   * A unique sort key makes the window deterministic.
   */
  const fetchAll = useCallback(async <T,>(
    table: string, select: string, orderBy: string, apply?: (q: any) => any,
  ): Promise<T[]> => {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from(table).select(select)
        .order(orderBy, { ascending: true })
        .range(from, from + PAGE - 1);
      if (apply) q = apply(q);
      const { data, error } = await q;
      if (error) throw error;
      out.push(...(data as T[]));
      if (data.length < PAGE) return out;
    }
  }, [supabase]);

  // Contacts belong to a company, not an event, so they are fetched once and
  // reused across switches. Re-fetching all 1387 on every switch cost two
  // extra round trips for data that had not changed.
  const contactsOnce = useRef<Promise<Contact[]> | null>(null);

  /**
   * Every company and alias, so a note naming a company at another event can
   * still resolve to a profile. Two small queries.
   *
   * `company_resolved`, not `companies`: this index decides what a linked
   * mention says, what the people list calls a company and what the connection
   * and deal-partner typeaheads can find. Reading the base table meant a
   * corrected name was right on the board and wrong in all four, for the rest
   * of the session — the same "a resolution view does not retrofit itself"
   * trap the schedule board fell into.
   *
   * And it follows `refreshKey`, because it was fetched exactly once: a
   * company added by hand could not be found in the typeahead that links two
   * companies together, which is a fair description of "it is not there until
   * I reload".
   */
  useEffect(() => {
    (async () => {
      const [companies, aliases] = await Promise.all([
        fetchAll<CompanyRef>('company_resolved', 'id,name', 'id'),
        fetchAll<{ company_id: string; alias: string }>('company_aliases', 'company_id,alias', 'id'),
      ]);
      setCompanyIndex(buildCompanyIndex(companies, aliases));
    })().catch(() => { /* links degrade to plain text */ });
  }, [fetchAll, refreshKey]);

  const loadManual = useCallback(() => {
    fetchAll<ManualContact>('manual_contacts', MANUAL_COLS, 'id')
      .then(setManualContacts)
      .catch((e) => toast.error(`Could not load entered people: ${(e as Error).message}`));
  }, [fetchAll]);

  useEffect(() => { loadManual(); }, [loadManual]);

  /**
   * Who can own a lead. Fetched from `/api/owners` rather than passed down from
   * the server component: `auth.users` needs the service-role key, and putting
   * it on the page's critical path would delay the first paint of the board for
   * a list nothing needs until you open a dropdown.
   *
   * A failure is reported once and then left alone — the pickers fall back to
   * showing whatever is already stored, so an unreachable list degrades to
   * read-only rather than to data loss.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/owners');
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        if (!cancelled) setOwners(body.owners as Owner[]);
      } catch (e) {
        if (!cancelled) toast.error(`Could not load owners: ${(e as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Spans every event on purpose — a follow-up you owe does not stop mattering
  // because you switched shows.
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const loadSchedule = useCallback(() => {
    fetchAll<ScheduleItem>('schedule_board', '*', 'next_action_on')
      .then((rows) => { setSchedule(rows); setScheduleError(null); })
      // Not silent. A failed load used to render as "Nothing scheduled",
      // which is indistinguishable from having nothing scheduled — the same
      // trap as a filter hiding a row and looking like a deletion. This view
      // has been rebuilt three times; a broken one has to say so.
      .catch((e) => setScheduleError((e as Error).message));
  }, [fetchAll]);
  useEffect(() => { loadSchedule(); }, [loadSchedule, refreshKey]);

  /**
   * The industry calendar, loaded here rather than in the schedule page.
   *
   * Same reason as the schedule: this component is in the layout, so a tab
   * click preserves it. Fetching in the page would re-read all 88 rows on
   * every switch.
   *
   * A failure is swallowed to an empty array on purpose — unlike the schedule,
   * this is context. Losing it must not stop you seeing what you owe someone,
   * and it announces itself by simply not being there.
   */
  const [industry, setIndustry] = useState<IndustryEvent[]>([]);
  const loadIndustry = useCallback(() => {
    fetchAll<IndustryEvent>('industry_calendar', '*', 'igc_id')
      .then(setIndustry)
      .catch(() => setIndustry([]));
  }, [fetchAll]);
  useEffect(() => { loadIndustry(); }, [loadIndustry, refreshKey]);

  /**
   * Dismiss or restore one listing, for everyone.
   *
   * An upsert on `industry_event_states`, which is the only table here a
   * signed-in human may write. Optimistic, then reconciled: the row is context
   * and a round trip to grey out a virtual course is a round trip too many.
   */
  const dismissIndustry = useCallback(async (
    e: IndustryEvent, dismissed: boolean,
  ) => {
    setIndustry((prev) => prev.map((x) => (
      x.igc_id === e.igc_id ? { ...x, dismissed } : x)));
    const { error } = await supabase
      .from('industry_event_states')
      .upsert({ igc_id: e.igc_id, dismissed }, { onConflict: 'igc_id' });
    if (error) {
      setIndustry((prev) => prev.map((x) => (
        x.igc_id === e.igc_id ? { ...x, dismissed: e.dismissed } : x)));
      toast.error(`Could not ${dismissed ? 'dismiss' : 'restore'} ${e.name}: ${error.message}`);
      return;
    }
    toast.success(dismissed
      ? `${e.name} dismissed`
      : `${e.name} back on the calendar`);
  }, [supabase]);

  /**
   * Switching events is picking a different subject, so the trail goes.
   *
   * Its own effect, because the load below also runs on `refreshKey` — and a
   * refetch is not a change of subject. Clearing there meant every refresh
   * closed whatever you had open: correcting a company or adding a connection
   * shut the panel you were working in.
   */
  useEffect(() => { setStack([]); }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        contactsOnce.current ??= fetchAll<Contact>('contacts', CONTACT_COLS, 'id');
        // company_board is event-independent and has no lead_states columns, so
        // the event-scoped fields come back null and the UI disables them.
        const [rows, contacts] = await Promise.all([
          fetchAll<Lead>('lead_board', '*', 'company_id', (q) => q.eq('event_id', eventId)),
          contactsOnce.current,
        ]);
        if (cancelled) return;
        setLeads(rows);
        /**
         * The open panels hold their own copy of a lead, so a refetch that
         * only replaced `leads` left them rendering what was true before the
         * write. Re-derive them from the rows that just landed instead.
         *
         * An entry with no matching row is kept, not dropped: a panel opened
         * from the schedule can belong to another event entirely, and those
         * rows are fetched one at a time and are not in this board.
         */
        setStack((prev) => prev.map((e) => {
          if (e.kind !== 'company') return e;
          const fresh = rows.find((l) => l.company_id === e.lead.company_id
            && l.event_id === e.lead.event_id);
          return fresh ? { ...e, lead: fresh } : e;
        }));
        setAllContacts(contacts);
      } catch (e) {
        contactsOnce.current = null;   // let a failed fetch be retried
        if (!cancelled) toast.error(`Could not load leads: ${(e as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [eventId, fetchAll, refreshKey]);

  const loadActivity = useCallback(async (companyId: string) => {
    const { data, error } = await supabase.from('activity_feed').select('*')
      .eq('company_id', companyId).order('occurred_at', { ascending: false });
    if (error) return;   // the timeline degrades to "nothing recorded yet"
    setActivity((prev) => ({ ...prev, [companyId]: (data ?? []) as Activity[] }));
  }, [supabase]);

  /**
   * Deals and distribution edges for one company.
   *
   * Loaded with the panel rather than the board: 2,351 companies of deals and
   * edges is a lot of rows nobody has asked to see, and the panel is the only
   * place either is shown.
   */
  /**
   * One request per company at a time, unless a write asks for a fresh one.
   *
   * The panel asks for activity, commerce and its logo from a single effect
   * whose dependencies are "is this still undefined" booleans, so the effect
   * re-runs as each of the three lands while the others are still in flight,
   * and asks again for what has not arrived yet. Measured: four identical
   * `distribution_edges` queries for one panel open.
   *
   * `force` matters. A refresh issued *after* a write must not be answered by
   * a request that went out before it — that would put pre-write data on
   * screen and look exactly like the bug this is next to.
   */
  const commerceInFlight = useRef(new Set<string>());

  const loadCommerce = useCallback(async (companyId: string, force = false) => {
    if (!force && commerceInFlight.current.has(companyId)) return;
    commerceInFlight.current.add(companyId);
    try {
      const [o, e, r] = await Promise.all([
        supabase.from('opportunity_board').select('*')
          .eq('company_id', companyId).order('created_at', { ascending: false }),
        // Both directions in one query: this company as the aggregator or as the
        // operator. `or` rather than two round trips.
        supabase.from('distribution_edges').select('*')
          .or(`upstream_id.eq.${companyId},downstream_id.eq.${companyId}`),
        // What our content earns through this company. Computed by the database,
        // which is the only place that can walk the chain.
        supabase.from('distribution_reach').select('*').eq('via_id', companyId),
      ]);
      if (!o.error) setDeals((p) => ({ ...p, [companyId]: (o.data ?? []) as Opportunity[] }));
      if (!e.error) setEdges((p) => ({ ...p, [companyId]: (e.data ?? []) as DistributionEdge[] }));
      if (!r.error) setRoutes((p) => ({ ...p, [companyId]: (r.data ?? []) as ReachRoute[] }));
    } finally {
      commerceInFlight.current.delete(companyId);
    }
  }, [supabase]);

  /**
   * The company's own logo, fetched when its panel opens.
   *
   * Its own query rather than a column on `lead_board`: the board pulls 1,400
   * rows at a time and shows no logos, so a few KB of image per row would put
   * ~10MB on the wire for nothing. `null` is recorded when a company has none,
   * or every open of that company would ask the database again.
   */
  const loadLogo = useCallback(async (companyId: string) => {
    // `company_logo_resolved`, never `company_logos`: a logo set by hand lives
    // on `company_overrides` and the view is the one place that decides which
    // of the two wins. Reading the base table here is exactly how the schedule
    // board ended up showing scraped names for corrected companies.
    const { data } = await supabase.from('company_logo_resolved')
      .select('data_uri,ink').eq('company_id', companyId).maybeSingle();
    setLogos((p) => ({
      ...p,
      // Unmeasured ink is treated as dark, matching the column's comment: a
      // black mark on a white tile is the common case and the safe default.
      [companyId]: data
        ? { uri: data.data_uri as string, ink: (data.ink as 'light' | 'dark') ?? 'dark' }
        : null,
    }));
  }, [supabase]);

  const createDeal = useCallback(async (companyId: string, draft: Partial<Opportunity>) => {
    const { error } = await supabase.from('opportunities')
      .insert({ ...draft, company_id: companyId });
    if (error) return toast.error(`Could not add the deal: ${error.message}`);
    loadCommerce(companyId, true);
    toast.success('Deal added');
  }, [supabase, loadCommerce]);

  const patchDeal = useCallback(async (
    companyId: string, id: string, patch: Partial<Opportunity>,
  ) => {
    // Optimistic: a stage chip that waits on the network feels broken.
    setDeals((p) => ({
      ...p,
      [companyId]: (p[companyId] ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
    const { error } = await supabase.from('opportunities').update(patch).eq('id', id);
    if (error) { toast.error(`Could not save: ${error.message}`); loadCommerce(companyId, true); }
    // `via_company_name` is the board view's join, not a column we can patch,
    // so an optimistic merge would leave the old partner's name rendered
    // against the new id — a link that reads as one company and opens another.
    else if ('via_company_id' in patch) loadCommerce(companyId, true);
  }, [supabase, loadCommerce]);

  const deleteDeal = useCallback(async (companyId: string, deal: Opportunity) => {
    if (!window.confirm(`Delete "${deal.title || 'this deal'}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('opportunities').delete().eq('id', deal.id);
    if (error) return toast.error(`Could not delete: ${error.message}`);
    loadCommerce(companyId, true);
  }, [supabase, loadCommerce]);

  /**
   * An edge is a fact about **two** companies, and about everything downstream
   * of them.
   *
   * `loadCommerce(forCompany)` refreshes only the panel you added it from, so
   * the other end kept whatever it was holding — and since a panel only
   * fetches when its cache is `undefined`, opening that company again issued
   * no query at all and showed the old picture until a page reload. Measured:
   * re-opening an already-opened company fired zero requests.
   *
   * So the whole cache goes, exactly as it does for a relationship change
   * above. `distribution_reach` walks the chain, so a new edge can also change
   * what a company three hops away earns; there is no useful smaller set to
   * invalidate. `in_reach` is a `lead_board` column, so the board is refetched
   * too — that is the mark on the row that says a company is reachable.
   */
  const forgetCommerce = useCallback(() => {
    setEdges({});
    setRoutes({});
  }, []);

  const addEdge = useCallback(async (
    forCompany: string, upstreamId: string, downstreamId: string,
    basis?: DistributionEdge['rate_basis'],
  ) => {
    // Omitting the basis lets the trigger default it from the downstream's
    // category, which the client cannot see.
    const { error } = await supabase.from('distribution').insert({
      upstream_id: upstreamId,
      downstream_id: downstreamId,
      ...(basis ? { rate_basis: basis } : {}),
    });
    if (error) {
      return toast.error(/duplicate/i.test(error.message)
        ? 'That link already exists.' : `Could not link them: ${error.message}`);
    }
    forgetCommerce();
    loadCommerce(forCompany, true);
    setRefreshKey((k) => k + 1);
  }, [supabase, loadCommerce, forgetCommerce]);

  const removeEdge = useCallback(async (forCompany: string, e: DistributionEdge) => {
    const { error } = await supabase.from('distribution').delete()
      .eq('upstream_id', e.upstream_id).eq('downstream_id', e.downstream_id);
    if (error) return toast.error(`Could not remove it: ${error.message}`);
    forgetCommerce();
    loadCommerce(forCompany, true);
    setRefreshKey((k) => k + 1);
  }, [supabase, loadCommerce, forgetCommerce]);

  /** The rate an aggregator charges, and whether it terminates or chains. */
  const rateEdge = useCallback(async (
    forCompany: string, e: DistributionEdge,
    patch: {
      rate_pct?: number | null;
      rate_basis?: DistributionEdge['rate_basis'];
      confidence?: DistributionEdge['confidence'];
    },
  ) => {
    const { error } = await supabase.from('distribution').update(patch)
      .eq('upstream_id', e.upstream_id).eq('downstream_id', e.downstream_id);
    if (error) return toast.error(`Could not save the rate: ${error.message}`);
    // Same reach for the same reason: `rate_basis` decides whether the chain
    // terminates here or carries on, and `rate_pct` multiplies down it, so a
    // rate typed on one edge changes what other companies' panels should say.
    // The board is left alone — a rate moves the money, not the reachability.
    forgetCommerce();
    loadCommerce(forCompany, true);
  }, [supabase, loadCommerce, forgetCommerce]);

  /**
   * Keep an open panel in step with an optimistic write.
   *
   * Patches every matching entry, not just the newest: the same company can be
   * open twice in the stack at two different events, and only the one that was
   * edited should change.
   */
  const patchStackLead = useCallback((
    companyId: string, eventId_: string, patch: Partial<Lead>,
  ) => {
    setStack((prev) => prev.map((e) => (
      e.kind === 'company'
        && e.lead.company_id === companyId && e.lead.event_id === eventId_
        ? { ...e, lead: { ...e.lead, ...patch } } : e)));
  }, []);

  /**
   * Optimistic write. `lead_states` is keyed per (event, company) and
   * `company_states` per company — the split that keeps a re-crawl from ever
   * overwriting what someone typed.
   *
   * Keyed on `lead.event_id`, not on the selected event. They agree for a row
   * on the board, but the schedule can open a company at a different event, and
   * writing that edit against whatever the switcher happens to show would file
   * it under the wrong show.
   */
  const onPatch = useCallback(async (
    lead: Lead, p: Partial<Lead>, scope: 'event' | 'company',
  ) => {
    const merged = { ...lead, ...p };
    const targetEvent = lead.event_id || eventId;
    // Match on the event too: a company can be on several, and an edit made at
    // one must not appear against another's row.
    setLeads((prev) => prev.map((l) => (
      l.company_id === lead.company_id && l.event_id === targetEvent ? merged : l)));
    patchStackLead(lead.company_id, targetEvent, p);

    const { error } = scope === 'event'
      ? await supabase.from('lead_states').upsert({
          event_id: targetEvent,
          company_id: lead.company_id,
          status_id: merged.event_status_id,
          owner: merged.owner,
          starred: merged.starred ?? false,
          notes: merged.notes,
          contacted_on: merged.contacted_on,
          replied_on: merged.replied_on,
          next_action: merged.next_action,
          next_action_on: merged.next_action_on,
        }, { onConflict: 'event_id,company_id' })
      : await supabase.from('company_states').upsert({
          company_id: lead.company_id,
          status_id: merged.company_status_id,
          priority: merged.priority,
          note: merged.company_note,
        }, { onConflict: 'company_id' });

    /**
     * A relationship change invalidates every distribution insight.
     *
     * "Reachable now through Hub88" depends on Hub88's *own* relationship, so
     * making Hub88 a partner changes what every operator it carries should
     * say. The edges are cached per opened panel, so without this the insight
     * kept reading "none of which we work with yet" until a page reload — it
     * was right in the database and stale on screen, which is the worst of
     * the two.
     */
    if (!error && scope === 'company' && p.company_status_id !== undefined) {
      setEdges({});
      setRoutes({});
    }
    if (!error && scope === 'event') {
      loadSchedule();
      // A status change writes a `stage` row by trigger, so the timeline is
      // stale the moment it happens. Only on a status change: every keystroke
      // committing an owner or a note would otherwise refetch it.
      if (p.event_status_id !== undefined && p.event_status_id !== lead.event_status_id) {
        loadActivity(lead.company_id);
      }
    }

    if (error) {
      toast.error(`Save failed: ${error.message}`);
      setLeads((prev) => prev.map((l) => (
        l.company_id === lead.company_id && l.event_id === targetEvent ? lead : l)));
      patchStackLead(lead.company_id, targetEvent, lead);
    }
  }, [supabase, eventId, loadSchedule, patchStackLead, loadActivity]);

  /**
   * Save one scheduled follow-up.
   *
   * An UPDATE, not an upsert. `schedule_board` does not carry every
   * `lead_states` column — `starred` is absent — so upserting the editor's
   * shape would null it. The row is guaranteed to exist, because the view only
   * lists rows that already have a due date.
   *
   * The patch is partial: only the keys present are written. That is what lets
   * a drag move a date without restating the other six fields, which would
   * otherwise mean two callers holding the same list of columns in step.
   */
  const saveSchedule = useCallback(async (
    item: ScheduleItem, p: Partial<SchedulePatch>,
  ): Promise<boolean> => {
    const trim = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
    const body: Record<string, unknown> = {};
    // `in`, not a truthiness test: null is a meaningful value here — it is how
    // a date is cleared — so an absent key and an explicit null differ.
    if ('status_id' in p) body.status_id = p.status_id;
    if ('owner' in p) body.owner = trim(p.owner);
    if ('contacted_on' in p) body.contacted_on = p.contacted_on;
    if ('replied_on' in p) body.replied_on = p.replied_on;
    if ('next_action' in p) body.next_action = trim(p.next_action);
    if ('next_action_on' in p) body.next_action_on = p.next_action_on;
    if ('notes' in p) body.notes = trim(p.notes);
    if (!Object.keys(body).length) return true;

    const status = 'status_id' in p
      ? statuses.find((s) => s.id === p.status_id) : undefined;

    /**
     * Move it locally first, then reconcile.
     *
     * A drag has to land where it was dropped. Waiting on the round trip means
     * the chip springs back to the old day for a few hundred milliseconds and
     * then jumps, which reads as the drop having failed. `loadSchedule()` below
     * is still the source of truth, and on error it puts everything back.
     */
    const sched: Partial<ScheduleItem> = {};
    if ('owner' in body) sched.owner = body.owner as string | null;
    if ('contacted_on' in body) sched.contacted_on = body.contacted_on as string | null;
    if ('replied_on' in body) sched.replied_on = body.replied_on as string | null;
    if ('next_action' in body) sched.next_action = body.next_action as string | null;
    if ('notes' in body) sched.notes = body.notes as string | null;
    if ('next_action_on' in body) sched.next_action_on = body.next_action_on as string;
    if (status !== undefined || 'status_id' in body) {
      sched.event_status_id = (body.status_id ?? null) as string | null;
      sched.event_status = status?.key ?? null;
      sched.event_status_label = status?.label ?? null;
      sched.status_color = status?.color ?? null;
    }
    const mine = (s: ScheduleItem) =>
      s.company_id === item.company_id && s.event_id === item.event_id;
    setSchedule((prev) => prev
      .map((s) => (mine(s) ? { ...s, ...sched } : s))
      // A cleared date is what takes an item off the board.
      .filter((s) => s.next_action_on));

    const { error } = await supabase.from('lead_states').update(body)
      .eq('event_id', item.event_id).eq('company_id', item.company_id);

    if (error) {
      toast.error(`Could not save: ${error.message}`);
      loadSchedule();          // undo the optimistic move
      return false;
    }

    // Keep the board and any open drawer in step, but only the row for the
    // event this follow-up belongs to.
    const patch: Partial<Lead> = {};
    if ('owner' in body) patch.owner = body.owner as string | null;
    if ('contacted_on' in body) patch.contacted_on = body.contacted_on as string | null;
    if ('replied_on' in body) patch.replied_on = body.replied_on as string | null;
    if ('next_action' in body) patch.next_action = body.next_action as string | null;
    if ('next_action_on' in body) patch.next_action_on = body.next_action_on as string | null;
    if ('notes' in body) patch.notes = body.notes as string | null;
    if ('status_id' in body) {
      patch.event_status_id = (body.status_id ?? null) as string | null;
      patch.event_status = status?.key ?? null;
    }
    setLeads((prev) => prev.map((l) => (
      l.company_id === item.company_id && l.event_id === item.event_id
        ? { ...l, ...patch } : l)));
    patchStackLead(item.company_id, item.event_id, patch);

    loadSchedule();
    if ('next_action_on' in body) {
      toast.success(body.next_action_on
        ? `${item.company_name} — due ${body.next_action_on}`
        : `${item.company_name} taken off the schedule`);
    } else {
      toast.success(`Saved ${item.company_name}`);
    }
    return true;
  }, [supabase, statuses, loadSchedule, patchStackLead]);

  /**
   * One act, three writes.
   *
   * A stand visit is an activity *and* a pipeline move *and* sometimes a new
   * person, and asking someone at a booth to do those separately means two of
   * the three never happen. The activity is written first: if the pipeline
   * update fails, the record of the conversation still exists, which is the
   * part that cannot be reconstructed later.
   */
  const saveCapture = useCallback(async (
    lead: Lead,
    draft: ActivityDraft,
    pipeline: { status_id: string | null; next_action: string | null; next_action_on: string | null },
    alsoAddPerson: boolean,
  ): Promise<boolean> => {
    setCapturing(true);
    try {
      const { error } = await supabase.from('lead_activity').insert({
        company_id: lead.company_id,
        // Null for the catch-all list: "met them at All companies (ongoing)"
        // is not a thing that happened anywhere.
        event_id: event?.kind === 'all' ? null : lead.event_id,
        kind: draft.kind,
        body: draft.body,
        met_name: draft.met_name,
        met_role: draft.met_role,
      });
      if (error) throw error;

      const status = statuses.find((s) => s.id === pipeline.status_id);
      // `contacted_on` moves for anything that was actually an exchange. A
      // note to self is not contact.
      const contacted = draft.kind === 'note'
        ? lead.contacted_on
        : lead.contacted_on ?? todayLocal();
      await onPatch(lead, {
        event_status_id: pipeline.status_id,
        event_status: status?.key ?? null,
        contacted_on: contacted,
        next_action: pipeline.next_action,
        next_action_on: pipeline.next_action_on,
      }, 'event');

      if (alsoAddPerson && draft.met_name) {
        const { error: pe } = await supabase.from('manual_contacts').insert({
          company_id: lead.company_id,
          full_name: draft.met_name,
          job_title: draft.met_role,
          note: `Met at ${event?.name ?? 'an event'}`,
          source: 'manual',
          is_personal_data: true,
        });
        // Not fatal: the conversation is recorded either way, and a duplicate
        // name is the likeliest cause.
        if (pe) toast.error(`Logged, but could not add the person: ${pe.message}`);
        // Otherwise they are in the database and missing from the panel that
        // lists contacts, until a reload nobody thinks to do.
        else loadManual();
      }

      loadActivity(lead.company_id);
      toast.success(`Logged — ${lead.name}${pipeline.next_action_on ? `, follow up ${pipeline.next_action_on}` : ''}`);
      return true;
    } catch (e) {
      toast.error(`Could not log that: ${(e as Error).message}`);
      return false;
    } finally {
      setCapturing(false);
    }
  }, [supabase, event, statuses, onPatch, loadActivity, loadManual]);

  /**
   * One contact, typed into a company panel.
   *
   * `manual_contacts`, not `lead_states`: this is who the person is, which does
   * not change per show, and it is the table the people directory, the Contact
   * column, the CSV and erasure all already read. The pair of free-text boxes
   * this replaced wrote to none of them.
   *
   * Not optimistic. It is one deliberate save with a button, not a field that
   * commits on blur, and two of the ways it can fail are worth reading rather
   * than rolling back silently: a name already held at this company, and an
   * address someone has asked to be erased.
   */
  const addContact = useCallback(async (
    companyId: string, draft: ContactDraft,
  ): Promise<boolean> => {
    const clean = (v: string) => (v.trim() || null);
    const name = draft.full_name.trim();
    if (!name) return false;

    const { data, error } = await supabase.from('manual_contacts')
      .insert({
        company_id: companyId,
        full_name: name,
        job_title: clean(draft.job_title),
        email: clean(draft.email),
        phone: clean(draft.phone),
        linkedin_url: clean(draft.linkedin_url),
        source: 'manual',
      })
      .select(MANUAL_COLS)
      .maybeSingle();

    if (error) {
      toast.error(error.code === '23505'
        ? `${name} is already listed at this company.`
        : `Could not add ${name}: ${error.message}`);
      return false;
    }
    // The insert was accepted and no row came back, which is the erasure
    // trigger skipping it. Saying "saved" here would be a lie the next reload
    // exposes, and the honest answer is one someone needs to hear.
    if (!data) {
      toast.error(`${draft.email.trim()} was erased at that person's request — it cannot be added again.`);
      return false;
    }

    setManualContacts((prev) => [...prev, data as ManualContact]);
    toast.success(`Added ${name}`);
    return true;
  }, [supabase]);

  const deleteActivity = useCallback(async (a: Activity) => {
    if (!window.confirm('Remove this history entry? It cannot be recovered.')) return;
    const { error } = await supabase.from('lead_activity').delete().eq('id', a.id);
    if (error) return toast.error(`Could not remove it: ${error.message}`);
    setActivity((prev) => ({
      ...prev,
      [a.company_id]: (prev[a.company_id] ?? []).filter((x) => x.id !== a.id),
    }));
    toast.success('Entry removed');
  }, [supabase]);

  /** Dropping a follow-up on a calendar day changes only its due date. */
  const rescheduleItem = useCallback(
    (item: ScheduleItem, date: string) => saveSchedule(item, { next_action_on: date }),
    [saveSchedule],
  );

  /**
   * Reflect the **top** of the stack in the URL, so a link reopens what the
   * sender was actually looking at. Only one key is ever set: `company` and
   * `person` together would be ambiguous about which was in front.
   */
  const setDeepLink = useCallback((key: 'company' | 'person', id: string | null) => {
    const q = new URLSearchParams(Array.from(params.entries()));
    q.delete('company');
    q.delete('person');
    if (id) q.set(key, id);
    const qs = q.toString();
    // The current path, not `/`: the open panel is an overlay on whichever
    // view you are in, and rewriting the path here would silently move you to
    // a different tab every time a panel opened or closed.
    router.replace((qs ? `${pathname}?${qs}` : pathname) as never, { scroll: false });
  }, [params, router, pathname]);

  const linkFor = useCallback((entry: StackEntry | null) => {
    if (!entry) return setDeepLink('company', null);
    return entry.kind === 'company'
      ? setDeepLink('company', entry.lead.company_id)
      : setDeepLink('person', entry.person.id);
  }, [setDeepLink]);

  /**
   * Two verbs, and the difference is deliberate.
   *
   * `openRoot` is picking a new subject — a row on the board, a person in the
   * list — so it resets the stack. `openFrom` is following a link *out of* a
   * panel, so it pushes and the trail is kept. Conflating them either loses
   * your place or grows a stack every time you click a table row.
   */
  const openRoot = useCallback((entry: StackEntry) => {
    setStack([entry]);
    linkFor(entry);
  }, [linkFor]);

  const openFrom = useCallback((entry: StackEntry) => {
    setStack((prev) => {
      const next = pushEntry(prev, entry);
      return next;
    });
    linkFor(entry);
  }, [linkFor]);

  /** Same entity, different event — replace rather than stack a duplicate. */
  const replaceTop = useCallback((entry: StackEntry) => {
    setStack((prev) => (prev.length ? [...prev.slice(0, -1), entry] : [entry]));
    linkFor(entry);
  }, [linkFor]);

  const closeStack = useCallback(() => { setStack([]); linkFor(null); }, [linkFor]);

  const popStack = useCallback(() => setStack((prev) => {
    const next = prev.slice(0, -1);
    linkFor(next[next.length - 1] ?? null);
    return next;
  }), [linkFor]);

  /** Close this panel and everything opened from it. */
  const truncateStack = useCallback((index: number) => setStack((prev) => {
    const next = prev.slice(0, index);
    linkFor(next[next.length - 1] ?? null);
    return next;
  }), [linkFor]);

  const selectLead = useCallback(
    (lead: Lead) => openRoot({ kind: 'company', lead }), [openRoot]);
  const selectPerson = useCallback(
    (p: Person) => openRoot({ kind: 'person', person: p }), [openRoot]);

  /**
   * A contact clicked inside a company panel.
   *
   * `openFrom`, not `openRoot`: this is following a link out of a panel, so
   * the company you were reading stays behind it. The people list uses
   * `selectPerson` for the same destination, because a row in a list is
   * picking a new subject.
   *
   * The `Person` shape is `Contact` plus the company's name and an origin —
   * which is what `buildPeople` adds, and it is cheaper to add it here than to
   * search 1,387 built people for this one. `ContactRow` only offers this for
   * a contact that has a name, so the cast is sound rather than hopeful: a row
   * without one is an address, and `lib/people.ts` is the place that decides
   * that.
   */
  const openContact = useCallback((c: Contact) => {
    if (!c.full_name) return;
    openFrom({
      kind: 'person',
      person: {
        ...c,
        full_name: c.full_name,
        company_name: companyIndex.byId.get(c.company_id)?.name ?? 'Unknown company',
        origin: c.origin ?? 'scraped',
      },
    });
  }, [openFrom, companyIndex]);

  /**
   * Open a company by id from anywhere — a note mention, or a link someone
   * pasted. If it is not exhibiting at the current event, find one where it is
   * and switch there first.
   */
  /**
   * Fetch one company's row at one event, without touching the board.
   *
   * Everything that opens a company goes through this. It never changes the tab
   * or the selected event: a link is a request to *see* something, not to be
   * moved somewhere else. That was the old behaviour and it cost you both your
   * tab and your place on the board.
   */
  const leadAt = useCallback(async (
    targetEventId: string, companyId: string,
  ): Promise<Lead | null> => {
    const here = leads.find((l) => (
      l.company_id === companyId && l.event_id === targetEventId));
    if (here) return here;

    const { data, error } = await supabase.from('lead_board').select('*')
      .eq('event_id', targetEventId).eq('company_id', companyId).maybeSingle();
    if (error || !data) {
      toast.error(error?.message ?? 'Could not load that company.');
      return null;
    }
    return data as Lead;
  }, [leads, supabase]);

  /**
   * Open a company on the stack, at a known event.
   *
   * `how` is which of the two verbs applies, and the caller's *surface* decides
   * it, not the entity: a link inside a panel pushes, a name in a list row
   * resets. Defaulting to `push` keeps the panel case, which is most of them.
   */
  const openCompanyDetails = useCallback(async (
    targetEventId: string, companyId: string, how: 'push' | 'root' = 'push',
  ) => {
    const lead = await leadAt(targetEventId, companyId);
    if (lead) (how === 'root' ? openRoot : openFrom)({ kind: 'company', lead });
  }, [leadAt, openFrom, openRoot]);

  /**
   * "Also appears at": the same company, a different event.
   *
   * Replaces the top entry rather than pushing. It is one company either way,
   * so stacking it on itself would put two panels with the same name side by
   * side, which reads as a rendering fault rather than as history.
   */
  const openCompanyAt = useCallback(async (targetEventId: string, companyId: string) => {
    const lead = await leadAt(targetEventId, companyId);
    if (lead) replaceTop({ kind: 'company', lead });
  }, [leadAt, replaceTop]);

  /**
   * Open a company by id alone — from a note mention, or a person's profile.
   *
   * Prefers the event on screen, so the panel shows the pipeline fields for the
   * context you are working in, and otherwise takes any event the company
   * belongs to. Every company is on the "All companies" list, so there is
   * always at least one.
   */
  const openCompany = useCallback(async (
    companyId: string, how: 'push' | 'root' = 'push',
  ) => {
    const here = leads.find((l) => l.company_id === companyId);
    if (here) return (how === 'root' ? openRoot : openFrom)({ kind: 'company', lead: here });

    const { data, error } = await supabase
      .from('event_entries')
      .select('event_id')
      .eq('company_id', companyId)
      .limit(1);

    if (error || !data?.length) {
      toast.error('That company is not on any list.');
      return;
    }
    await openCompanyDetails(data[0].event_id as string, companyId, how);
  }, [leads, openFrom, openRoot, supabase, openCompanyDetails]);

  /**
   * The Company column in the people list. A row in a list is picking a
   * subject, so it resets the stack — the same verb its own person row uses.
   * Its own `useCallback`, because the rows are memoised and an inline arrow
   * would give all sixty a new prop on every render.
   */
  const openCompanyFromList = useCallback(
    (companyId: string) => { void openCompany(companyId, 'root'); }, [openCompany]);

  // A company opened from another event cannot be selected until its rows land.
  /**
   * `?company=<id>`, and the row a just-created or just-corrected company
   * needs opened once its rows land.
   *
   * Consumed once each. The URL keeps carrying the id after the panel is
   * closed, so without a guard the effect would reopen it on the next render.
   */
  const pendingCompany = useRef<string | null>(null);
  const consumedCompany = useRef<string | null>(null);
  useEffect(() => {
    const want = pendingCompany.current ?? deepLinkCompany;
    if (!want || loading || !leads.length) return;
    if (!pendingCompany.current && consumedCompany.current === want) return;
    const hit = leads.find((l) => l.company_id === want);
    if (!hit) return;
    pendingCompany.current = null;
    consumedCompany.current = want;
    /**
     * Matched on company, **not** on the event-qualified key.
     *
     * This effect only exists to seed the stack from a URL. If the company is
     * already open it must leave it alone — at whatever event it was opened
     * at. Comparing `entryKey` here meant a panel deliberately opened at
     * another event did not match, so this replaced it with the current
     * event's row: opening a follow-up from the schedule showed the wrong
     * event's pipeline.
     *
     * It passed testing once because the selected event was a list Hub88 is
     * not on, so `hit` was undefined and this never ran. On "All companies",
     * which holds every company and is the usual selection, it always ran.
     */
    setStack((prev) => (prev.some((e) => e.kind === 'company' && e.lead.company_id === want)
      ? prev : [{ kind: 'company', lead: hit }]));
  }, [leads, loading, deepLinkCompany]);

  // ?person=<id>. Also consumed once, for the same reason.
  const consumedPerson = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkPerson || consumedPerson.current === deepLinkPerson) return;
    const hit = people.find((p) => p.id === deepLinkPerson);
    if (!hit) return;
    consumedPerson.current = deepLinkPerson;
    /**
     * Leave the stack alone if that person is already on it — the same guard
     * the company effect above carries, and for a sharper reason.
     *
     * Opening a contact from a company panel *pushes* the person, and pushing
     * writes `?person=…` to keep the panel linkable. That lands right here, so
     * an unconditional `setStack([person])` threw away the company you opened
     * them from — a push that reset the stack one tick later, which reads as
     * the company panel closing itself.
     *
     * A cold load still works: nothing is on the stack, so the guard is false
     * and the person opens alone.
     */
    setStack((prev) => (prev.some((e) => e.kind === 'person' && e.person.id === deepLinkPerson)
      ? prev : [{ kind: 'person', person: hit }]));
  }, [people, deepLinkPerson]);

  const togglePick = useCallback((id: string) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);

  const toggleAll = useCallback(() => setPicked((p) => (
    visible.every((l) => p.has(l.company_id)) && p.size > 0
      ? new Set<string>()
      : new Set(visible.map((l) => l.company_id))
  )), [visible]);

  // Selection is per-event: switching context makes it meaningless, and acting
  // on rows you can no longer see is the kind of thing you only notice after.
  useEffect(() => { setPicked(new Set()); }, [eventId]);

  /**
   * Apply one patch to every selected row.
   *
   * Upserts in chunks rather than one request per row — 200 rows would
   * otherwise be 200 round trips. Local state updates only after the write
   * succeeds, because a bulk change that silently half-applied is worse than
   * one that visibly failed.
   */
  const applyBulk = useCallback(async (patch: BulkPatch) => {
    const ids = [...picked];
    if (!ids.length) return;
    setBulkBusy(true);
    const CHUNK = 200;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        if (patch.event) {
          const rows = slice.map((company_id) => {
            const cur = leads.find((l) => l.company_id === company_id);
            return {
              event_id: eventId, company_id,
              status_id: patch.event!.event_status_id ?? cur?.event_status_id ?? null,
              owner: patch.event!.owner ?? cur?.owner ?? null,
              starred: cur?.starred ?? false,
              notes: cur?.notes ?? null,
              contacted_on: patch.event!.contacted_on ?? cur?.contacted_on ?? null,
              next_action: patch.event!.next_action !== undefined
                ? patch.event!.next_action : cur?.next_action ?? null,
              next_action_on: patch.event!.next_action_on ?? cur?.next_action_on ?? null,
            };
          });
          const { error } = await supabase.from('lead_states')
            .upsert(rows, { onConflict: 'event_id,company_id' });
          if (error) throw error;
        }
        if (patch.company) {
          const rows = slice.map((company_id) => {
            const cur = leads.find((l) => l.company_id === company_id);
            return {
              company_id,
              status_id: patch.company!.company_status_id ?? cur?.company_status_id ?? null,
              priority: patch.company!.priority ?? cur?.priority ?? null,
              note: cur?.company_note ?? null,
            };
          });
          const { error } = await supabase.from('company_states')
            .upsert(rows, { onConflict: 'company_id' });
          if (error) throw error;
        }
      }
      const set = new Set(ids);
      setLeads((prev) => prev.map((l) => (set.has(l.company_id)
        ? { ...l, ...patch.event, ...patch.company } : l)));
      toast.success(`Updated ${ids.length} ${ids.length === 1 ? 'company' : 'companies'}`);
      loadSchedule();
    } catch (e) {
      toast.error(`Bulk update failed: ${(e as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  }, [picked, leads, eventId, supabase, loadSchedule]);

  const openImport = useCallback((companyId: string | null) => {
    setImportCompanyId(companyId);
    setImportOpen(true);
  }, []);

  /**
   * GDPR erasure. A real delete, and one a re-crawl cannot undo.
   *
   * With an address it goes through `erase_contact`, which removes every row
   * holding it across both contact tables and tombstones a hash so ingestion
   * skips it next time. Without one there is nothing to tombstone, so it falls
   * back to deleting the row and says as much in the confirmation.
   */
  const deletePerson = useCallback(async (p: Person) => {
    if (p.email) {
      const { data, error } = await supabase.rpc('erase_contact', {
        addr: p.email, why: 'Erased from the people directory',
      });
      if (error) return toast.error(`Erase failed: ${error.message}`);
      setAllContacts((prev) => prev.filter((c) => (
        c.email?.trim().toLowerCase() !== p.email!.trim().toLowerCase())));
      setManualContacts((prev) => prev.filter((m) => (
        m.email?.trim().toLowerCase() !== p.email!.trim().toLowerCase())));
      toast.success(`Erased ${p.full_name} — ${data ?? 0} record(s) removed`);
    } else {
      const table = p.origin === 'entered' ? 'manual_contacts' : 'contacts';
      const { error } = await supabase.from(table).delete().eq('id', p.id);
      if (error) return toast.error(`Delete failed: ${error.message}`);
      setAllContacts((prev) => prev.filter((c) => c.id !== p.id));
      setManualContacts((prev) => prev.filter((m) => m.id !== p.id));
      toast.success(`Deleted ${p.full_name}`);
    }
    // Drop the deleted person from the trail, and anything opened from it —
    // those panels were reached through a record that no longer exists.
    setStack((prev) => {
      const at = prev.findIndex((e) => e.kind === 'person' && e.person.id === p.id);
      const next = at >= 0 ? prev.slice(0, at) : prev;
      linkFor(next[next.length - 1] ?? null);
      return next;
    });
  }, [supabase, linkFor]);

  /**
   * `at` defaults to the event on screen, which is right for a table row. The
   * drawer passes the lead's own event, because a company opened from the
   * schedule can belong to a different show — and opening the wrong show's
   * floorplan to look for a booth number is worse than not opening one.
   */
  const onBooth = useCallback((b: string, at: EventRow | null = event) => {
    navigator.clipboard?.writeText(b).catch(() => {});
    if (!at?.floorplan_url) {
      toast.info(`Booth ${b} copied — ${at?.name ?? 'this event'} has no published floorplan yet`);
      return;
    }
    setBooth(b);
    setPlan(at);
    setPlanOpen(true);
    toast.success(`Booth ${b} copied — paste into the plan's search box`);
  }, [event]);

  const onSort = useCallback((k: SortKey) => {
    patch(k === filters.sortKey
      ? { sortDir: (filters.sortDir * -1) as 1 | -1 }
      : { sortKey: k, sortDir: 1 });
  }, [patch, filters.sortKey, filters.sortDir]);

  return (
    <div className="flex h-dvh flex-col">
      {/*
        The header is what is true on every tab: where you are, where you can
        go, and who you are. Nothing that filters the companies board.

        It used to carry the event switcher, the ten-tile stats bar, Add
        company and Export CSV — and the first two only ever applied to one of
        the three views, because `schedule_board` is fetched across every event
        on purpose and the people directory is built from all contacts. A
        control that does nothing on the tab you are looking at is worse than
        one you have to go and find.

        The switcher is in the filter rail now, the stats bar is gone (the
        rail's pipeline chips carry the same counts and the same toggles), and
        Add company sits on the board's own bar. What is left needs no
        breakpoints: at phone width this was 567px tall on an 844px screen.
      */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-2 py-1.5 sm:gap-3 sm:px-3.5 sm:py-2">
        {/* The mark carries no breakpoint, the wordmark keeps the one it had.
            Below `lg` the name was hidden and nothing replaced it, so the
            phone header had no branding at all; a 20px mark is the width that
            buys it back. Splitting them this way is the whole point of having
            a compact mark — it goes where the word does not fit. */}
        <div className="flex items-center gap-2">
          <LanyardMark className="size-5 shrink-0 text-primary" />
          <div className="hidden lg:block">
            <h1 className="text-sm font-semibold leading-tight">Lanyard</h1>
            {/* Companies only, and only when there is something to say. The
                selected event does not scope the schedule or the people list,
                so naming its venue and dates over those two described
                something that was not being shown — and a list or the
                all-companies roll-up has no venue at all, where the old
                `|| '—'` fallback put a lone em-dash under the title. */}
            {view === 'companies' && where && (
              <p className="text-[11px] text-muted-foreground">{where}</p>
            )}
          </div>
        </div>

        {/* Real links, not buttons. Middle-click, Back and bookmarking all
            work for free, and screen readers announce them as navigation
            rather than as three unrelated toggles. The query string is kept
            so an open panel survives a tab change. */}
        <nav aria-label="Views" className="flex rounded-md border border-border p-0.5">
          {VIEWS.map((v) => {
            const current = view === v;
            return (
              <Link
                key={v}
                href={`/${v}${search ? `?${search}` : ''}` as Route}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'rounded px-2.5 py-1 text-[11.5px] font-medium capitalize',
                  current
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v}
                {v === 'people' && people.length > 0 && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{people.length}</span>
                )}
                {v === 'schedule' && schedule.length > 0 && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{schedule.length}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {event?.floorplan_url && (
            <Button variant="outline" size="sm" className="h-7 border-primary/60 text-xs text-primary"
              onClick={() => { setBooth(null); setPlan(event); setPlanOpen(true); }}>
              Floorplan
            </Button>
          )}
          <UserMenu email={email} name={name} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {view === 'schedule' ? (
          <ScheduleView
            items={schedule} owners={owners} loadError={scheduleError}
            onEdit={setEditItem} onOpenCompany={openCompanyDetails}
            onReschedule={rescheduleItem}
            industry={industry} onDismissIndustry={dismissIndustry}
            onOpenEvent={setEventId}
          />
        ) : view === 'companies' ? (
          <>
            <FilterRail
              filters={filters} patch={patch} toggle={toggle} reset={reset}
              leads={leads} categories={categories} statuses={statuses} event={event}
              events={switchable} eventId={eventId} onEventChange={setEventId}
            />

            <main className="flex min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
                {/* The event is named here rather than in the header, which is
                    the one place it stays visible at phone width: the switcher
                    is behind the filter sheet now, and the header's subtitle is
                    `lg:` only. Which event you are looking at is not something
                    to have to open a panel for. */}
                <span>
                  {loading ? 'Loading…' : (
                    <>
                      {event && <span className="text-foreground">{event.name}</span>}
                      {event && ' · '}
                      {`${visible.length} of ${leads.length} ${event?.kind === 'event' ? 'exhibitors' : 'companies'}`}
                    </>
                  )}
                </span>
                {selectedHidden && (
                  <span className="flex items-center gap-2 rounded border border-l-[3px] border-border border-l-amber-600 dark:border-l-amber-400 bg-secondary/60 px-2 py-0.5 text-[11.5px] text-foreground">
                    {selected!.name} is open but hidden by a filter
                    <button type="button" onClick={reset}
                      className="text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid">
                      show it
                    </button>
                  </span>
                )}
                {/* Adding a company is a companies-view action, so it belongs
                    on the companies bar. Clearing filters, which used to sit
                    here, moved into the rail with the filters it clears. */}
                <Button variant="outline" size="sm" className="ml-auto h-6 text-xs"
                  onClick={() => setAddOpen(true)}>
                  Add company
                </Button>
              </div>

              <BulkBar
                count={picked.size} statuses={statuses} owners={owners}
                onApply={applyBulk} onClear={() => setPicked(new Set())} busy={bulkBusy}
              />

              {!loading && visible.length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">
                  No leads match these filters.
                </p>
              ) : wide ? (
                <LeadTable
                  leads={visible} contactsBy={contactsBy} statuses={statuses}
                  owners={owners}
                  sortKey={filters.sortKey} sortDir={filters.sortDir} onSort={onSort}
                  selectedId={selected?.company_id ?? null}
                  onSelect={selectLead} onPatch={onPatch} onBooth={onBooth}
                  pickedIds={picked}
                  onPick={togglePick}
                  onToggleAll={toggleAll}
                />
              ) : (
                <LeadCards
                  leads={visible} contactsBy={contactsBy}
                  selectedId={selected?.company_id ?? null}
                  onSelect={selectLead} onPatch={onPatch} onBooth={onBooth}
                />
              )}
            </main>
          </>
        ) : (
          <PeopleView
            people={people}
            eventCompanyIds={eventCompanyIds}
            eventName={event?.name ?? 'This event'}
            selectedId={person?.id ?? null}
            onSelect={selectPerson}
            onOpenCompany={openCompanyFromList}
            onAddPeople={() => openImport(null)}
          />
        )}
      </div>

      <DrawerStack
        stack={stack}
        onCloseAll={closeStack}
        onPop={popStack}
        onTruncate={truncateStack}
        render={(entry, chrome) => (entry.kind === 'company' ? (
          <CompanyPanel
            {...chrome}
            lead={entry.lead}
            contacts={contactsBy[entry.lead.company_id] ?? []}
            statuses={statuses} owners={owners}
            event={events.find((e) => e.id === entry.lead.event_id) ?? event}
            onPatch={onPatch} onBooth={onBooth}
            companyIndex={companyIndex} onOpenCompany={openCompany}
            onOpenCompanyAt={openCompanyAt}
            allEvents={events}
            onAddPeople={openImport}
            onAddContact={addContact}
            onOpenPerson={openContact}
            activity={activity[entry.lead.company_id]}
            onLoadActivity={loadActivity}
            onCapture={setCaptureLead}
            onDeleteActivity={deleteActivity}
            deals={deals[entry.lead.company_id]}
            edges={edges[entry.lead.company_id]}
            routes={routes[entry.lead.company_id]}
            logo={logos[entry.lead.company_id]}
            onLoadLogo={loadLogo}
            onLoadCommerce={loadCommerce}
            onCreateDeal={createDeal}
            onPatchDeal={patchDeal}
            onDeleteDeal={deleteDeal}
            onAddEdge={addEdge}
            onRemoveEdge={removeEdge}
            onRateEdge={rateEdge}
            onEdit={(l) => {
              // Close the panels first. Both are modal Radix layers, and
              // opening a dialog from inside an open one lets the same pointer
              // sequence register as an outside-click on the new dialog, which
              // closes it the instant it mounts.
              setEditLead(l);
              closeStack();
            }}
          />
        ) : (
          <PersonPanel
            {...chrome}
            person={entry.person}
            companyLinkedIn={
              leads.find((l) => l.company_id === entry.person.company_id)?.linkedin_url ?? null
            }
            onOpenCompany={openCompany}
            onDelete={deletePerson}
          />
        ))}
      />

      <CaptureSheet
        lead={captureLead}
        open={Boolean(captureLead)}
        onOpenChange={(o) => !o && setCaptureLead(null)}
        statuses={statuses}
        onSave={saveCapture}
        busy={capturing}
      />

      <CompanyOverride
        lead={editLead}
        open={Boolean(editLead)}
        onOpenChange={(o) => !o && setEditLead(null)}
        categories={categories}
        onSaved={() => {
          // Reopen the company once the corrected rows land, so the edit does
          // not dump you back on the board with no idea what changed.
          const id = editLead?.company_id;
          setEditLead(null);
          if (id) {
            pendingCompany.current = id;
            // The logo is cached per company and a correction can now set it,
            // so the cached copy has to go or the panel reopens showing the
            // logo you just replaced. Dropping the key makes it `undefined`,
            // which is what the panel's effect watches for.
            setLogos((p) => {
              const next = { ...p };
              delete next[id];
              return next;
            });
          }
          setRefreshKey((k) => k + 1);
        }}
      />

      <CompanyAdd
        open={addOpen}
        onOpenChange={setAddOpen}
        categories={categories}
        event={event}
        onCreated={(id) => {
          // Re-fetch so the new row appears, then open it.
          setRefreshKey((k) => k + 1);
          pendingCompany.current = id;
        }}
      />

      <PeopleImport
        open={importOpen}
        onOpenChange={setImportOpen}
        companyIndex={companyIndex}
        defaultCompanyId={importCompanyId}
        onSaved={loadManual}
      />

      <ScheduleEditor
        item={editItem}
        open={Boolean(editItem)}
        onOpenChange={(o) => !o && setEditItem(null)}
        statuses={statuses}
        owners={owners}
        onSave={saveSchedule}
        onOpenCompany={openCompanyDetails}
      />

      <FloorplanDialog event={plan ?? event} booth={booth} open={planOpen} onOpenChange={setPlanOpen} />
    </div>
  );
}
