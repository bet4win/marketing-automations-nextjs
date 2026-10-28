import { describe, expect, it } from 'vitest';
import { lastWordByCompany, noReplyYet, ourThreads, weOweReply } from './messages';

type R = { company_id: string; direction: 'in' | 'out' | null; cc_only: boolean | null; thread_ref: string | null };
const r = (company_id: string, direction: R['direction'], thread_ref: string | null = null, cc_only: boolean | null = null): R =>
  ({ company_id, direction, thread_ref, cc_only });

const rows: R[] = [
  r('edgelabs', 'in', 't1', false),       // the NDA, in our thread
  r('lab', 'in', 't2', true),             // copied on a note to a colleague
  r('giveaway', 'in', 't3', false),       // mail at us, a thread we never wrote in
  r('whatsapp', 'in'),                    // logged by hand, no threads
  r('alea', 'out', 't4'),                 // we answered last
  r('edgelabs', 'out', 't1'),
  r('alea', 'in', 't4', false),
  r('typed', null),                       // a hand-logged email: ours
];

describe('whose turn', () => {
  const last = lastWordByCompany(rows);
  const threads = ourThreads(rows);

  it('takes each company once, at its newest message', () => {
    expect(last.map((x) => x.company_id)).toEqual(['edgelabs', 'lab', 'giveaway', 'whatsapp', 'alea', 'typed']);
  });

  it('owes a reply only to direct messages in our threads, or on threadless channels', () => {
    expect(last.filter((x) => weOweReply(x, threads)).map((x) => x.company_id)).toEqual(['edgelabs', 'whatsapp']);
  });

  it('is waiting on them when ours is the last word, typed emails included', () => {
    expect(last.filter(noReplyYet).map((x) => x.company_id)).toEqual(['alea', 'typed']);
  });
});
