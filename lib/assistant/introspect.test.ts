import { describe, expect, it } from 'vitest';
import { formatSchema } from './introspect';

describe('formatSchema', () => {
  it('lists each relation with its kind, comment, typed columns and column comments', () => {
    const text = formatSchema([
      {
        relation: 'next_follow_ups',
        kind: 'view',
        description: 'schedule_board plus who each follow-up is with.',
        columns: [
          { name: 'company_name', type: 'text', comment: null },
          { name: 'next_action_on', type: 'date', comment: null },
          { name: 'last_touch_at', type: 'timestamp with time zone', comment: 'When we last spoke.' },
        ],
      },
      { relation: 'events', kind: 'table', description: null, columns: [{ name: 'starts_on', type: 'date', comment: null }] },
    ]);
    expect(text).toBe(
      [
        'next_follow_ups (view): schedule_board plus who each follow-up is with.',
        '  company_name text, next_action_on date, last_touch_at timestamptz',
        '  · last_touch_at: When we last spoke.',
        'events (table)',
        '  starts_on date',
      ].join('\n'),
    );
  });

  it('keeps a long comment to one line, cut at a word', () => {
    const long = `${'word '.repeat(100)}end`;
    const text = formatSchema([{ relation: 'x', kind: 'view', description: long, columns: [] }]);
    const head = text.split('\n')[0]!;
    expect(head.length).toBeLessThan(260);
    expect(head.endsWith('…')).toBe(true);
  });
});
