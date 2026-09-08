'use client';

import { useState } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { EventSwitcher } from '@/components/event-switcher';
import { SearchInput } from '@/components/search-input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { FilterX, SlidersHorizontal } from 'lucide-react';
import { ResizeHandle } from '@/components/resize-handle';
import { usePersistedWidth } from '@/lib/use-resize';
import { cn } from '@/lib/utils';
import { PRIORITIES, REACHES, categoryClass } from '@/lib/domain';
import type { FilterState } from '@/lib/filters';
import type { Category, EventRow, Lead, Status } from '@/lib/types';

function Chip({ label, count, on, onClick, tone }: {
  label: string; count?: number; on: boolean; onClick: () => void;
  /** Category colour, shown only while the filter is on. */
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px]',
        // Neutral until selected. Thirty categories all wearing their colour at
        // once is a wall of noise, and it leaves nothing for "active" to say.
        // Colour therefore means "this filter is on" and reads at a glance.
        on
          ? (tone ?? 'border-primary text-primary') + ' bg-secondary'
          : 'border-border bg-secondary/40 text-muted-foreground hover:border-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      {count !== undefined && <span className="text-[10px] opacity-70">{count}</span>}
    </button>
  );
}

/**
 * Module scope, deliberately. Defined inside FilterRail this is a new component
 * *type* on every render, so React unmounts and remounts the entire subtree
 * rather than updating it — which threw focus out of the search box on every
 * keystroke, since the input was being destroyed and recreated each time.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

const RAIL_KEY = 'lanyard.rail.width';
const RAIL_MIN = 180;
const RAIL_MAX = 560;

/**
 * `on` is state that has to move with the toggle, not a convenience.
 *
 * Every `won` company is terminal, so "Active partners" on top of "Hide
 * settled companies" asks for the rows it is also hiding and always gives an
 * empty board.
 *
 * "Settled only" is the same trap and did **not** carry the patch, because the
 * stats bar's Settled tile did it instead — the two surfaces for one filter
 * disagreed, and only the tile was right. The tile is gone, so the rule lives
 * where the filter does. That is the argument for one surface per filter: the
 * copy that gets the fix is whichever one someone was looking at.
 */
const TOGGLES: { key: keyof FilterState; label: string; on?: Partial<FilterState> }[] = [
  { key: 'open', label: 'Hide settled companies' },
  { key: 'settled', label: 'Settled only', on: { open: false } },
  { key: 'partner', label: 'Active partners only', on: { open: false } },
  { key: 'inReach', label: 'In reach through a partner' },
  { key: 'star', label: 'Starred only' },
  { key: 'named', label: 'Has a named person' },
  { key: 'email', label: 'Has an email' },
  { key: 'both', label: 'At both events' },
  { key: 'web', label: 'Has verified website' },
  { key: 'hiddenToo', label: 'Show hidden (overridden out)' },
];

export function FilterRail({
  filters, patch, toggle, reset, leads, categories, statuses,
  event, events, eventId, onEventChange,
}: {
  filters: FilterState;
  patch: (p: Partial<FilterState>) => void;
  toggle: (k: 'status' | 'company' | 'prio' | 'reach' | 'cat', v: string) => void;
  reset: () => void;
  leads: Lead[];
  categories: Category[];
  statuses: Status[];
  event: EventRow | null;
  events: EventRow[];
  eventId: string;
  onEventChange: (id: string) => void;
}) {
  const [width, setWidth] = usePersistedWidth(RAIL_KEY, 240, RAIL_MIN, RAIL_MAX);
  // Closed by default: on a phone the filters are a detour, not the view.
  const [open, setOpen] = useState(false);

  const count = <K extends keyof Lead>(field: K, value: unknown, fallback?: unknown) =>
    leads.filter((l) => (l[field] ?? fallback) === value).length;

  const eventStatuses = statuses.filter((s) => s.scope === 'event');
  const companyStatuses = statuses.filter((s) => s.scope === 'company');
  // Counted across every category a company holds, so the chip totals agree
  // with what the filter actually returns.
  const catCounts: Record<string, number> = {};
  leads.forEach((l) => {
    const keys = l.category_keys?.length ? l.category_keys : [l.category_key];
    keys.forEach((k) => { if (k) catCounts[k] = (catCounts[k] ?? 0) + 1; });
  });

  const groups = categories.reduce<Record<string, Category[]>>((acc, c) => {
    if (!catCounts[c.key]) return acc;
    (acc[c.group_name] ??= []).push(c);
    return acc;
  }, {});

  const activeCount = [
    filters.q ? 1 : 0, filters.status.length, filters.company.length,
    filters.prio.length, filters.reach.length, filters.cat.length,
    ...TOGGLES.map((t) => (filters[t.key] ? 1 : 0)),
  ].reduce((a, b) => a + b, 0);

  /**
   * A sidebar on a desk, a sheet on a phone.
   *
   * The rail is a fixed, resizable column, which at 360px of a 390px viewport
   * left the board 30px wide. Below `lg` the same body is rendered inside a
   * sheet behind a Filters button instead — one set of markup, so a filter
   * added later cannot appear in only one of the two.
   */
  const body = (
    <div className="relative h-full">
      <ScrollArea className="h-full">
        {/* `pb-14` is for the Clear button, which hovers over the bottom of the
            rail rather than scrolling with the sections. The room is reserved
            whether or not the button is showing, so applying the first filter
            does not shift every section under the pointer. */}
        <div className="p-3 pb-14">
          {/*
            The event belongs here, not in the header.

            It only ever scoped this board: `schedule_board` is fetched across
            every event on purpose, and the people directory is built from all
            contacts. So in the header it was a control that did nothing on two
            of the three tabs — and being the widest filter of the lot, above
            search is where it reads.
          */}
          <Section title="Event">
            <EventSwitcher events={events} value={eventId} onChange={onEventChange} />
          </Section>

          <Section title="Search">
            <SearchInput
              value={filters.q}
              onChange={(q) => patch({ q })}
              placeholder="company, booth, contact, notes…"
              ariaLabel="Search companies"
              className="h-8 text-xs"
            />
          </Section>

          <Section title="Quick filters">
            <div className="space-y-1.5">
              {TOGGLES.map(({ key, label, on }) => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={key}
                    checked={filters[key] as boolean}
                    onCheckedChange={(v) => patch(
                      (v ? { [key]: true, ...on } : { [key]: false }) as Partial<FilterState>,
                    )}
                  />
                  <Label htmlFor={key} className="text-xs font-normal text-muted-foreground">
                    {label}
                  </Label>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Event pipeline">
            <div className="flex flex-wrap gap-1">
              {eventStatuses.map((s) => (
                <Chip
                  key={s.id} label={s.label}
                  count={count('event_status', s.key, 'new')}
                  on={filters.status.includes(s.key)}
                  onClick={() => toggle('status', s.key)}
                />
              ))}
            </div>
          </Section>

          <Section title="Company relationship">
            <div className="flex flex-wrap gap-1">
              {companyStatuses.map((s) => (
                <Chip
                  key={s.id} label={s.label}
                  count={count('company_status', s.key, 'prospect')}
                  on={filters.company.includes(s.key)}
                  onClick={() => toggle('company', s.key)}
                />
              ))}
            </div>
          </Section>

          <Section title="Priority">
            <div className="flex flex-wrap gap-1">
              {PRIORITIES.map((p) => (
                <Chip key={p} label={p} on={filters.prio.includes(p)} onClick={() => toggle('prio', p)} />
              ))}
            </div>
          </Section>

          <Section title="Market reach">
            <div className="flex flex-wrap gap-1">
              {REACHES.map((r) => (
                <Chip
                  key={r} label={r} count={count('reach', r, 'Unknown')}
                  on={filters.reach.includes(r)} onClick={() => toggle('reach', r)}
                />
              ))}
            </div>
          </Section>

          <Section title="Service category">
            {Object.entries(groups).map(([group, list]) => (
              <div key={group} className="mb-2">
                <p className="mb-1 text-[10px] font-semibold text-muted-foreground/70">{group}</p>
                <div className="flex flex-wrap gap-1">
                  {list.sort((a, b) => catCounts[b.key] - catCounts[a.key]).map((c) => (
                    <Chip
                      key={c.key} label={c.label} count={catCounts[c.key]}
                      tone={categoryClass(c.key, c.group_name)}
                      on={filters.cat.includes(c.key)} onClick={() => toggle('cat', c.key)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </Section>

          <Section title="Read this first">
            <p className="rounded-r border border-l-2 border-border border-l-amber-600 bg-secondary/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
              Names, booths and zones come from the published exhibitor list.
              Emails and phones were <b>retrieved from source</b>, each carrying
              the page it came from — nothing is model-generated.{' '}
              <b>Category</b> is a desk judgement; <b>reach</b> is an estimate
              unless marked Apollo. Contacts marked <b>personal</b> identify an
              individual: GDPR applies. Edits save immediately.
              {event?.source_url && (
                <>
                  {' '}
                  <a
                    href={event.source_url} target="_blank" rel="noopener"
                    className="text-primary hover:underline"
                  >
                    Source
                  </a>
                </>
              )}
            </p>
          </Section>
        </div>
      </ScrollArea>

      {/*
        Clearing belongs with the filters, not on the board's count line — and
        it only exists when there is something to clear. An always-present
        Clear reads as an action you might be missing out on; a button that
        appears when you have narrowed the board is the undo for what you just
        did, and it carries the count so it says how much it will undo.

        `pointer-events-none` on the tray so the sections behind it stay
        scrollable and clickable right up to the button's own edges.

        The tray fades to the rail's own background rather than sitting on
        nothing: without it the chips scrolling past were sliced in half by the
        button's edge and read as broken layout instead of as content passing
        underneath.
      */}
      {activeCount > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-card via-card/95 to-transparent p-2 pt-6">
          <Button
            variant="outline" size="sm"
            onClick={reset}
            className="pointer-events-auto h-8 rounded-full bg-card pl-3 pr-3.5 text-xs shadow-lg"
          >
            <FilterX aria-hidden className="mr-1.5 size-3.5" />
            Clear filters
            <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10.5px] font-semibold text-primary-foreground">
              {activeCount}
            </span>
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <aside
        className="relative hidden shrink-0 border-r border-border bg-card lg:block"
        style={{ width }}
      >
        <ResizeHandle
          label="Resize filters"
          start={() => width}
          onResize={(px, done) => setWidth(px, done)}
          min={RAIL_MIN}
          max={RAIL_MAX}
        />
        {body}
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        {/* Fixed rather than in the header: at phone width the header is
            already the three things you cannot work without, and a filter
            button is reachable with a thumb down here. */}
        <SheetTrigger asChild>
          <Button
            variant="outline" size="sm"
            className="fixed bottom-4 left-4 z-40 h-10 rounded-full pl-3.5 pr-4 shadow-lg lg:hidden"
          >
            <SlidersHorizontal aria-hidden className="mr-1.5 size-4" />
            Filters
            {activeCount > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10.5px] font-semibold text-primary-foreground">
                {activeCount}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[min(22rem,90vw)] gap-0 p-0 sm:max-w-none">
          <SheetHeader className="border-b border-border px-3 py-2">
            <SheetTitle className="text-sm">Filters</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1">{body}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
