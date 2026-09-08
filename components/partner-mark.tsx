'use client';

import { Handshake, Waypoints } from 'lucide-react';
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
  // The title goes on a wrapping span: lucide icons do not forward `title`,
  // and an SVG <title> child is not what a hover tooltip reads anyway.
  return (
    <span title={label} className="inline-flex shrink-0 items-center">
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
  // The tooltip carries the *why*: which partner, and what it pays if known.
  // "In reach" on its own would be a claim with no way to check it.
  const label = [
    via ? `In reach through ${via}` : 'In reach through an existing partner',
    pct === null || pct === undefined ? 'rate not yet known' : `worth ${pct}% of GGR`,
  ].join(' — ');
  return (
    <span title={label} className="inline-flex shrink-0 items-center">
      <Waypoints aria-label={label} className={cn('size-3.5 text-sky-700 dark:text-sky-300', className)} />
    </span>
  );
}

/** The fade, and only where it belongs. */
export const lostClass = (outcome: string | null | undefined) =>
  (outcome === 'lost' ? 'opacity-45' : undefined);
