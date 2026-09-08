'use client';

import { memo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ExternalLink } from 'lucide-react';
import { LinkedInIcon } from '@/components/brand-icons';
import { CompanyLink } from '@/lib/entity-links';
import { cn } from '@/lib/utils';
import { GRADES } from '@/lib/domain';
import { ATTRIBUTION_CLASS, isLinkedInUrl, profileHost } from '@/lib/people';
import type { Person } from '@/lib/types';
import { ResizeHandle } from '@/components/resize-handle';
import { justDragged, useColumnWidths } from '@/lib/use-resize';

// The same bounds useColumnWidths clamps to, so Home/End land on real limits.
const COL_MIN = 28;
const COL_MAX = 900;
const ROW_HEIGHT = 34;
const WIDTHS_KEY = 'lanyard.cols.people';

export type PersonSortKey = 'full_name' | 'job_title' | 'company_name' | 'email' | 'attribution';

/** `width: null` is the flexible remainder — see the note in lead-table.tsx. */
const COLUMNS: { key: PersonSortKey; label: string; width: number | null }[] = [
  { key: 'full_name', label: 'Name', width: 210 },
  { key: 'job_title', label: 'Job title', width: 210 },
  { key: 'company_name', label: 'Company', width: 210 },
  { key: 'email', label: 'Email', width: 280 },
  { key: 'attribution', label: 'Name source', width: null },
];

const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.filter((c) => c.width !== null).map((c) => [c.key, c.width as number]),
);

const FLEX_MIN = 130;

const Row = memo(function Row({
  person: p, selected, onSelect, onOpenCompany,
}: {
  person: Person;
  selected: boolean;
  onSelect: (p: Person) => void;
  onOpenCompany: (companyId: string) => void;
}) {
  const grade = GRADES[p.attribution ?? 'unattributed'];
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <tr
      onClick={() => onSelect(p)}
      style={{ height: ROW_HEIGHT }}
      className={cn('cursor-pointer border-b border-border/40 hover:bg-muted/40',
        selected && 'bg-primary/15')}
    >
      <td className="truncate px-2 font-medium">
        {p.full_name}
        {/* Only when it really is LinkedIn: the column holds whatever profile
            was found, and the directory imports fill it with their own. */}
        {p.linkedin_url && (
          <a
            href={p.linkedin_url} target="_blank" rel="noopener" onClick={stop}
            title={isLinkedInUrl(p.linkedin_url)
              ? 'LinkedIn profile' : `Profile on ${profileHost(p.linkedin_url)}`}
            className="ml-1.5 inline-block align-middle text-primary hover:text-primary/80"
          >
            {isLinkedInUrl(p.linkedin_url)
              ? <LinkedInIcon className="size-3" />
              : <ExternalLink className="size-3" />}
          </a>
        )}
      </td>
      <td className="truncate px-2 text-xs text-muted-foreground">
        {p.job_title ?? '—'}
      </td>
      {/* The row opens the person; the company is a different entity, so it
          gets its own link rather than being the one name you cannot follow.
          `CompanyLink` stops the click from also selecting the person. */}
      <td className="truncate px-2 text-xs">
        <CompanyLink
          id={p.company_id} name={p.company_name} onOpen={onOpenCompany}
          className="block max-w-full truncate"
        />
      </td>
      <td className="truncate px-2">
        {p.email && (
          <a
            href={`mailto:${p.email}`} onClick={stop}
            className="text-xs text-primary hover:underline"
          >
            {p.email}
          </a>
        )}
      </td>
      {/* A hand-entered person and a name guessed from a mailbox must not read
          the same, so origin overrides the grade label here. */}
      <td
        className={cn('px-2 text-[11px]',
          p.origin === 'entered' ? 'text-sky-700 dark:text-sky-400' : ATTRIBUTION_CLASS[p.attribution ?? 'unattributed'])}
        title={p.origin === 'entered'
          ? 'Entered by hand and reviewed before saving.'
          : grade.tip}
      >
        {p.origin === 'entered' ? 'entered' : grade.label}
      </td>
    </tr>
  );
});

/** Same virtualised, cheap-row approach as the lead table — see its note. */
export function PeopleTable({
  people, sortKey, sortDir, onSort, selectedId, onSelect, onOpenCompany,
}: {
  people: Person[];
  sortKey: PersonSortKey;
  sortDir: 1 | -1;
  onSort: (k: PersonSortKey) => void;
  selectedId: string | null;
  onSelect: (p: Person) => void;
  onOpenCompany: (companyId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
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
    count: people.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 24,
    getItemKey: (i) => people[i].id,
  });

  const items = virtualizer.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length
    ? virtualizer.getTotalSize() - items[items.length - 1].end
    : 0;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <table
        className="w-full table-fixed border-collapse text-sm"
        style={{ minWidth: fixedTotal + FLEX_MIN }}
      >
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.key} style={c.width === null ? undefined : { width: widthOf(c) }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-secondary">
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                onClick={() => { if (!justDragged()) onSort(c.key); }}
                className={cn(
                  'relative h-8 cursor-pointer select-none px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground')}
              >
                <span className="block truncate">
                  {c.label}
                  {sortKey === c.key && (
                    <span className="ml-1 text-[9px] text-primary">{sortDir > 0 ? '▲' : '▼'}</span>
                  )}
                </span>
                {c.width !== null && (
                  <ResizeHandle
                    label={`Resize ${c.label}`}
                    start={() => widthOf(c)}
                    onResize={(px, done) => setWidth(c.key, px, done)}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && <tr style={{ height: padTop }} aria-hidden />}
          {items.map((item) => {
            const p = people[item.index];
            return (
              <Row
                key={p.id}
                person={p}
                selected={selectedId === p.id}
                onSelect={onSelect}
                onOpenCompany={onOpenCompany}
              />
            );
          })}
          {padBottom > 0 && <tr style={{ height: padBottom }} aria-hidden />}
        </tbody>
      </table>
    </div>
  );
}
