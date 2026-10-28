import type { Activity } from './types';

/**
 * Whose turn it is in each company's conversation. One rule for the Messages
 * tab and for the query the assistant is shown, so they cannot disagree.
 *
 * - We owe a reply: their message is the last word, it was addressed to us
 *   rather than copying us, and it is in a thread we wrote in (or on a channel
 *   with no threads, where someone logged it by hand). Without the last two, a
 *   giveaway confirmation or an internal forward we were copied on reads as a
 *   question waiting for us.
 * - No reply yet: our message is the last word.
 */

/** A typed email has no direction; logging one means we sent it. */
export const directionOf = (a: Pick<Activity, 'direction'>) => a.direction ?? 'out';

/** Each company's latest message, from rows ordered newest first. */
export function lastWordByCompany<T extends Pick<Activity, 'company_id'>>(newestFirst: T[]): T[] {
  const last = new Map<string, T>();
  for (const r of newestFirst) if (!last.has(r.company_id)) last.set(r.company_id, r);
  return [...last.values()];
}

type Row = Pick<Activity, 'company_id' | 'direction' | 'cc_only' | 'thread_ref'>;

/** The threads we wrote in. */
export const ourThreads = (rows: Row[]) =>
  new Set(rows.filter((r) => directionOf(r) === 'out' && r.thread_ref).map((r) => r.thread_ref!));

export function weOweReply(last: Row, threads: Set<string>): boolean {
  return directionOf(last) === 'in' && !last.cc_only && (!last.thread_ref || threads.has(last.thread_ref));
}

export const noReplyYet = (last: Row) => directionOf(last) === 'out';
