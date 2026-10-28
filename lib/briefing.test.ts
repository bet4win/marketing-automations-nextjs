import { describe, expect, it } from 'vitest';
import { briefing, type BriefFollowUp } from './briefing';

const f = (company_name: string, next_action_on: string): BriefFollowUp =>
  ({ company_id: company_name.toLowerCase(), company_name, next_action: 'Follow up', next_action_on, contact_name: null });

describe('briefing', () => {
  const b = briefing({
    today: '2026-10-28',
    followUps: [f('Today', '2026-10-28'), f('Late', '2026-10-25'), f('Soon', '2026-11-02'), f('Later', '2026-11-30')],
    owed: [
      { company_id: 'alea', company_name: 'Alea', subject: 'Re: lobbies', met_name: 'Ana', occurred_at: '2026-10-26T10:00:00Z' },
      { company_id: 'edgelabs', company_name: 'EdgeLabs', subject: 'Re: NDA', met_name: 'Alena', occurred_at: '2026-10-27T15:00:00Z' },
    ],
  });

  it('puts due and overdue first, the longest overdue on top', () => {
    expect(b.due.map((d) => [d.company_name, d.late])).toEqual([['Late', 3], ['Today', 0]]);
  });

  it('keeps the coming week and drops what is further out', () => {
    expect(b.soon.map((s) => [s.company_name, s.in])).toEqual([['Soon', 5]]);
  });

  it('lists replies owed, the longest wait first', () => {
    expect(b.owed.map((o) => [o.company_name, o.days])).toEqual([['Alea', 2], ['EdgeLabs', 1]]);
  });

  it('counts what needs doing today', () => {
    expect(b.count).toBe(4);
  });
});

describe('todayIn', () => {
  it('reads the date on the user\'s wall clock', async () => {
    const { todayIn } = await import('./dates');
    const at = new Date('2026-10-28T05:30:00Z');
    expect(todayIn('Asia/Tbilisi', at)).toBe('2026-10-28');
    expect(todayIn('Pacific/Honolulu', at)).toBe('2026-10-27');
  });
});
