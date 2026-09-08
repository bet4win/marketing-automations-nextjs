'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarRange, ExternalLink, EyeOff, Undo2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { today as todayYmd } from '@/lib/dates';
import type { IndustryEvent } from '@/lib/types';

/**
 * The industry calendar, behind the follow-up schedule.
 *
 * These are igamingcalendar.com listings, not `events` rows: context for
 * "should I be there", not shows with a company board. They are read-only
 * here — a conference date is not ours to move — so unlike a follow-up chip
 * there is no drag and no pencil.
 *
 * The one thing a human does to them is dismiss the noise. Of 88 listings a
 * good number are virtual courses and award dinners, and a filter you have to
 * re-apply every month is not a filter.
 */

/** Persisted separately from the board's per-event filters: the schedule spans
 *  every event, and so does this. The `v` is what lets a later default change
 *  be applied once, the same trick `EMPTY_FILTERS` uses for `open`. */
const KEY = 'lanyard.calendar';
const VERSION = 1;

export type CalendarPrefs = {
  /** Whether the overlay is drawn at all. */
  on: boolean;
  /** Category labels the user has switched off. Stored as the excluded set so
   *  a category added upstream shows up by default rather than silently
   *  missing — the opposite choice would hide new kinds of event. */
  off: string[];
};

const DEFAULTS: CalendarPrefs = { on: true, off: [] };

export function useCalendarPrefs() {
  const [prefs, setPrefs] = useState<CalendarPrefs>(DEFAULTS);
  const [ready, setReady] = useState(false);

  // Read in an effect, not in the render body: localStorage does not exist on
  // the server, and reading it during render makes the first client render
  // disagree with the server's.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as CalendarPrefs & { v?: number };
        if (saved.v === VERSION) {
          setPrefs({ on: Boolean(saved.on), off: saved.off ?? [] });
        }
      }
    } catch { /* a corrupt key is not worth a broken view */ }
    setReady(true);
  }, []);

  const update = useCallback((next: Partial<CalendarPrefs>) => {
    setPrefs((prev) => {
      const merged = { ...prev, ...next };
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...merged, v: VERSION }));
      } catch { /* private browsing */ }
      return merged;
    });
  }, []);

  return { prefs, update, ready };
}

export type Band = {
  event: IndustryEvent;
  /** Which stacked row within the week, 0-based. */
  lane: number;
  /** 1-based grid columns, inclusive, clamped to this week. */
  startCol: number;
  endCol: number;
  /** The show began before this week / ends after it. */
  continuesLeft: boolean;
  continuesRight: boolean;
};

/**
 * One week of events, as bands spanning the days they cover.
 *
 * A month grid is seven columns, so a show crossing Sunday into Monday is two
 * bands, one per week — there is no way to draw a single rectangle across a
 * line break. Each week is laid out independently and the `continues` flags
 * carry the join.
 *
 * Lanes are assigned greedily by start date: an event takes the lowest lane
 * whose previous occupant has already finished. That is what stops two
 * overlapping shows drawing on top of each other, and it is stable across
 * renders because the sort is total — start, then longest first, then id, so
 * two events sharing a date cannot swap lanes between renders and make the
 * grid flicker.
 */
export function weekBands(events: IndustryEvent[], week: string[]) {
  const first = week[0];
  const last = week[week.length - 1];
  const overlapping = events
    .filter((e) => e.starts_on <= last && (e.ends_on ?? e.starts_on) >= first)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on)
      || (b.ends_on ?? b.starts_on).localeCompare(a.ends_on ?? a.starts_on)
      || a.igc_id.localeCompare(b.igc_id));

  /** Per lane, the last column it occupies. */
  const laneEnd: number[] = [];
  const bands: Band[] = [];

  overlapping.forEach((event) => {
    const end = event.ends_on ?? event.starts_on;
    const s = week.indexOf(event.starts_on);
    const e = week.indexOf(end);
    const startCol = s === -1 ? 1 : s + 1;
    const endCol = e === -1 ? 7 : e + 1;

    let lane = laneEnd.findIndex((occupiedTo) => occupiedTo < startCol);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = endCol;

    bands.push({
      event, lane, startCol, endCol,
      continuesLeft: event.starts_on < first,
      continuesRight: end > last,
    });
  });

  return { bands, lanes: laneEnd.length };
}

/** Chunk the month grid into weeks of seven. */
export function weeksOf<T>(cells: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
  return out;
}

/**
 * `showDismissed` is not a preference and is deliberately not persisted.
 *
 * Without it this function made dismissing a **one-way door**: the row left
 * the list, so `IndustryRow`'s Restore branch could never render and the flag
 * the view goes out of its way to expose was unreachable. Same shape as the
 * schedule's own "N on hidden companies — show" button, and the same reason.
 */
export function visibleIndustry(
  events: IndustryEvent[], prefs: CalendarPrefs, showDismissed = false,
) {
  if (!prefs.on) return [];
  const off = new Set(prefs.off);
  return events.filter((e) => {
    if (e.dismissed && !showDismissed) return false;
    // An uncategorised event has no category to switch off, so it stays.
    if (e.categories.length === 0) return true;
    return e.categories.some((c) => !off.has(c));
  });
}

/** The height of one band lane, in px. Matches the follow-up chip pitch so a
 *  lane costs the cell exactly one chip's worth of its measured budget. */
export const LANE = 20;

/**
 * Where the band layer starts, measured down from the top of the week row.
 *
 * Bands sit **above** the follow-up chips, under the day number: they are the
 * frame for the day, and a conference is the reason a follow-up is dated where
 * it is. Each cell renders a spacer of the same height so the chips begin
 * below them.
 *
 * The cell is border-box with `border` (1px a side) and `p-1` (4px a side),
 * and the day-number row measures 19px including its `mb-0.5` — so 24. Taken
 * from `getBoundingClientRect`, not read off the Tailwind classes: the last
 * time these were estimated from class names the chip pitch was out by 4px
 * and the cell overflowed silently.
 */
export const BAND_TOP = 1 + 4 + 19;

/**
 * A vibrant colour per event, assigned deterministically from its id.
 *
 * Same idea as `categoryClass` — a fixed palette rather than generated hues, so
 * every colour is one that has actually been looked at against this background.
 * Keyed on `igc_id`, which is stable across renames and refetches, so a show
 * does not change colour when the organiser edits its title.
 *
 * Two strengths of the same ten hues.
 *
 * A show in the desk gets the full-strength fill; a listing gets a tenth of
 * it. Seventeen saturated bands at once was tiring to read and, worse, made
 * the context louder than the follow-up chips underneath — and those are what
 * the view is for. Fading the ones nobody has researched puts the weight back
 * where the work is, and the hue still identifies the show either way.
 *
 * Written out as literal strings, twice, rather than composed from a hue name:
 * Tailwind scans source text for class names, so an interpolated
 * `bg-{hue}-500` would never be generated and every band would come out
 * unstyled.
 *
 * An earlier single palette used a 15% fill with 200-weight text throughout
 * and rendered as ten shades of grey at 10px. Check a screenshot, not the DOM
 * — computed colours differed while nothing looked different.
 *
 * (Careful writing about these class names in a block comment: a literal fill
 * class ends with a hue followed by a slash, which closes the comment and
 * breaks the build. That is exactly how this file failed once.)
 */
const BAND_CLASS = [
  'border-sky-600 dark:border-sky-400 bg-sky-500/30 text-sky-900 dark:text-sky-50',
  'border-violet-600 dark:border-violet-400 bg-violet-500/30 text-violet-900 dark:text-violet-50',
  'border-emerald-600 dark:border-emerald-400 bg-emerald-500/30 text-emerald-900 dark:text-emerald-50',
  'border-fuchsia-600 dark:border-fuchsia-400 bg-fuchsia-500/30 text-fuchsia-900 dark:text-fuchsia-50',
  'border-cyan-600 dark:border-cyan-400 bg-cyan-500/30 text-cyan-900 dark:text-cyan-50',
  'border-orange-600 dark:border-orange-400 bg-orange-500/30 text-orange-900 dark:text-orange-50',
  'border-lime-600 dark:border-lime-400 bg-lime-500/30 text-lime-900 dark:text-lime-50',
  'border-teal-600 dark:border-teal-400 bg-teal-500/30 text-teal-900 dark:text-teal-50',
  'border-indigo-600 dark:border-indigo-400 bg-indigo-500/30 text-indigo-900 dark:text-indigo-50',
  'border-pink-600 dark:border-pink-400 bg-pink-500/30 text-pink-900 dark:text-pink-50',
];

/** The same hues, faded: a listing nobody has researched yet. */
const BAND_CLASS_FADED = [
  'border-sky-600/45 dark:border-sky-400/45 bg-sky-500/10 text-sky-800/90 dark:text-sky-200/90',
  'border-violet-600/45 dark:border-violet-400/45 bg-violet-500/10 text-violet-800/90 dark:text-violet-200/90',
  'border-emerald-600/45 dark:border-emerald-400/45 bg-emerald-500/10 text-emerald-800/90 dark:text-emerald-200/90',
  'border-fuchsia-600/45 dark:border-fuchsia-400/45 bg-fuchsia-500/10 text-fuchsia-800/90 dark:text-fuchsia-200/90',
  'border-cyan-600/45 dark:border-cyan-400/45 bg-cyan-500/10 text-cyan-800/90 dark:text-cyan-200/90',
  'border-orange-600/45 dark:border-orange-400/45 bg-orange-500/10 text-orange-800/90 dark:text-orange-200/90',
  'border-lime-600/45 dark:border-lime-400/45 bg-lime-500/10 text-lime-800/90 dark:text-lime-200/90',
  'border-teal-600/45 dark:border-teal-400/45 bg-teal-500/10 text-teal-800/90 dark:text-teal-200/90',
  'border-indigo-600/45 dark:border-indigo-400/45 bg-indigo-500/10 text-indigo-800/90 dark:text-indigo-200/90',
  'border-pink-600/45 dark:border-pink-400/45 bg-pink-500/10 text-pink-800/90 dark:text-pink-200/90',
];

/**
 * Deliberately not amber and not `primary`.
 *
 * Amber is overdue and `primary` is due-today on this very grid. Reusing
 * either for provenance would make one colour carry two unrelated meanings,
 * which is the mistake the schedule's own notes warn about.
 */
/** The same ten hues at full strength, for a swatch rather than a surface. */
const BAND_DOT = [
  'bg-sky-400', 'bg-violet-400', 'bg-emerald-400', 'bg-fuchsia-400',
  'bg-cyan-400', 'bg-orange-400', 'bg-lime-400', 'bg-teal-400',
  'bg-indigo-400', 'bg-pink-400',
];

function bandIndex(igcId: string) {
  let h = 0;
  for (let i = 0; i < igcId.length; i++) h = (h * 31 + igcId.charCodeAt(i)) | 0;
  return Math.abs(h) % BAND_CLASS.length;
}

export const bandClass = (igcId: string, ours = false) =>
  (ours ? BAND_CLASS : BAND_CLASS_FADED)[bandIndex(igcId)];
/** So a row in the list can be tied to its band on the grid at a glance. */
export const bandDot = (igcId: string) => BAND_DOT[bandIndex(igcId)];

/**
 * The band layer for one week, laid over the day cells.
 *
 * An absolutely positioned grid with the **same** `grid-cols-7` and gap as the
 * cells beneath it, so a band's column span lines up with the days without
 * measuring anything. `gridColumn: start / end + 1` does the spanning and
 * `gridRow` does the stacking.
 *
 * Anchored to `BAND_TOP` — directly under the day number, above the
 * follow-ups. The cells reserve `lanes * LANE` of their chip budget and render
 * a spacer of the same height, which is what keeps this overlay from covering
 * a follow-up: the cell is `overflow-hidden`, so anything it did cover would
 * vanish without trace.
 *
 * `pointer-events-none` on the layer, so the gaps between bands stay
 * transparent to the drop targets underneath. The bands themselves take
 * pointer events only when **nothing is being dragged**: they need them for
 * the tooltip, but a band covers the bottom strip of its cells, and an
 * opaque strip there would refuse a drop on that part of the day — a drag
 * that fails depending on where in the cell you release it is worse than no
 * tooltip.
 */
export function IndustryBands({
  bands, lanes, dragging = false,
}: { bands: Band[]; lanes: number; dragging?: boolean }) {
  if (lanes === 0) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 grid grid-cols-7 gap-x-1 gap-y-px"
      style={{ top: BAND_TOP, gridAutoRows: `${LANE - 2}px` }}
    >
      {bands.map((b) => {
        /**
         * Colour identifies *which* show; solid-versus-dashed says whether it
         * is ours.
         *
         * Two signals rather than one, because they answer different
         * questions: the palette lets you follow one conference across a week
         * of overlapping bands, and the border style says whether its
         * exhibitors are researched. Collapsing them would mean either every
         * listing looking alike or provenance costing a colour.
         */
        const ours = Boolean(b.event.event_id);
        const tint = bandClass(b.event.igc_id, ours);
        return (
          <span
            key={b.event.igc_id}
            style={{
              gridColumnStart: b.startCol,
              gridColumnEnd: b.endCol + 1,
              gridRowStart: b.lane + 1,
            }}
            title={`${b.event.name}\n${b.event.starts_on}${
              b.event.ends_on ? ` to ${b.event.ends_on}` : ''}${
              b.event.location ? `\n${b.event.location}` : ''}${
              ours ? `\nIn the desk — ${b.event.companies_known} companies researched`
                : '\nListing only — exhibitors not researched'}`}
            className={cn(
              'flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap border-y px-1 text-[10px] font-medium leading-[16px]',
              tint,
              // Dashed for a listing, solid for a show whose exhibitors we
              // hold. The tint carries identity either way.
              !ours && 'border-dashed',
              dragging ? 'pointer-events-none' : 'pointer-events-auto',
              // Only the real ends get a cap. A band that continues into the
              // next week must look cut, or a four-day show reads as two.
              b.continuesLeft ? 'pl-0.5' : 'rounded-l border-l',
              b.continuesRight ? 'pr-0.5' : 'rounded-r border-r',
            )}
          >
            {b.continuesLeft && <span className="shrink-0 opacity-60">‹</span>}
            <span className="min-w-0 flex-1 truncate">{b.event.name}</span>
            {ours && (
              <span className="shrink-0 text-[9px] tabular-nums opacity-70">
                {b.event.companies_known}
              </span>
            )}
            {b.continuesRight && <span className="shrink-0 opacity-60">›</span>}
          </span>
        );
      })}
    </div>
  );
}

const DAY = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "29 Sep – 1 Oct", dropping the month when both ends share it. */
function span(e: IndustryEvent) {
  const fmt = (d: string) => `${Number(d.slice(8, 10))} ${DAY[Number(d.slice(5, 7)) - 1]}`;
  if (!e.ends_on || e.ends_on === e.starts_on) return fmt(e.starts_on);
  const sameMonth = e.starts_on.slice(0, 7) === e.ends_on.slice(0, 7);
  return `${sameMonth ? Number(e.starts_on.slice(8, 10)) : fmt(e.starts_on)} – ${fmt(e.ends_on)}`;
}

/**
 * A row in the list beside the calendar.
 *
 * No Promote button. `authenticated` holds only `select` on `events`, so the
 * browser cannot create one — and promotion is not a single write anyway: it
 * needs a per-organiser exhibitor scraper. That is what the `igaming-calendar`
 * skill is for. This row's job is to show whether the work has been done and
 * to hand over the link that starts it.
 */
export function IndustryRow({
  event, onDismiss, onOpenEvent,
}: {
  event: IndustryEvent;
  onDismiss: (e: IndustryEvent, dismissed: boolean) => void;
  onOpenEvent?: (eventId: string) => void;
}) {
  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md border px-2 py-1.5',
      // Same grammar as the calendar band: solid is ours, dashed is a listing.
      event.event_id
        ? 'border-muted-foreground/60 bg-secondary/50'
        : 'border-dashed border-border bg-secondary/20',
      event.dismissed && 'opacity-50',
    )}>
      {/* Ties this row to its band on the grid. */}
      <span aria-hidden
        className={cn('size-2 shrink-0 rounded-full', bandDot(event.igc_id))} />
      <span className="w-[74px] shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
        {span(event)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[12px] text-foreground">{event.name}</span>
          {event.website && (
            <a
              href={event.website} target="_blank" rel="noreferrer noopener"
              title={`Organiser's site — ${event.website}`}
              aria-label={`Open the organiser's site for ${event.name}`}
              className="shrink-0 text-muted-foreground hover:text-primary"
            >
              <ExternalLink aria-hidden className="size-3" />
            </a>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-[10.5px] leading-4 text-muted-foreground">
          {event.location && <span className="truncate">{event.location}</span>}
          {event.categories[0] && (
            <span className="truncate rounded border border-border px-1">
              {event.categories[0]}
            </span>
          )}
          {/* The whole point of matching: this show is already in the desk, so
              its exhibitors are researched and promoting it again would make a
              duplicate. */}
          {event.event_id ? (
            <button
              type="button"
              onClick={() => onOpenEvent?.(event.event_id!)}
              title={`Already in the desk as "${event.event_name}"${
                event.promoted_event_id ? '' : ' — matched by name and dates, not confirmed'}`}
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              <Users aria-hidden className="size-2.5" />
              {event.companies_known} companies known
              {!event.promoted_event_id && <span className="opacity-70">?</span>}
            </button>
          ) : (
            <span className="text-muted-foreground/80">exhibitors not researched</span>
          )}
        </span>
      </span>
      <button
        type="button"
        onClick={() => onDismiss(event, !event.dismissed)}
        aria-pressed={event.dismissed}
        title={event.dismissed
          ? 'Bring this back onto the calendar'
          : 'Hide this listing for everyone — for standing noise like a virtual course'}
        aria-label={event.dismissed ? `Restore ${event.name}` : `Dismiss ${event.name}`}
        className="size-8 shrink-0 cursor-pointer rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {event.dismissed
          ? <Undo2 aria-hidden className="mx-auto size-3.5" />
          : <EyeOff aria-hidden className="mx-auto size-3.5" />}
      </button>
    </div>
  );
}

/**
 * The header control: on/off, and which categories.
 *
 * Categories are listed from what is actually present, with a count each —
 * offering the full published list would mean options that filter to nothing,
 * the same honesty the owner filter applies.
 */
export function IndustryControl({
  events, prefs, update, showDismissed, onShowDismissed,
}: {
  events: IndustryEvent[];
  prefs: CalendarPrefs;
  update: (next: Partial<CalendarPrefs>) => void;
  showDismissed: boolean;
  onShowDismissed: (v: boolean) => void;
}) {
  const present = new Map<string, number>();
  events.filter((e) => !e.dismissed).forEach((e) => {
    e.categories.forEach((c) => present.set(c, (present.get(c) ?? 0) + 1));
  });
  const off = new Set(prefs.off);
  const shown = visibleIndustry(events, prefs, showDismissed).length;
  const dismissed = events.filter((e) => e.dismissed).length;

  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => update({ on: !prefs.on })}
        aria-pressed={prefs.on}
        title={prefs.on
          ? 'Industry events are on the calendar'
          : 'Industry events are hidden'}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11.5px]',
          prefs.on
            ? 'border-muted-foreground/50 bg-secondary/60 text-foreground'
            : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground',
        )}
      >
        <CalendarRange aria-hidden className="size-3.5" />
        {prefs.on ? `${shown} industry` : 'Industry events'}
      </button>

      {prefs.on && present.size > 1 && (
        <select
          aria-label="Industry event categories"
          value=""
          onChange={(e) => {
            const c = e.target.value;
            if (!c) return;
            update({
              off: off.has(c) ? prefs.off.filter((x) => x !== c) : [...prefs.off, c],
            });
          }}
          className="max-w-[190px] cursor-pointer rounded-md border border-border bg-secondary/40 py-0.5 pl-1.5 pr-5 text-[11.5px] text-foreground hover:border-muted-foreground focus:border-ring focus:outline-none [&>option]:bg-popover [&>option]:text-popover-foreground"
        >
          <option value="">
            Categories{prefs.off.length ? ` (${prefs.off.length} off)` : ''}
          </option>
          {[...present.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(
            ([c, n]) => (
              <option key={c} value={c}>
                {off.has(c) ? '☐' : '☑'} {c} ({n})
              </option>
            ),
          )}
        </select>
      )}

      {/* Counted, never silently gone — the rule the schedule already applies
          to hidden companies. Without this, dismissing was a one-way door. */}
      {prefs.on && dismissed > 0 && (
        <button
          type="button"
          onClick={() => onShowDismissed(!showDismissed)}
          aria-pressed={showDismissed}
          className="flex items-center gap-1.5 rounded border border-border bg-secondary/40 px-2 py-0.5 text-[11.5px] text-muted-foreground hover:text-foreground"
        >
          <EyeOff aria-hidden className="size-3.5" />
          {dismissed} dismissed — {showDismissed ? 'hide' : 'show'}
        </button>
      )}
    </span>
  );
}

/**
 * Upcoming only, shows we already work first.
 *
 * A conference last March is not context for this month. And pure date order
 * buried the two that matter: G2E Vegas and SBC Summit Lisbon sit on 28 and 29
 * September, which put them at rows 13 and 14 — past the list's cap — behind a
 * dozen listings nobody has looked at. An event we hold has hundreds of
 * researched companies behind it; a listing has a URL. Those are not peers.
 */
export function upcomingIndustry(events: IndustryEvent[]) {
  const today = todayYmd();
  return events
    .filter((e) => (e.ends_on ?? e.starts_on) >= today)
    .sort((a, b) => Number(Boolean(b.event_id)) - Number(Boolean(a.event_id))
      || a.starts_on.localeCompare(b.starts_on));
}
