'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownUp, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Clock,
  EyeOff, Landmark, Pencil, User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { today as todayYmd, ymd } from '@/lib/dates';
import { ownerLabel } from '@/lib/owners';
import { PartnerMark, ReachMark } from '@/components/partner-mark';
import { categoryClass, statusInk } from '@/lib/domain';
import { cn } from '@/lib/utils';
import {
  IndustryBands, IndustryControl, IndustryRow, LANE, upcomingIndustry,
  useCalendarPrefs, visibleIndustry, weekBands, weeksOf,
} from '@/components/industry-calendar';
import type { IndustryEvent, Owner, ScheduleItem } from '@/lib/types';

/**
 * Dated next actions, as a month grid and a list.
 *
 * Reads `schedule_board`, which spans every event rather than the one currently
 * selected — a follow-up you owe someone does not stop mattering because you
 * switched to a different show. That is the whole reason this is a separate
 * view instead of a column on the board.
 *
 * Clicking an item opens the editor, not the board. It used to jump to the
 * companies tab, which threw away the view you were working in and left you
 * hunting for the row again; the editor can open the company panel itself if
 * that is what you wanted.
 *
 * Items can also be dragged onto another day, from the calendar or from either
 * list, which writes only the due date.
 *
 * Dates are `YYYY-MM-DD` strings throughout — see lib/dates.ts for why they are
 * never parsed into a local `Date`.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * How many chips fit in a day cell, in px.
 *
 * The cells are square, so their height follows the calendar's width — at 70%
 * of a wide window a day is 250px tall, and a fixed cap of three chips left
 * most of that empty while still claiming "+N more". So the cap is derived.
 *
 * These came from `getBoundingClientRect` on the rendered elements, not from
 * reading the Tailwind classes: the first set was estimated from class names,
 * came out at 16px against a real chip pitch of 19.75, and overflowed the cell
 * by 29px — a clip that `overflow-hidden` made silent. Each is rounded **up**,
 * so any remaining error leaves a cell slightly under-filled rather than
 * hiding a follow-up. Re-measure if the chip's type size or padding changes.
 */
const GAP = 4;          // grid gap-1
const PAD = 8;          // cell p-1, top and bottom
const BORDER = 2;       // the cell's own border; rects are border-box
const HEAD = 19;        // day number row + mb-0.5   (measured 18.5)
const CHIP = 20;        // one chip, margin included (measured 19.75 pitch)
const MORE = 14;        // the "+N more" line        (measured 13.5 as a block)
const FALLBACK_CHIPS = 3;   // one frame, before the first measurement lands
/**
 * Slack, so the last chip is never the one that drifts out of the box. Without
 * it the busiest cell fitted with exactly 0px spare — correct on this machine
 * and one font-metric change away from silently hiding a follow-up.
 */
const SAFETY = 6;

/** Breathing room below the last week, so it does not touch the window edge. */
const BOTTOM = 12;
/** Floor for the grid, below which the cells stop being usable. Scroll instead. */
const MIN_GRID = 7 * 44 + 6 * GAP;

/**
 * Six weeks of real dates, with the ones outside the displayed month flagged.
 *
 * The lead and trail cells used to be `null` placeholders. Two reasons they are
 * real dates now:
 *
 * - `null` collided with `over`, the day being dragged over, which is also
 *   `null` when nothing is. `over === day` was therefore true for every
 *   placeholder, so they all wore the drop-target highlight permanently while
 *   the actual days of the month looked inert.
 * - A date outside the month is still a date you can drop on, and since the
 *   calendar cannot be paged mid-drag, those cells are the only way to drag a
 *   follow-up across a month boundary.
 */
function monthGrid(year: number, month: number) {
  // Monday-first: getDay() is 0 for Sunday, so Sunday becomes 6.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells: { date: string; inMonth: boolean }[] = [];
  // Day 0 of a month is the last of the previous one, and negatives keep
  // counting back, so this needs no special-casing for January.
  for (let i = lead; i > 0; i--) {
    cells.push({ date: ymd(new Date(year, month, 1 - i)), inMonth: false });
  }
  const last = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= last; d++) {
    cells.push({ date: ymd(new Date(year, month, d)), inMonth: true });
  }
  for (let d = 1; cells.length % 7; d++) {
    cells.push({ date: ymd(new Date(year, month + 1, d)), inMonth: false });
  }
  return cells;
}

/** Identifies one follow-up: a company at an event, unique in `lead_states`. */
const keyOf = (i: ScheduleItem) => `${i.event_id}:${i.company_id}`;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * How loud a due date should be.
 *
 * The point of the schedule is what to do next, so nearness is the signal:
 * overdue and today shout, this week speaks, and anything past a month
 * recedes. Faint rather than absent — a distant follow-up still has to be
 * readable, so the colour changes and the contrast does not collapse.
 */
function urgency(daysUntil: number) {
  if (daysUntil < 0) return { card: 'border-amber-600/70 dark:border-amber-400/70 bg-amber-500/15 dark:bg-amber-400/15', day: 'text-amber-700 dark:text-amber-300', month: 'text-amber-700/90 dark:text-amber-400/90' };
  if (daysUntil === 0) return { card: 'border-primary bg-primary/20', day: 'text-primary', month: 'text-primary' };
  if (daysUntil <= 7) return { card: 'border-primary/60 bg-primary/10', day: 'text-foreground', month: 'text-primary' };
  if (daysUntil <= 30) return { card: 'border-border bg-secondary/60', day: 'text-foreground', month: 'text-muted-foreground' };
  return { card: 'border-border/60 bg-secondary/30', day: 'text-muted-foreground', month: 'text-muted-foreground' };
}

/** Priority as a colour, so it reads without taking a whole word of space. */
const PRIORITY_CLASS: Record<string, string> = {
  High: 'border-rose-600/60 dark:border-rose-400/60 bg-rose-500/15 dark:bg-rose-400/15 text-rose-700 dark:text-rose-200',
  Med: 'border-amber-600/60 dark:border-amber-400/60 bg-amber-500/15 dark:bg-amber-400/15 text-amber-700 dark:text-amber-200',
  Low: 'border-border bg-secondary text-muted-foreground',
};

/**
 * Priority on a calendar chip, as a stripe.
 *
 * A chip is 18px tall and holds a truncated company name; a badge would not
 * fit and a word would eat the name. A left edge costs 2px and no height.
 */
const PRIORITY_EDGE: Record<string, string> = {
  High: 'border-l-2 border-l-rose-600 dark:border-l-rose-400',
  Med: 'border-l-2 border-l-amber-600 dark:border-l-amber-400',
  Low: 'border-l-2 border-l-border',
};

const CONTACT_STATE: Record<string, { label: string; className: string }> = {
  replied: { label: 'Replied', className: 'text-emerald-700 dark:text-emerald-300' },
  awaiting: { label: 'Awaiting reply', className: 'text-sky-700 dark:text-sky-300' },
  not_contacted: { label: 'Not contacted', className: 'text-muted-foreground' },
};

/**
 * The due date as a small card: day large, month beneath.
 *
 * Replaces a monospaced `2026-09-29`. That was precise and unreadable at a
 * glance — scanning thirty of them meant reading thirty ten-character strings
 * to find the one that mattered.
 */
function DateCard({ date, daysUntil }: { date: string; daysUntil: number }) {
  const tone = urgency(daysUntil);
  const month = MONTH_ABBR[Number(date.slice(5, 7)) - 1];
  const year = date.slice(0, 4);
  const thisYear = todayYmd().slice(0, 4);
  return (
    <span
      // The full date stays available, since the card drops the year when it
      // is the current one and that is exactly what you would want to check.
      title={date}
      className={cn(
        'flex w-[38px] shrink-0 flex-col items-center justify-center gap-0.5 self-stretch rounded-md border px-1 py-2 leading-none',
        tone.card,
      )}
    >
      <span className={cn('text-[17px] font-bold tabular-nums', tone.day)}>
        {Number(date.slice(8, 10))}
      </span>
      <span className={cn('text-[9.5px] font-medium uppercase tracking-wide', tone.month)}>
        {month}
      </span>
      {year !== thisYear && (
        <span className="text-[8.5px] leading-none text-muted-foreground">{year}</span>
      )}
    </span>
  );
}

/**
 * Drag and drop is native HTML5 rather than a library.
 *
 * The drop targets are static day cells and the payload is one row, so there is
 * nothing here that `dnd-kit` would earn its bundle for. What native DnD does
 * not give is keyboard or touch operation — so it stays an accelerator, and the
 * editor (click an item, set the date, save) remains the way that works
 * without a mouse.
 */
type Drag = { item: ScheduleItem; from: string } | null;

/**
 * Shared by the list rows and the calendar chips.
 *
 * The item is three targets in one, so each gets its own element rather than
 * being inferred from where you clicked:
 *
 *   click    open the company
 *   pencil   edit the follow-up
 *   drag     move it to another day
 *
 * A wrapping element rather than one big `<button>`, because the pencil is a
 * button too and nesting buttons is invalid HTML — the browser is free to drop
 * the inner one, and screen readers do not announce it.
 */
// p-1.5 rather than p-1: a 14px icon with p-1 gives a 22px target, under the
// 24x24 minimum. The calendar chip's pencil cannot meet that — the whole chip
// is 18px tall — which is part of why the same edit is always available at full
// size in the list beside it.
const EDIT_CLASS =
  'shrink-0 cursor-pointer rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-primary';

/** Module scope: declared inside the component this remounts on every render. */
function Row({
  item, owners, onEdit, onOpenCompany, onDragStart, onDragEnd, dragging,
}: {
  item: ScheduleItem;
  owners: Owner[];
  onEdit: (i: ScheduleItem) => void;
  onOpenCompany: (i: ScheduleItem) => void;
  onDragStart: (e: React.DragEvent, i: ScheduleItem) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      onDragEnd={onDragEnd}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border border-border bg-secondary/40 pl-2.5 pr-1 hover:border-primary hover:bg-secondary',
        dragging && 'opacity-40',
      )}
    >
    <button
      type="button"
      onClick={() => onOpenCompany(item)}
      title={`Open ${item.company_name} — or drag onto a day to move this follow-up`}
      className="flex min-w-0 flex-1 cursor-grab items-stretch gap-2.5 py-1.5 text-left active:cursor-grabbing"
    >
      <DateCard date={item.next_action_on} daysUntil={item.days_until} />

      {/* Two lines: who and what on top, then the standing facts about the
          company. Priority and relationship are company-wide and rarely
          change, so they sit on the second line rather than competing with
          the name. */}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[12.5px] font-medium text-foreground">
            {item.company_name}
          </span>
          <PartnerMark lead={item} />
          <ReachMark lead={item} />
          {item.priority && (
            <span className={cn('shrink-0 rounded border px-1 text-[9.5px] font-semibold uppercase leading-[15px] tracking-wide',
              PRIORITY_CLASS[item.priority])}>
              {item.priority}
            </span>
          )}
          {item.hidden && (
            <EyeOff aria-label="Company hidden by a correction"
              className="size-3 shrink-0 text-amber-700 dark:text-amber-400" />
          )}
        </span>
        <span className="block truncate text-[11.5px] text-muted-foreground">
          {item.next_action || 'No action described'}
        </span>
        {/* Enough to hold a conversation at the stand without opening the
            panel. Ordered by what you need first on a show floor: where they
            are, what they do, how big, then where the relationship stands. */}
        <span className="flex flex-wrap items-center gap-x-1.5 text-[10.5px] leading-4">
          {(item.booths ?? []).length > 0 && (
            <span
              className="inline-flex items-center gap-0.5 rounded border border-primary/50 bg-primary/10 px-1 font-mono text-[10px] text-primary"
              title={[(item.zones ?? []).join(', '), 'Stand'].filter(Boolean).join(' · ')}
            >
              <Landmark aria-hidden className="size-2.5" />
              {(item.booths ?? []).join(', ')}
            </span>
          )}
          {item.category_label && (
            <span className={cn('truncate rounded border px-1',
              categoryClass(item.category_key, item.category_group))}>
              {item.category_label}
            </span>
          )}
          {(item.hq_country || item.reach) && (
            <span className="truncate text-muted-foreground">
              {[item.hq_country, item.reach === 'Unknown' ? null : item.reach]
                .filter(Boolean).join(' · ')}
            </span>
          )}
          {typeof item.apollo_employees === 'number' && (
            <span className="text-muted-foreground" title="Employees, from firmographics">
              {item.apollo_employees.toLocaleString()} staff
            </span>
          )}
          {item.company_status_label && (
            <span
              className="truncate"
              style={{ color: statusInk(item.company_status_color) }}
            >
              {item.company_status_label}
            </span>
          )}
          <span className={CONTACT_STATE[item.contact_state].className}>
            {CONTACT_STATE[item.contact_state].label}
          </span>
          {/* Only when it is a problem. "Has an email" is the normal case and
              saying so on every row would be noise. */}
          {!item.has_email && (
            <span className="text-amber-700 dark:text-amber-400" title="No deliverable address on file — this is a research task, not outreach">
              no email
            </span>
          )}
          <span className="truncate text-muted-foreground">{item.event_name}</span>
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {item.event_status_label && (
          <span className="text-[11px]" style={{ color: statusInk(item.status_color) }}>
            {item.event_status_label}
          </span>
        )}
        {item.owner && (
          // The stored value is an email; show the account's display name when
          // it has one, and the raw address when it does not.
          <span
            title={item.owner}
            // Hidden on a phone: it is your own queue, the owner filter
            // above already scopes it, and an email address is the widest
            // thing on the card.
            className="hidden max-w-[130px] truncate rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground sm:block"
          >
            {ownerLabel(item.owner, owners)}
          </span>
        )}
      </span>
    </button>
      <button
        type="button"
        onClick={() => onEdit(item)}
        aria-label={`Edit the follow-up for ${item.company_name}`}
        title="Edit this follow-up"
        className={EDIT_CLASS}
      >
        <Pencil aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

/** Sentinel for "no owner set", which is a real thing to filter for. */
const UNASSIGNED = '\u0000unassigned';

export function ScheduleView({
  items, owners, loadError, onEdit, onOpenCompany, onReschedule,
  industry = [], onDismissIndustry, onOpenEvent,
}: {
  items: ScheduleItem[];
  owners: Owner[];
  /** Set when `schedule_board` could not be read at all. */
  loadError: string | null;
  onEdit: (item: ScheduleItem) => void;
  /** Opens the company panel over this view, without changing tab or event. */
  onOpenCompany: (eventId: string, companyId: string) => void;
  onReschedule: (item: ScheduleItem, date: string) => void;
  /**
   * igamingcalendar listings, drawn behind the follow-ups as context.
   *
   * Defaulted, so a caller that has not loaded them yet — or a failed
   * `industry_calendar` read — degrades to the schedule as it was rather than
   * taking the view down. This overlay is never the reason you cannot see
   * what you owe someone.
   */
  industry?: IndustryEvent[];
  onDismissIndustry?: (e: IndustryEvent, dismissed: boolean) => void;
  onOpenEvent?: (eventId: string) => void;
}) {
  const today = todayYmd();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [showHidden, setShowHidden] = useState(false);
  const [owner, setOwner] = useState<string | null>(null);
  /**
   * Date order reads the schedule; booth order walks the hall.
   *
   * At a show the question is not "what is due first" but "what is near me",
   * and thirty-six stands in date order is thirty-six trips across the floor.
   */
  const [byBooth, setByBooth] = useState(false);
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<string | null>(null);

  /**
   * How tall a day cell is, so the chip cap can follow it.
   *
   * Measured rather than computed from a breakpoint: the calendar shares a row
   * with the list and its width depends on the window, the resizable filter
   * rail and whether the row has wrapped. A ResizeObserver is the only thing
   * that knows all three.
   *
   * A **ref callback**, not `useEffect` over a ref. The grid is not in the tree
   * on mount — until the first fetch returns, the empty state is showing — so a
   * mount effect found `ref.current === null`, returned early and never
   * observed anything. Every cell then rendered the fallback cap of three
   * chips forever, which is exactly the bug this code exists to avoid and
   * looked completely plausible. A ref callback fires when the node actually
   * arrives. `useCallback` keeps it stable, or React would tear the observer
   * down and rebuild it on every render.
   */
  const [cell, setCell] = useState(0);
  /**
   * Width the grid is allowed, so six square weeks fit the window.
   *
   * Height cannot be capped independently: the cells are square, so width *is*
   * height. At 70% of a wide window that made the grid ~1500px tall and the
   * last weeks went off screen. So the height budget is converted back into a
   * width, and the smaller of that and 70% wins.
   */
  const [capWidth, setCapWidth] = useState<number | null>(null);

  /**
   * The grid is now a weekday row plus one positioned row per week, rather than
   * one flat 7xN grid — a band has to span cells, so each week needs its own
   * containing block to lay an overlay over.
   *
   * So the row count comes from the weeks container's child count, not from
   * `(children - 7) / 7`. That old arithmetic would read 6 weeks as
   * `(2 - 7) / 7` and clamp to 1, giving a cap width six times too large.
   */
  const measure = useCallback((outer: HTMLDivElement) => {
    const [dowRow, weeksBox] = [...outer.children] as HTMLElement[];
    const rows = Math.max(1, weeksBox?.childElementCount ?? 1);
    const dow = dowRow?.getBoundingClientRect().height ?? 0;
    const room = window.innerHeight - outer.getBoundingClientRect().top
      - dow - GAP - BOTTOM;
    const perCell = (room - (rows - 1) * GAP) / rows;
    setCapWidth(Math.max(MIN_GRID, Math.floor(perCell * 7 + 6 * GAP)));
    setCell((outer.getBoundingClientRect().width - 6 * GAP) / 7);
  }, []);

  const gridRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    // Observing the grid covers both jobs: the window resizing, the filter rail
    // being dragged, and the cap itself being applied all change its box, and
    // the second pass is what reads the width back after the cap lands.
    const ro = new ResizeObserver(() => measure(el));
    ro.observe(el);
    const onResize = () => measure(el);
    window.addEventListener('resize', onResize);
    return () => { ro.disconnect(); window.removeEventListener('resize', onResize); };
  }, [measure]);

  /** Chips that fit without a "+N more" line, and with one. */
  const room = cell ? Math.max(0, cell - PAD - BORDER - HEAD - SAFETY) : 0;
  const fitsAll = cell ? Math.max(1, Math.floor(room / CHIP)) : FALLBACK_CHIPS;
  const fitsWithMore = cell
    ? Math.max(1, Math.floor((room - MORE) / CHIP)) : FALLBACK_CHIPS;

  const onDragStart = (e: React.DragEvent, item: ScheduleItem) => {
    // Chrome will not start a drag unless some data is set, even when the
    // payload is only ever read from state.
    e.dataTransfer.setData('text/plain', keyOf(item));
    e.dataTransfer.effectAllowed = 'move';
    setDrag({ item, from: item.next_action_on });
  };
  const endDrag = () => { setDrag(null); setOver(null); };
  const openCompany = (i: ScheduleItem) => onOpenCompany(i.event_id, i.company_id);

  const dropOn = (day: string) => {
    const d = drag;
    endDrag();
    if (!d || day === d.from) return;   // dropped back where it started
    onReschedule(d.item, day);
  };

  /**
   * Hidden companies are counted, not silently dropped.
   *
   * A company can be hidden by a correction after a follow-up was already
   * scheduled. Filtering those out of the view would mean a dated commitment
   * disappearing with no trace, which is the sort of thing you find out about
   * from the other side. So they are excluded from the counts but the number is
   * on screen, and one click brings them back.
   */
  const hiddenCount = useMemo(() => items.filter((i) => i.hidden).length, [items]);

  /**
   * Owners actually present on the schedule, not every account.
   *
   * Offering the full user list would mean options that filter to nothing, and
   * hiding the fact that a value stored here matches no account at all. Anything
   * not in `owners` is listed with its raw value, the same honesty the Owner
   * picker applies.
   */
  const onSchedule = useMemo(() => {
    const seen = new Map<string, number>();
    items.forEach((i) => {
      const k = i.owner?.trim() || UNASSIGNED;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    });
    const label = (k: string) => (k === UNASSIGNED
      ? 'Unassigned'
      : owners.find((o) => o.email === k)?.name ?? k);
    return [...seen.entries()]
      .map(([value, count]) => ({
        value, count, label: label(value),
        known: value === UNASSIGNED || owners.some((o) => o.email === value),
      }))
      .sort((a, b) => (a.value === UNASSIGNED ? 1 : b.value === UNASSIGNED ? -1
        : a.label.localeCompare(b.label)));
  }, [items, owners]);

  const shown = useMemo(() => items.filter((i) => {
    if (!showHidden && i.hidden) return false;
    if (owner === null) return true;
    return (i.owner?.trim() || UNASSIGNED) === owner;
  }), [items, showHidden, owner]);

  const byDay = useMemo(() => {
    const g: Record<string, ScheduleItem[]> = {};
    shown.forEach((i) => { (g[i.next_action_on] ??= []).push(i); });
    return g;
  }, [shown]);

  /** The industry overlay: what is switched on, as bands across the weeks. */
  const { prefs: calendar, update: setCalendar } = useCalendarPrefs();
  /** Transient, like `showHidden` above it — and load-bearing: without a way
   *  back, dismissing a listing was a one-way door. */
  const [showDismissed, setShowDismissed] = useState(false);
  const industryShown = useMemo(
    () => visibleIndustry(industry, calendar, showDismissed),
    [industry, calendar, showDismissed],
  );
  const industryList = useMemo(
    () => upcomingIndustry(industryShown), [industryShown],
  );

  /**
   * Booth codes sort naturally as strings for a hall laid out A1, A2, B1 —
   * but "A10" would land before "A2", so the digits are compared as numbers.
   * Anything without a stand goes last: you cannot walk to it.
   */
  const order = useMemo(() => {
    if (!byBooth) {
      return (a: ScheduleItem, b: ScheduleItem) =>
        a.next_action_on.localeCompare(b.next_action_on);
    }
    const key = (i: ScheduleItem) => (i.booths ?? [])[0] ?? '';
    return (a: ScheduleItem, b: ScheduleItem) => {
      const x = key(a); const y = key(b);
      if (!x !== !y) return x ? -1 : 1;
      return x.localeCompare(y, undefined, { numeric: true });
    };
  }, [byBooth]);

  const overdue = useMemo(
    () => shown.filter((i) => i.next_action_on < today).sort(order),
    [shown, today, order],
  );
  const upcoming = useMemo(
    () => shown.filter((i) => i.next_action_on >= today).sort(order),
    [shown, today, order],
  );

  const grid = monthGrid(cursor.y, cursor.m);
  const monthPrefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
  const inMonth = shown.filter((i) => i.next_action_on.startsWith(monthPrefix)).length;

  const step = (n: number) => setCursor(({ y, m }) => {
    const d = new Date(y, m + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays aria-hidden className="size-3.5" />
          {shown.length} scheduled{owner !== null && ` of ${items.length}`}
        </span>
        {overdue.length > 0 && (
          <span className="flex items-center gap-1.5 rounded border border-l-[3px] border-border border-l-amber-600 dark:border-l-amber-400 bg-secondary/60 px-2 py-0.5 text-[11.5px] text-foreground">
            <AlertTriangle aria-hidden className="size-3.5 text-amber-700 dark:text-amber-400" />
            {overdue.length} overdue
          </span>
        )}
        {hiddenCount > 0 && (
          <button
            type="button" onClick={() => setShowHidden((v) => !v)}
            aria-pressed={showHidden}
            className="flex items-center gap-1.5 rounded border border-border bg-secondary/40 px-2 py-0.5 text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            <EyeOff aria-hidden className="size-3.5" />
            {hiddenCount} on hidden{' '}
            {hiddenCount === 1 ? 'company' : 'companies'} — {showHidden ? 'hide' : 'show'}
          </button>
        )}
        {onSchedule.length > 1 && (
          <span className="flex items-center gap-1.5">
            <User aria-hidden className="size-3.5 text-muted-foreground" />
            <select
              aria-label="Filter by owner"
              value={owner ?? ''}
              onChange={(e) => setOwner(e.target.value || null)}
              className="cursor-pointer rounded-md border border-border bg-secondary/40 py-0.5 pl-1.5 pr-5 text-[11.5px] text-foreground hover:border-muted-foreground focus:border-ring focus:outline-none [&>option]:bg-popover [&>option]:text-popover-foreground"
            >
              <option value="">Everyone ({items.length})</option>
              {onSchedule.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}{o.known ? '' : ' — not an account'} ({o.count})
                </option>
              ))}
            </select>
          </span>
        )}
        {industry.length > 0 && (
          <IndustryControl
            events={industry} prefs={calendar} update={setCalendar}
            showDismissed={showDismissed} onShowDismissed={setShowDismissed}
          />
        )}
        {/* Sorting is the one control worth a thumb on a show floor. */}
        <button
          type="button"
          onClick={() => setByBooth((v) => !v)}
          aria-pressed={byBooth}
          title={byBooth
            ? 'Sorted by stand — the order to walk them in'
            : 'Sorted by date — the order they fall due'}
          className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-[11.5px] text-muted-foreground hover:text-foreground"
        >
          <ArrowDownUp aria-hidden className="size-3.5" />
          {byBooth ? 'By stand' : 'By date'}
        </button>
        <span className="ml-auto hidden text-[11.5px] text-muted-foreground lg:inline">
          {drag
            ? `Drop ${drag.item.company_name} on a day to move it`
            : 'Click to open the company · pencil to edit · drag to another day'}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loadError ? (
          <div className="mx-auto max-w-lg space-y-3 pt-10 text-center">
            <p className="font-medium text-amber-700 dark:text-amber-300">The schedule could not be loaded</p>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">{loadError}</p>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              This is not the same as having nothing scheduled. Follow-ups you
              have set are still in the database.
            </p>
          </div>
        // Both empty, not just the follow-ups: with industry events on and
        // nothing due, the grid must still render. It used to short-circuit
        // here, which also meant the grid was absent from the tree on mount —
        // the exact condition that left the ResizeObserver unattached and
        // every cell stuck on the fallback chip cap.
        ) : shown.length === 0 && industryShown.length === 0 ? (
          <div className="mx-auto max-w-lg space-y-3 pt-10 text-center">
            <p className="font-medium text-foreground">
              {owner !== null ? 'Nothing scheduled for this owner' : 'Nothing scheduled'}
            </p>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {owner !== null
                ? `${items.length} follow-up${items.length === 1 ? '' : 's'} exist for other owners — switch back to Everyone to see them.`
                : 'Set Next action and a date on a company and it appears here, across every event. Until then the pipeline records where a lead is but never when it moves again.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            {/* 70% of the row, with the list taking the rest.
                `basis-[70%] grow-0` rather than `max-w-[70%]`: both sections
                have `flex-1`, so free space is split evenly and a max-width of
                70% would never bind — each would settle at 50%. Shrink stays
                on, so the list's 340px floor can still claw width back, and
                `flex-wrap` on the parent stacks them when neither fits. */}
            {/* Hidden below lg. At 390px a cell is 42px and holds one chip,
                which is a grid you cannot read and cannot drop onto — drag is
                pointer-only anyway. The list beside it is the phone view. */}
            <section className="hidden min-w-[320px] grow-0 basis-[70%] lg:block">
              <header className="mb-2 flex items-center gap-2">
                <Button variant="outline" size="sm" className="size-7 p-0"
                  aria-label="Previous month" onClick={() => step(-1)}>
                  <ChevronLeft className="size-3.5" />
                </Button>
                <h3 className="text-[12.5px] font-semibold text-foreground">
                  {MONTHS[cursor.m]} {cursor.y}
                </h3>
                <Button variant="outline" size="sm" className="size-7 p-0"
                  aria-label="Next month" onClick={() => step(1)}>
                  <ChevronRight className="size-3.5" />
                </Button>
                <span className="text-[11.5px] text-muted-foreground">
                  {inMonth} this month
                </span>
              </header>

              <div
                ref={gridRef}
                style={capWidth ? { maxWidth: capWidth } : undefined}
              >
                <div className="grid grid-cols-7 gap-1">
                  {DOW.map((d) => (
                    <div key={d} className="pb-1 text-center text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {d}
                    </div>
                  ))}
                </div>
                {/* One positioned row per week. A band spans days, so it needs
                    a containing block that is exactly one week wide — there is
                    no way to draw a single rectangle across a line break. */}
                <div className="flex flex-col gap-1">
                {weeksOf(grid).map((week) => {
                  const dates = week.map((c) => c.date);
                  const { bands, lanes: wantLanes } = weekBands(industryShown, dates);
                  /**
                   * Bands are drawn over the cells, and the cells are
                   * `overflow-hidden`, so every lane has to be *reserved* out
                   * of the measured chip budget. An unreserved lane would sit
                   * on top of a follow-up and hide it without trace — the same
                   * silent clip this file already documents.
                   *
                   * At least one chip row is always left for follow-ups: they
                   * are what this view is for, and a week with five
                   * conferences must not be able to swallow the queue.
                   */
                  const lanes = Math.min(wantLanes, Math.max(0, fitsAll - 1));
                  return (
                  <div key={dates[0]} className="relative grid grid-cols-7 gap-1">
                {week.map(({ date, inMonth }) => {
                  const hits = byDay[date] ?? [];
                  const isToday = date === today;
                  const isPast = date < today;
                  // Never the day it already sits on — highlighting that would
                  // promise a move that does nothing.
                  const target = Boolean(drag && date !== drag.from);
                  // The lanes come off the top of the budget, whether or not a
                  // band crosses this particular day: the reservation has to be
                  // uniform across the week or the bands would not line up.
                  //
                  // Converted through LANE/CHIP rather than assumed 1:1. They
                  // are equal today, and a band lane growing taller than a chip
                  // would otherwise under-reserve and start hiding follow-ups.
                  const laneRows = Math.ceil((lanes * LANE) / CHIP);
                  const avail = Math.max(0, fitsAll - laneRows);
                  const availMore = Math.max(0, fitsWithMore - laneRows);
                  const shown = hits.length <= avail ? hits.length : availMore;
                  // Bands dropped for want of a lane are still counted, so the
                  // cell never quietly under-reports what it is holding.
                  const lostBands = bands.filter(
                    (b) => b.lane >= lanes
                      && b.startCol <= dates.indexOf(date) + 1
                      && b.endCol >= dates.indexOf(date) + 1,
                  ).length;
                  const clipped = hits.length - shown + lostBands;
                  return (
                    <div
                      key={date}
                      onDragOver={(e) => {
                        if (!target) return;
                        // Without preventDefault the browser refuses the drop.
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        // Identical value: React bails out, so the flood of
                        // dragover events does not cause a flood of renders.
                        setOver(date);
                      }}
                      onDragLeave={() => setOver((o) => (o === date ? null : o))}
                      onDrop={(e) => { if (!target) return; e.preventDefault(); dropOn(date); }}
                      className={cn(
                        // Square, and clipped: the grid must not be pushed out
                        // of shape by a day with more items than fit. Anything
                        // clipped is still reachable in the list beside it,
                        // which is what "+N more, in the list" points at.
                        'aspect-square overflow-hidden rounded-md border p-1',
                        // This month reads as active; the neighbouring months
                        // recede. The difference is in the cell's own fill and
                        // border, not in dimming the text — see the day number
                        // below.
                        inMonth
                          ? 'border-border bg-secondary/30'
                          : 'border-border/40 bg-transparent',
                        // Today is marked, not filled. A wash here looked like
                        // a selected cell rather than a date.
                        isToday && 'border-primary',
                        target && 'border-dashed border-muted-foreground',
                        over === date && 'border-solid border-primary bg-primary/15',
                      )}
                    >
                      {/* Adjacent-month numbers stay on the muted token rather
                          than being faded with an opacity modifier, which would
                          drop them below AA (muted/70 measures 3.28:1). The
                          month you are looking at is brightened instead. */}
                      <div className={cn('mb-0.5 flex items-baseline gap-1 text-[11px]',
                        isToday ? 'font-semibold text-primary'
                          : inMonth ? 'text-foreground' : 'text-muted-foreground')}>
                        {Number(date.slice(-2))}
                        {over === date && (
                          <span className="text-[10px] font-normal text-primary">
                            drop to move
                          </span>
                        )}
                      </div>
                      {/* Holds the room the band layer occupies above the
                          chips. The bands are absolutely positioned, so
                          without this the first follow-up would render
                          underneath one and be invisible in a clipped cell. */}
                      {laneRows > 0 && (
                        <div aria-hidden style={{ height: laneRows * CHIP }} />
                      )}
                      {hits.slice(0, shown).map((i) => (
                        <span
                          key={keyOf(i)}
                          draggable
                          onDragStart={(e) => onDragStart(e, i)}
                          onDragEnd={endDrag}
                          title={i.priority ? `${i.priority} priority` : undefined}
                          className={cn(
                            'mb-0.5 flex w-full items-center rounded pl-1',
                            isPast
                              ? 'bg-amber-500/15 dark:bg-amber-400/15 hover:bg-amber-500/25 dark:hover:bg-amber-400/25'
                              : 'bg-muted hover:bg-accent',
                            i.priority && PRIORITY_EDGE[i.priority],
                            drag && keyOf(drag.item) === keyOf(i) && 'opacity-40',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => openCompany(i)}
                            title={`${i.company_name} — ${i.next_action ?? 'no action described'}\nClick to open the company, or drag onto another day`}
                            className={cn(
                              'min-w-0 flex-1 cursor-grab truncate py-px text-left text-[10.5px] active:cursor-grabbing',
                              isPast ? 'text-amber-700 dark:text-amber-300' : 'text-foreground',
                            )}
                          >
                            {i.company_name}
                          </button>
                          <button
                            type="button"
                            onClick={() => onEdit(i)}
                            aria-label={`Edit the follow-up for ${i.company_name}`}
                            title="Edit this follow-up"
                            className="shrink-0 cursor-pointer rounded px-0.5 text-muted-foreground hover:text-primary"
                          >
                            <Pencil aria-hidden className="size-2.5" />
                          </button>
                        </span>
                      ))}
                      {/* Not draggable, and deliberately says so — a chip
                          that does not fit the cell has no drag target, and
                          the list beside the calendar is where the rest are
                          reachable. */}
                      {clipped > 0 && (
                        <span className="block px-1 text-[10px] leading-[13px] text-muted-foreground">
                          +{clipped} more, in the list
                        </span>
                      )}
                    </div>
                  );
                })}
                    {/* Last, so it paints over the cells rather than under
                        them. The layer itself is pointer-events-none, so the
                        gaps between bands stay transparent to the day cells'
                        drop targets — otherwise dragging a follow-up onto a
                        week with a conference in it would silently fail. */}
                    <IndustryBands
                      bands={bands.filter((b) => b.lane < lanes)} lanes={lanes}
                      dragging={Boolean(drag)}
                    />
                  </div>
                  );
                })}
                </div>
              </div>
            </section>

            <section className="min-w-0 flex-1 space-y-4 lg:min-w-[340px]">
              {/* Above Overdue: which shows are coming is what you read before
                  deciding what the follow-ups are for. Capped, because this
                  list is context and the queue below it is the job. */}
              {industryList.length > 0 && (
                <div>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <CalendarRange aria-hidden className="size-3.5" />
                    Industry events ({industryList.length})
                  </h3>
                  <div className="space-y-1">
                    {industryList.slice(0, 12).map((e) => (
                      <IndustryRow
                        key={e.igc_id} event={e}
                        onDismiss={(ev, d) => onDismissIndustry?.(ev, d)}
                        onOpenEvent={onOpenEvent}
                      />
                    ))}
                  </div>
                  {industryList.length > 12 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Showing the next 12 of {industryList.length}. The calendar
                      has the rest.
                    </p>
                  )}
                </div>
              )}
              {overdue.length > 0 && (
                <div>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    <AlertTriangle aria-hidden className="size-3.5" />
                    Overdue ({overdue.length}){byBooth ? ' · by stand' : ''}
                  </h3>
                  <div className="space-y-1">
                    {overdue.map((i) => (
                      <Row
                        key={keyOf(i)} item={i} owners={owners}
                        onEdit={onEdit} onOpenCompany={openCompany}
                        onDragStart={onDragStart} onDragEnd={endDrag}
                        dragging={Boolean(drag && keyOf(drag.item) === keyOf(i))}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Clock aria-hidden className="size-3.5" />
                  Coming up ({upcoming.length}){byBooth ? ' · by stand' : ''}
                </h3>
                <div className="space-y-1">
                  {upcoming.slice(0, 60).map((i) => (
                    <Row
                      key={keyOf(i)} item={i} owners={owners}
                      onEdit={onEdit} onOpenCompany={openCompany}
                      onDragStart={onDragStart} onDragEnd={endDrag}
                      dragging={Boolean(drag && keyOf(drag.item) === keyOf(i))}
                    />
                  ))}
                </div>
              </div>
              {upcoming.length > 60 && (
                <p className="text-[11.5px] text-muted-foreground">
                  Showing the first 60 of {upcoming.length}. The calendar above
                  has the rest.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
