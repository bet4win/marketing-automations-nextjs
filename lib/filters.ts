'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Category, Contact, Lead, Priority, Reach, Status } from './types';
import { bestContact, reachRank, REACHES, PRIORITIES, priorityRank } from './domain';
import { georgiansOf } from './georgian';

export type SortKey =
  | 'name' | 'category_label' | 'reach' | 'hq_country'
  | 'booths' | 'contact' | 'event_status' | 'priority'
  | 'company_status' | 'owner';

export type FilterState = {
  q: string;
  status: string[];
  company: string[];
  prio: string[];
  reach: string[];
  cat: string[];
  settled: boolean;   // only companies whose relationship status is terminal
  star: boolean;
  /**
   * The two states the distribution graph produces, as filters.
   *
   * Both test exactly what the row's own mark tests — `PartnerMark` on `won`,
   * `ReachMark` on `in_reach` — so a filter and the icon beside it cannot
   * disagree about what a partner or a reachable company is.
   */
  partner: boolean;   // live business: company_status_outcome = 'won'
  inReach: boolean;   // reachable through a partner we already have
  /** At least one named contact whose surname reads as Georgian — lib/georgian.ts. */
  georgian: boolean;
  /** Someone there is marked "Know personally" — the same mark as KnownMark. */
  known: boolean;
  sortKey: SortKey;
  sortDir: 1 | -1;
};

export const EMPTY_FILTERS: FilterState = {
  q: '', status: [], company: [], prio: [], reach: [], cat: [],
  settled: false, star: false,
  partner: false, inReach: false, georgian: false, known: false,
  sortKey: 'name', sortDir: 1,
};

const KEY = (eventId: string) => `lanyard.view.${eventId}`;

/** Bumped when a stored default changes meaning, so the old value is not read back. */
const VERSION = 2;

/**
 * Filter/sort state, persisted per event.
 *
 * Per event rather than globally so switching shows restores that show's last
 * view, instead of carrying a category filter across to an event where it
 * matches nothing. Restored values are validated against what the event
 * actually contains — a stale key would otherwise filter the board to nothing
 * with no visible cause.
 */
export function usePersistedFilters(
  eventId: string | null,
  opts: { categories: Category[]; statuses: Status[] },
) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    setHydrated(false);
    let stored: Partial<FilterState> & { v?: number } = {};
    try {
      stored = JSON.parse(localStorage.getItem(KEY(eventId)) ?? '{}') ?? {};
    } catch {
      stored = {};
    }

    const valid = {
      status: new Set(opts.statuses.filter((s) => s.scope === 'event').map((s) => s.key)),
      company: new Set(opts.statuses.filter((s) => s.scope === 'company').map((s) => s.key)),
      prio: new Set<string>(PRIORITIES),
      reach: new Set<string>(REACHES),
      cat: new Set(opts.categories.map((c) => c.key)),
    };
    const pick = (k: keyof typeof valid) =>
      (Array.isArray(stored[k]) ? (stored[k] as string[]) : []).filter((v) => valid[k].has(v));

    setFilters({
      ...EMPTY_FILTERS,
      q: typeof stored.q === 'string' ? stored.q : '',
      status: pick('status'), company: pick('company'), prio: pick('prio'),
      reach: pick('reach'), cat: pick('cat'),
      // Only toggles that still have a control are read back. A stored value
      // for a removed one would filter the board with nothing on screen to
      // say so or to switch it off.
      settled: !!stored.settled, star: !!stored.star,
      partner: !!stored.partner, inReach: !!stored.inReach, georgian: !!stored.georgian,
      known: !!stored.known,
      sortKey: (stored.sortKey as SortKey) ?? 'name',
      sortDir: stored.sortDir === -1 ? -1 : 1,
    });
    setHydrated(true);
  }, [eventId, opts.categories, opts.statuses]);

  useEffect(() => {
    // Only persist once a view has been hydrated for this event, or switching
    // events would write the outgoing filters under the incoming event's key.
    if (!eventId || !hydrated) return;
    try {
      localStorage.setItem(KEY(eventId), JSON.stringify({ ...filters, v: VERSION }));
    } catch {
      // storage full or blocked; filters simply will not persist
    }
  }, [eventId, hydrated, filters]);

  const patch = useCallback(
    (p: Partial<FilterState>) => setFilters((f) => ({ ...f, ...p })),
    [],
  );

  const toggle = useCallback(
    (key: 'status' | 'company' | 'prio' | 'reach' | 'cat', value: string) =>
      setFilters((f) => ({
        ...f,
        [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
      })),
    [],
  );

  const reset = useCallback(() => setFilters(EMPTY_FILTERS), []);

  return { filters, patch, toggle, reset, hydrated };
}

function sortValue(lead: Lead, key: SortKey, contacts: Contact[]): string | number {
  switch (key) {
    case 'reach': return reachRank(lead.reach);
    case 'priority': return priorityRank(lead.priority);
    case 'booths': return (lead.booths ?? []).join(' ');
    case 'contact': {
      const c = bestContact(contacts);
      return c?.full_name ?? c?.email ?? '';
    }
    case 'event_status': return lead.event_status ?? 'new';
    default: return (lead[key as keyof Lead] as string | number | null) ?? '';
  }
}

export function useVisibleLeads(
  leads: Lead[],
  contactsBy: Record<string, Contact[]>,
  f: FilterState,
) {
  return useMemo(() => {
    const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);

    const out = leads.filter((l) => {
      const contacts = contactsBy[l.company_id] ?? [];

      if (terms.length) {
        const hay = [
          l.name, l.category_label, l.hq_country, l.hq_city, l.domain,
          (l.booths ?? []).join(' '), (l.zones ?? []).join(' '), l.reach,
          l.notes, l.owner, l.apollo_industry,
          contacts.map((c) => [c.email, c.full_name, c.job_title, c.phone]
            .filter(Boolean).join(' ')).join(' '),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!terms.every((t) => hay.includes(t))) return false;
      }

      if (f.settled && !l.company_status_terminal) return false;
      // Hidden by an override. Excluded unless explicitly asked for, so a
      // correction takes effect without the row silently ceasing to exist.
      if (l.hidden) return false;
      if (f.status.length && !f.status.includes(l.event_status ?? 'new')) return false;
      if (f.company.length && !f.company.includes(l.company_status ?? 'prospect')) return false;
      if (f.prio.length && !f.prio.includes(l.priority ?? '')) return false;
      if (f.reach.length && !f.reach.includes(l.reach ?? 'Unknown')) return false;
      if (f.cat.length) {
        // Match on any of the company's categories, not only the primary —
        // a studio that also aggregates must appear under both filters.
        const keys = l.category_keys?.length ? l.category_keys : [l.category_key ?? ''];
        if (!keys.some((k) => f.cat.includes(k))) return false;
      }
      if (f.star && !l.starred) return false;
      if (f.partner && l.company_status_outcome !== 'won') return false;
      if (f.inReach && !l.in_reach) return false;
      if (f.georgian && !georgiansOf(contacts).length) return false;
      if (f.known && !contacts.some((c) => c.known)) return false;
      return true;
    });

    out.sort((a, b) => {
      let x = sortValue(a, f.sortKey, contactsBy[a.company_id] ?? []);
      let y = sortValue(b, f.sortKey, contactsBy[b.company_id] ?? []);
      if (typeof x === 'string') x = x.toLowerCase();
      if (typeof y === 'string') y = y.toLowerCase();
      if (x === '' && y !== '') return 1;      // blanks always last
      if (y === '' && x !== '') return -1;
      if (x < y) return -f.sortDir;
      if (x > y) return f.sortDir;
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
    return out;
  }, [leads, contactsBy, f]);
}
