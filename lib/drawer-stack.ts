import type { Lead, Person } from './types';

/**
 * The navigation stack behind the detail panels.
 *
 * Following a link used to *replace* whatever was open: opening a company from
 * a person threw the person away, and from the People tab it also switched you
 * to the board. So you lost both your place and the thing you had been reading.
 * A stack keeps the trail, and the panels are shown side by side when the
 * window is wide enough to hold them.
 */
export type StackEntry =
  | { kind: 'company'; lead: Lead }
  | { kind: 'person'; person: Person };

/** Identity of an entry, so the same thing is never stacked on itself. */
export function entryKey(e: StackEntry) {
  return e.kind === 'company'
    // Event-qualified: the same company at two events is genuinely two panels,
    // because the pipeline fields differ.
    ? `company:${e.lead.event_id}:${e.lead.company_id}`
    : `person:${e.person.id}`;
}

export function entryTitle(e: StackEntry) {
  return e.kind === 'company' ? e.lead.name : e.person.full_name;
}

/**
 * Deeper than this and the trail is not a trail any more, it is a leak. The
 * oldest entries fall off the bottom; they are still reachable by following
 * the same links again.
 */
export const MAX_DEPTH = 8;

/**
 * Push, unless it is already in the stack — in which case return to it.
 *
 * Without this, A → B → A → B grows without bound and shows the same company
 * twice side by side, which looks like a rendering fault rather than history.
 */
export function pushEntry(stack: StackEntry[], entry: StackEntry): StackEntry[] {
  const key = entryKey(entry);
  const at = stack.findIndex((e) => entryKey(e) === key);
  // Already open: truncate back to it and refresh it, rather than duplicating.
  if (at >= 0) return [...stack.slice(0, at), entry];
  return [...stack, entry].slice(-MAX_DEPTH);
}

/** Widths, newest last. */
export type Widths = number[];

/**
 * How many of the trailing panels can be shown side by side.
 *
 * Always at least one, even if it does not fit — a panel narrower than its own
 * minimum is worse than one that overflows slightly, and the alternative is
 * showing nothing at all.
 */
export function visibleCount(
  widths: Widths, viewport: number, opts: { reserve?: number; fraction?: number } = {},
) {
  // Leave some board visible behind the panels, so it is clear they are laid
  // over a page rather than being the page.
  const budget = viewport * (opts.fraction ?? 0.92) - (opts.reserve ?? 0);
  let total = 0;
  let count = 0;
  for (let i = widths.length - 1; i >= 0; i--) {
    const next = total + widths[i];
    if (count > 0 && next > budget) break;
    total = next;
    count += 1;
  }
  return Math.max(1, count);
}
