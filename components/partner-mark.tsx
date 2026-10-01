'use client';

import { Handshake, UserCheck, Waypoints } from 'lucide-react';
import { GeorgiaFlagIcon } from '@/components/brand-icons';
import { tip } from '@/components/hover-tip';
import { cn } from '@/lib/utils';
import type { Lead } from '@/lib/types';

/**
 * Marks a company we have live business with.
 *
 * Rows used to be faded to 45% opacity whenever the relationship was
 * *terminal*, which is equally true of Active partner and of Not a fit — so
 * the best relationships in the database rendered as if disabled. Fading is
 * for `lost`; `won` gets full contrast and this mark instead.
 *
 * An icon rather than a colour alone: colour is already carrying priority,
 * category and status on these rows, and a fourth meaning for it would be one
 * too many to read at a glance.
 */
export function PartnerMark({
  lead, className,
}: {
  lead: Pick<Lead, 'company_status_outcome' | 'company_status_label'>;
  className?: string;
}) {
  if (lead.company_status_outcome !== 'won') return null;
  const label = lead.company_status_label ?? 'Active partner';
  // On a wrapping span: lucide icons do not forward arbitrary attributes.
  return (
    <span {...tip(label)} className="inline-flex shrink-0 items-center">
      <Handshake
        aria-label={label}
        className={cn('size-3.5 text-emerald-700 dark:text-emerald-300', className)}
      />
    </span>
  );
}

/**
 * Marks a company our content can already get to, but is not live at.
 *
 * The third state, and the actionable one: a `won` partner needs nothing, a
 * company with no route needs a deal from scratch, and this one needs a
 * conversation with a partner we already have. Never shown alongside the
 * handshake — the view makes `in_reach` false once the relationship is won,
 * so the two cannot both apply.
 */
export function ReachMark({
  lead, className,
}: {
  lead: Pick<Lead, 'in_reach' | 'reach_chain' | 'reach_ggr_pct'>;
  className?: string;
}) {
  if (!lead.in_reach) return null;
  const via = lead.reach_chain ?? '';
  const pct = lead.reach_ggr_pct;
  // The detail carries the *why*: which partner, and what it pays if known.
  // "In reach" on its own would be a claim with no way to check it.
  const detail = [
    via ? `Through ${via}` : 'Through an existing partner',
    pct === null || pct === undefined ? 'rate not yet known' : `worth ${pct}% of GGR`,
  ].join(' · ');
  const label = `In reach — ${detail}`;
  return (
    <span {...tip('In reach', detail)} className="inline-flex shrink-0 items-center">
      <Waypoints aria-label={label} className={cn('size-3.5 text-sky-700 dark:text-sky-300', className)} />
    </span>
  );
}

/**
 * A Georgian name on the row: a company with at least one, or a person whose
 * surname reads as one (`lib/georgian.ts`). The same rule decides the mark
 * and the "Has a Georgian contact" filter, so the two cannot disagree.
 *
 * The tooltip names who, because "Georgian" on its own is a claim nobody can
 * check — and it says "name", because a surname is all the rule reads.
 */
export function GeorgianMark({
  names, className,
}: {
  names: (string | null)[];
  className?: string;
}) {
  const who = names.filter(Boolean) as string[];
  if (!who.length) return null;
  const title = who.length === 1 ? 'Georgian name' : 'Georgian names';
  const list = `${who.slice(0, 4).join(', ')}${who.length > 4 ? ` and ${who.length - 4} more` : ''}`;
  const label = `${title}: ${list}`;
  return (
    <span {...tip(title, list)} className="inline-flex shrink-0 items-center">
      <GeorgiaFlagIcon className={cn('h-2.5 w-[15px] rounded-[1px]', className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Someone on the team knows this person personally (`person_marks.known`).
 * A person icon rather than the partner handshake, which already means live
 * business with a company.
 */
export function KnownMark({ name, className }: { name: string | null; className?: string }) {
  const label = `Know personally${name ? `: ${name}` : ''}`;
  return (
    <span {...tip('Know personally', name)} className="inline-flex shrink-0 items-center">
      <UserCheck aria-label={label} className={cn('size-3.5 text-emerald-700 dark:text-emerald-300', className)} />
    </span>
  );
}

/** The fade, and only where it belongs. */
export const lostClass = (outcome: string | null | undefined) =>
  (outcome === 'lost' ? 'opacity-45' : undefined);
