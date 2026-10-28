import { daysBetween } from './dates';

/**
 * Today's briefing: what is due, what we owe an answer to, and what is coming
 * this week. Pure, so its cut-offs are tested; the board shows it on the
 * first visit of the day (components/briefing.tsx).
 */

export interface BriefFollowUp {
  company_id: string;
  company_name: string;
  next_action: string | null;
  next_action_on: string;
  contact_name: string | null;
}

export interface BriefOwed {
  company_id: string;
  company_name: string;
  subject: string | null;
  met_name: string | null;
  occurred_at: string;
}

export interface Briefing {
  /** Due today or earlier, the longest overdue first; `late` is days overdue. */
  due: (BriefFollowUp & { late: number })[];
  /** Replies we owe, the longest wait first; `days` since they wrote. */
  owed: (BriefOwed & { days: number })[];
  /** Due in the next seven days. */
  soon: (BriefFollowUp & { in: number })[];
  /** What needs the user today: due plus owed. */
  count: number;
}

export function briefing(input: { today: string; followUps: BriefFollowUp[]; owed: BriefOwed[] }): Briefing {
  const byDate = (a: BriefFollowUp, b: BriefFollowUp) => a.next_action_on.localeCompare(b.next_action_on);
  const due = input.followUps
    .filter((f) => f.next_action_on <= input.today)
    .sort(byDate)
    .map((f) => ({ ...f, late: daysBetween(f.next_action_on, input.today) }));
  const soon = input.followUps
    .map((f) => ({ ...f, in: daysBetween(input.today, f.next_action_on) }))
    .filter((f) => f.in > 0 && f.in <= 7)
    .sort(byDate);
  const owed = [...input.owed]
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .map((o) => ({ ...o, days: Math.max(0, daysBetween(o.occurred_at.slice(0, 10), input.today)) }));
  return { due, owed, soon, count: due.length + owed.length };
}
