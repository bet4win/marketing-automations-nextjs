'use client';

import { memo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Landmark, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { GRADES, REACH_CLASS, bestContact, categoryClass } from '@/lib/domain';
import { cn } from '@/lib/utils';
import { PartnerMark, ReachMark, lostClass } from '@/components/partner-mark';
import type { Contact, Lead } from '@/lib/types';

/**
 * The companies board, for a phone.
 *
 * The table is thirteen columns and wants 1,406px. On a 390px screen that is
 * not a cramped table, it is a horizontal scroll with one column visible — so
 * below `lg` the same rows are cards instead.
 *
 * Deliberately **read-only**. The table puts status, relationship, priority and
 * owner pickers in every row, which is right at a desk and wrong under a thumb:
 * a select inside a tappable card is a mis-tap waiting to happen, and there is
 * a panel one tap away that does all of it with room to spare. The one control
 * kept is the star, because it is a single unambiguous tap and it is how you
 * mark someone mid-conversation.
 *
 * Still virtualised: 2,351 cards is 2,351 too many to mount.
 */

/**
 * A starting guess only — cards are **measured**.
 *
 * A fixed height meant a company with a name and one category left sixty
 * pixels of nothing, next to one with contacts and a booth that fitted
 * exactly. Most of these 2,351 rows are sparse, so a height that suits the
 * fullest card wastes the screen on almost all of them.
 */
const CARD_ESTIMATE = 84;

const Card = memo(function Card({
  lead: l, contacts, selected, onSelect, onPatch, onBooth,
}: {
  lead: Lead;
  contacts: Contact[];
  selected: boolean;
  onSelect: (lead: Lead) => void;
  onPatch: (lead: Lead, patch: Partial<Lead>, scope: 'event' | 'company') => void;
  onBooth: (booth: string) => void;
}) {
  const best = bestContact(contacts);
  const grade = GRADES[best?.attribution ?? 'unattributed'];
  const booths = l.booths ?? [];

  return (
    <div
      className={cn(
        'flex items-start gap-2 border-b border-border/40 px-3 py-2',
        selected && 'bg-primary/15',
        lostClass(l.company_status_outcome),
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(l)}
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
      >
        <span className="flex w-full min-w-0 items-baseline gap-1.5">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 truncate text-[14px] font-medium text-foreground">
              {l.name}
            </span>
            <PartnerMark lead={l} />
            <ReachMark lead={l} />
          </span>
          {l.priority && (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {l.priority}
            </span>
          )}
        </span>

        <span className="flex w-full min-w-0 flex-wrap items-center gap-1">
          {l.category_label && (
            <Badge variant="outline"
              className={cn('max-w-full truncate text-[10.5px] font-normal',
                categoryClass(l.category_key, l.category_group))}>
              {l.category_label}
            </Badge>
          )}
          {(l.category_labels?.length ?? 0) > 1 && (
            <span className="text-[10px] text-muted-foreground">
              +{(l.category_labels!.length - 1)}
            </span>
          )}
          {l.reach && l.reach !== 'Unknown' && (
            <span className={cn('text-[10.5px]', REACH_CLASS[l.reach])}>{l.reach}</span>
          )}
        </span>

        <span className="flex w-full min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          {l.hq_country && <span className="truncate">{l.hq_country}</span>}
          {l.event_status && <span className="truncate">{l.event_status}</span>}
          {l.company_status && <span className="truncate">{l.company_status}</span>}
        </span>

        {best?.email && (
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {best.full_name ?? best.email}
            </span>
            <span className="shrink-0 rounded bg-muted px-1 text-[9.5px] text-muted-foreground">
              {grade.label}
            </span>
          </span>
        )}
      </button>

      <span className="flex shrink-0 flex-col items-end gap-1.5">
        {/* A real 44px box, not padding that adds up to 36 — measured, after
            writing "44px" in this comment and shipping 36. */}
        <button
          type="button"
          aria-label={l.starred ? `Unstar ${l.name}` : `Star ${l.name}`}
          onClick={() => onPatch(l, { starred: !l.starred }, 'event')}
          className="flex size-11 items-center justify-center rounded"
        >
          <Star className={cn('size-4', l.starred
            ? 'fill-amber-400 text-amber-700 dark:text-amber-400' : 'text-muted-foreground/50')} />
        </button>
        {booths.length > 0 && (
          <button
            type="button"
            onClick={() => onBooth(booths[0])}
            className="flex items-center gap-0.5 rounded border border-primary/50 bg-primary/10 px-1.5 py-1 font-mono text-[11px] text-primary"
          >
            <Landmark aria-hidden className="size-3" />
            {booths.join(', ')}
          </button>
        )}
      </span>
    </div>
  );
});

export function LeadCards({
  leads, contactsBy, selectedId, onSelect, onPatch, onBooth,
}: {
  leads: Lead[];
  contactsBy: Record<string, Contact[]>;
  selectedId: string | null;
  onSelect: (lead: Lead) => void;
  onPatch: (lead: Lead, patch: Partial<Lead>, scope: 'event' | 'company') => void;
  onBooth: (booth: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: leads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_ESTIMATE,
    // Measured, so a sparse card is short and a full one is tall.
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 6,
  });

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div style={{ height: rows.getTotalSize(), position: 'relative' }}>
        {rows.getVirtualItems().map((v) => {
          const l = leads[v.index];
          return (
            <div
              key={l.company_id}
              // `data-index` and the ref are how the virtualiser identifies
              // and measures a row; without both, measurement silently does
              // nothing and every card keeps the estimate.
              data-index={v.index}
              ref={rows.measureElement}
              style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                transform: `translateY(${v.start}px)`,
              }}
            >
              <Card
                lead={l}
                contacts={contactsBy[l.company_id] ?? []}
                selected={selectedId === l.company_id}
                onSelect={onSelect}
                onPatch={onPatch}
                onBooth={onBooth}
              />
            </div>
          );
        })}
      </div>
      {/* Clear of the fixed Filters pill, or the last card sits under it. */}
      <div className="h-16" aria-hidden />
    </div>
  );
}
