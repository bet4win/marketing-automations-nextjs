/**
 * Plain calendar dates, as `YYYY-MM-DD` strings.
 *
 * `next_action_on`, `contacted_on` and `replied_on` are Postgres `date`s: no
 * time, no zone. `new Date('2026-09-07')` parses as UTC midnight, which renders
 * as the *previous day* anywhere west of Greenwich, so nothing here ever hands
 * a bare date string to a local-time formatter.
 *
 * The split is deliberate:
 *
 *   today()      what day it is *for the user*, so local fields are read
 *   shift()      arithmetic on a date that has no zone, so UTC is used and the
 *                result is sliced back to a string — a DST boundary cannot
 *                move it
 */

/** Today in the user's own timezone. */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local calendar date of a `Date`, for building month grids. */
export function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** `from` plus `days`. Both are plain dates, so the maths is done in UTC. */
export function shift(from: string, days: number) {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, negative if `to` is earlier. */
export function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}
