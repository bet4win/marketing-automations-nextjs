'use client';

import { memo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Globe } from 'lucide-react';
import {
  FacebookIcon, InstagramIcon, LinkedInIcon, TelegramIcon, XIcon, YouTubeIcon,
} from '@/components/brand-icons';
import { GRADES, REACH_CLASS, bestContact, categoryClass } from '@/lib/domain';
import type { SortKey } from '@/lib/filters';
import type { Contact, Lead, Owner, Status } from '@/lib/types';
import { OwnerSelect } from '@/components/owner-select';
import { StatusSelect } from '@/components/status-select';
import { PartnerMark, ReachMark, lostClass } from '@/components/partner-mark';
import { ResizeHandle } from '@/components/resize-handle';
import { justDragged, useColumnWidths } from '@/lib/use-resize';

// The same bounds useColumnWidths clamps to, so Home/End land on real limits.
const COL_MIN = 28;
const COL_MAX = 900;
const ROW_HEIGHT = 34;
const WIDTHS_KEY = 'lanyard.cols.leads';

/**
 * `width: null` means the column takes whatever is left. Exactly one column
 * may be flexible, and it is deliberately the last: with `table-fixed` the
 * unsized column absorbs the surplus on a wide screen, so there is no dead
 * space to the right. It gets no resize handle, because dragging the edge of
 * "the remainder" has no meaning — resize its neighbours instead.
 */
/** `_links` is presentational: there is nothing meaningful to sort it by. */
const COLUMNS: { key: SortKey | '_star' | '_links' | '_sel'; label: string; width: number | null }[] = [
  { key: '_sel', label: '', width: 30 },
  { key: '_star', label: '', width: 32 },
  { key: 'name', label: 'Company', width: 180 },
  { key: 'category_label', label: 'Service category', width: 156 },
  { key: 'reach', label: 'Reach', width: 88 },
  { key: 'hq_country', label: 'HQ', width: 100 },
  { key: '_links', label: 'Links', width: 92 },
  { key: 'booths', label: 'Booth', width: 86 },
  // Not "Sourced": the column shows hand-entered contacts as well now, and the
  // row's own tag is where the provenance is said.
  { key: 'contact', label: 'Contact', width: 186 },
  { key: 'event_status', label: 'Status', width: 112 },
  { key: 'priority', label: 'Pri', width: 74 },
  { key: 'company_status', label: 'Relationship', width: 120 },
  { key: 'owner', label: 'Owner', width: null },
];

/** Module-level so the identity is stable across renders. */
const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.filter((c) => c.width !== null).map((c) => [c.key, c.width as number]),
);

/**
 * Website and socials, in a fixed order so the icons sit in the same place on
 * every row and the column can be scanned vertically.
 */
const LINKS = [
  { field: 'domain', icon: Globe, label: 'Website',
    href: (v: string) => `https://${v}` },
  { field: 'linkedin_url', icon: LinkedInIcon, label: 'LinkedIn', href: (v: string) => v },
  { field: 'x_url', icon: XIcon, label: 'X', href: (v: string) => v },
  { field: 'facebook_url', icon: FacebookIcon, label: 'Facebook', href: (v: string) => v },
  { field: 'instagram_url', icon: InstagramIcon, label: 'Instagram', href: (v: string) => v },
  { field: 'youtube_url', icon: YouTubeIcon, label: 'YouTube', href: (v: string) => v },
  { field: 'telegram_url', icon: TelegramIcon, label: 'Telegram', href: (v: string) => v },
] as const;

/** Floor for the flexible column, so it can never be squeezed to nothing. */
const FLEX_MIN = 150;

type RowProps = {
  lead: Lead;
  contacts: Contact[];
  eventStatuses: Status[];
  companyStatuses: Status[];
  owners: Owner[];
  selected: boolean;
  picked: boolean;
  onPick: (companyId: string) => void;
  onSelect: (lead: Lead) => void;
  onPatch: (lead: Lead, patch: Partial<Lead>, scope: 'event' | 'company') => void;
  onBooth: (booth: string) => void;
};

/**
 * Memoised so a filter or sort change re-renders only the rows that actually
 * changed. Tooltips here are native `title` attributes rather than Radix
 * components: at this row count the component version was a measurable cost
 * for no benefit over what the browser already does.
 */
const Row = memo(function Row({
  lead: l, contacts, eventStatuses, companyStatuses, owners, selected, picked,
  onSelect, onPatch, onBooth, onPick,
}: RowProps) {
  const best = bestContact(contacts);
  const grade = GRADES[best?.attribution ?? 'unattributed'];
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <tr
      onClick={() => onSelect(l)}
      style={{ height: ROW_HEIGHT }}
      className={cn(
        'cursor-pointer border-b border-border/40 hover:bg-muted/40',
        (selected || picked) && 'bg-primary/15',
        // Only `lost` fades. A won relationship is the point of the tool.
        lostClass(l.company_status_outcome),
      )}
    >
      <td className="px-1.5" onClick={stop}>
        <input
          type="checkbox"
          aria-label={`Select ${l.name}`}
          checked={picked}
          onChange={() => onPick(l.company_id)}
          className="align-middle accent-[oklch(0.78_0.11_184)]"
        />
      </td>

      <td className="px-2">
        <button
          type="button"
          aria-label={l.starred ? 'Unstar' : 'Star'}
          onClick={(e) => { stop(e); onPatch(l, { starred: !l.starred }, 'event'); }}
        >
          <Star className={cn('size-3.5', l.starred
            ? 'fill-amber-400 text-amber-700 dark:text-amber-400' : 'text-muted-foreground/50')} />
        </button>
      </td>

      <td
        className="truncate px-2 font-medium"
        title={`Category confidence: ${l.category_confidence}`}
      >
        <span className="inline-flex items-center gap-1">
          {l.name}
          <PartnerMark lead={l} />
          <ReachMark lead={l} />
        </span>
        {l.category_confidence !== 'verified' && (
          // 11px, not 9px. A superscript is already visually smaller than its
          // stated size, so 9px rendered as an unreadable speck — and this
          // marker is the only thing on the row saying the category is a guess.
          <span
            title={l.category_confidence === 'inferred'
              ? 'Category inferred from the company name — not verified'
              : 'Category taken from the source listing — not verified'}
            aria-label={`Category ${l.category_confidence ?? 'unknown'}, not verified`}
            className="ml-1 align-super text-[11px] font-semibold leading-none text-amber-700 dark:text-amber-400"
          >
            {/* '~' rather than '·'. A middle dot is almost entirely whitespace,
                so at superscript size it had no visible ink at all — the size
                was never the problem with that one, the glyph was. '~' also
                says "approximate", which is what classified means here. */}
            {l.category_confidence === 'inferred' ? '?' : '~'}
          </span>
        )}
      </td>

      <td className="overflow-hidden whitespace-nowrap px-2"
        title={(l.category_labels ?? []).join(', ')}>
        <Badge
          variant="outline"
          className={cn('max-w-full truncate text-[10.5px] font-normal',
            categoryClass(l.category_key, l.category_group))}
        >
          {l.category_label ?? '—'}
        </Badge>
        {(l.category_labels?.length ?? 0) > 1 && (
          <span className="ml-1 text-[10px] text-muted-foreground">
            +{(l.category_labels!.length - 1)}
          </span>
        )}
      </td>

      <td
        className={cn('px-2 text-[11px]', REACH_CLASS[l.reach ?? 'Unknown'])}
        title={l.reach_source === 'apollo' ? 'From Apollo firmographics' : 'Desk estimate'}
      >
        {l.reach}
      </td>

      <td className="truncate px-2 text-xs">
        {[l.hq_city, l.hq_country].filter(Boolean).join(', ')}
      </td>

      <td className="overflow-hidden whitespace-nowrap px-1.5" onClick={stop}>
        <span className="flex items-center gap-0.5">
          {LINKS.map(({ field, icon: Icon, label, href }) => {
            const raw = l[field] as string | null;
            if (!raw) return null;
            return (
              <a
                key={field}
                href={href(raw)}
                target="_blank"
                rel="noopener"
                title={`${label} — ${raw.replace(/^https?:\/\/(www\.)?/, '')}`}
                aria-label={`${l.name} on ${label}`}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-primary"
              >
                <Icon className="size-3.5" />
              </a>
            );
          })}
        </span>
      </td>

      <td className="overflow-hidden whitespace-nowrap px-2">
        {(l.booths ?? []).map((b) => (
          <button
            key={b}
            type="button"
            onClick={(e) => { stop(e); onBooth(b); }}
            className="mr-1 rounded border border-transparent px-1 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
          >
            {b}
          </button>
        ))}
      </td>

      <td className="truncate px-2">
        {best ? (
          <a
            href={`mailto:${best.email}`}
            onClick={stop}
            title={`${best.full_name ? `${best.full_name}\n` : ''}${best.email}\n${grade.tip}`}
            className="text-xs text-primary hover:underline"
          >
            {best.full_name ?? best.email}
          </a>
        ) : l.linkedin_url ? (
          <a
            href={l.linkedin_url} target="_blank" rel="noopener" onClick={stop}
            className="text-xs text-primary hover:underline"
          >
            LinkedIn
          </a>
        ) : null}
        {best?.full_name && (
          <div className="truncate text-[10px] text-muted-foreground">
            {best.job_title ?? best.email}
          </div>
        )}
      </td>

      <td className="px-1" onClick={stop}>
        <StatusSelect
          statuses={eventStatuses}
          value={l.event_status_id}
          onChange={(id, key) => onPatch(l, { event_status_id: id, event_status: key ?? null }, 'event')}
        />
      </td>

      <td className="px-1" onClick={stop}>
        {/* Company-scoped, so it stays editable with no event selected. */}
        <StatusSelect
          options={['High', 'Med', 'Low']}
          value={l.priority}
          onChange={(v) => onPatch(l, { priority: v as Lead['priority'] }, 'company')}
        />
      </td>

      <td className="px-1" onClick={stop}>
        <StatusSelect
          statuses={companyStatuses}
          value={l.company_status_id}
          onChange={(id, key, terminal) =>
            onPatch(l, {
              company_status_id: id,
              company_status: key ?? null,
              company_status_terminal: terminal ?? null,
            }, 'company')}
        />
      </td>

      <td className="px-1" onClick={stop}>
        <OwnerSelect
          owners={owners}
          value={l.owner}
          ariaLabel={`Owner of ${l.name}`}
          onChange={(v) => {
            if (v !== (l.owner ?? null)) onPatch(l, { owner: v }, 'event');
          }}
        />
      </td>
    </tr>
  );
});

/**
 * Virtualised: only the rows in view are mounted.
 *
 * Virtualisation alone was not enough. It cut the initial render but pushed
 * the cost into scrolling, where every newly mounted row rebuilt three Radix
 * Selects and left blank frames behind. The rows had to get cheap as well —
 * see status-select.tsx — and with that done this is what keeps a
 * nine-hundred-row table responsive rather than what papers over it.
 *
 * Keep the row height fixed or the virtualiser cannot measure.
 */
export function LeadTable({
  leads, contactsBy, statuses, owners, sortKey, sortDir, onSort,
  selectedId, onSelect, onPatch, onBooth,
  pickedIds, onPick, onToggleAll,
}: {
  leads: Lead[];
  contactsBy: Record<string, Contact[]>;
  statuses: Status[];
  owners: Owner[];
  sortKey: SortKey;
  sortDir: 1 | -1;
  onSort: (k: SortKey) => void;
  selectedId: string | null;
  onSelect: (lead: Lead) => void;
  onPatch: (lead: Lead, patch: Partial<Lead>, scope: 'event' | 'company') => void;
  onBooth: (booth: string) => void;
  pickedIds: Set<string>;
  onPick: (companyId: string) => void;
  onToggleAll: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventStatuses = statuses.filter((s) => s.scope === 'event');
  const companyStatuses = statuses.filter((s) => s.scope === 'company');

  const allSelected = leads.length > 0 && leads.every((l) => pickedIds.has(l.company_id));
  const someSelected = pickedIds.size > 0;

  const { widths, setWidth } = useColumnWidths(WIDTHS_KEY, DEFAULT_WIDTHS);
  // `?? c.width` is a guard, not decoration: state persists across a hot
  // reload and across a localStorage blob written before a column existed, so
  // a newly added column is missing from `widths` on that first render. Without
  // the fallback the sum becomes NaN and the table's minWidth is invalid.
  // Number.isFinite, not `??`: a NaN left in state by an earlier bad drag is
  // neither null nor undefined, so `??` would hand it straight back.
  const widthOf = (c: (typeof COLUMNS)[number]) =>
    (Number.isFinite(widths[c.key]) ? widths[c.key] : (c.width as number));
  const fixedTotal = COLUMNS.reduce(
    (sum, c) => (c.width === null ? sum : sum + widthOf(c)), 0);

  const virtualizer = useVirtualizer({
    count: leads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    // Generous overscan: rows are cheap now, so buffering more of them off
    // screen costs little and removes the blank band on fast scrolls.
    overscan: 24,
    getItemKey: (i) => leads[i].company_id,
  });

  const items = virtualizer.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length
    ? virtualizer.getTotalSize() - items[items.length - 1].end
    : 0;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      {/* min-width is derived from the live widths rather than hardcoded. The
          old fixed 1300px drifted out of step with the columns once and left
          the auto-width Owner column 6px wide; now it cannot. */}
      <table
        className="w-full table-fixed border-collapse text-sm"
        style={{ minWidth: fixedTotal + FLEX_MIN }}
      >
        <colgroup>
          {COLUMNS.map((c) => (
            <col
              key={c.key}
              style={c.width === null ? undefined : { width: widthOf(c) }}
            />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-secondary">
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'relative h-8 select-none px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground',
                  c.key !== '_star' && c.key !== '_links' && c.key !== '_sel'
                    && 'cursor-pointer hover:text-foreground',
                )}
                onClick={['_star', '_links', '_sel'].includes(c.key) ? undefined : () => {
                  // Checked here, not during render: the click arrives after
                  // the drag, so a render-time value would always be stale.
                  if (!justDragged()) onSort(c.key as SortKey);
                }}
              >
                <span className="block truncate">
                  {c.key === '_sel' ? (
                    <input
                      type="checkbox"
                      aria-label="Select all visible rows"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={onToggleAll}
                      className="align-middle accent-[oklch(0.78_0.11_184)]"
                    />
                  ) : c.label}
                  {sortKey === (c.key as SortKey) && (
                    <span className="ml-1 text-[9px] text-primary">{sortDir > 0 ? '▲' : '▼'}</span>
                  )}
                </span>
                {c.width !== null && (
                  <ResizeHandle
                    label={`Resize ${c.label || 'column'}`}
                    start={() => widthOf(c)}
                    onResize={(px, done) => setWidth(c.key, px, done)}
                    min={COL_MIN} max={COL_MAX}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && <tr style={{ height: padTop }} aria-hidden />}
          {items.map((item) => {
            const l = leads[item.index];
            return (
              <Row
                key={l.company_id}
                lead={l}
                contacts={contactsBy[l.company_id] ?? []}
                eventStatuses={eventStatuses}
                companyStatuses={companyStatuses}
                owners={owners}
                selected={selectedId === l.company_id}
                picked={pickedIds.has(l.company_id)}
                onPick={onPick}
                onSelect={onSelect}
                onPatch={onPatch}
                onBooth={onBooth}
              />
            );
          })}
          {padBottom > 0 && <tr style={{ height: padBottom }} aria-hidden />}
        </tbody>
      </table>
    </div>
  );
}
