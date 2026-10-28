import { describe, expect, it } from 'vitest';
import { isOutsider, isSpoken, occurredAt, slackText, threadRef } from './slack-parse';

describe('slackText', () => {
  it('turns Slack markup into plain text', () => {
    const names = (id: string) => (id === 'U1' ? 'Hanna' : null);
    expect(slackText('Hi <@U1>, see <https://b4wcdn.com/x?token=DEMO|Sunset Riders> &amp; <https://bet4.win> in <#C9|deals> <!here>', names))
      .toBe('Hi @Hanna, see Sunset Riders & https://bet4.win in #deals @here');
  });

  it('names an unknown mention neutrally, and cuts to a snippet', () => {
    expect(slackText('<@U2> ok')).toBe('@someone ok');
    expect(slackText('x'.repeat(500))).toHaveLength(200);
    expect(slackText('   ')).toBeNull();
  });
});

describe('isSpoken', () => {
  it('keeps people writing, drops bots and housekeeping', () => {
    expect(isSpoken({ ts: '1', user: 'U1', text: 'hi' })).toBe(true);
    expect(isSpoken({ ts: '1', user: 'U1', subtype: 'thread_broadcast' })).toBe(true);
    expect(isSpoken({ ts: '1', user: 'U1', subtype: 'channel_join' })).toBe(false);
    expect(isSpoken({ ts: '1', user: 'U1', bot_id: 'B1' })).toBe(false);
    expect(isSpoken({ ts: '1' })).toBe(false);
  });
});

describe('threadRef', () => {
  it('is the DM itself, or the thread in a channel', () => {
    expect(threadRef({ id: 'D1', is_im: true }, { ts: '5', thread_ts: '3' })).toBe('D1');
    expect(threadRef({ id: 'C1', is_ext_shared: true }, { ts: '5', thread_ts: '3' })).toBe('C1:3');
    expect(threadRef({ id: 'C1', is_ext_shared: true }, { ts: '5' })).toBe('C1:5');
  });
});

describe('isOutsider', () => {
  it('is a live person from another team', () => {
    expect(isOutsider({ id: 'U1', team_id: 'T2' }, 'T1')).toBe(true);
    expect(isOutsider({ id: 'U1', team_id: 'T1' }, 'T1')).toBe(false);
    expect(isOutsider({ id: 'U1', team_id: 'T2', is_bot: true }, 'T1')).toBe(false);
    expect(isOutsider(undefined, 'T1')).toBe(false);
  });
});

describe('occurredAt', () => {
  it('reads Slack timestamps as seconds', () => {
    expect(occurredAt('1700000000.5')).toBe('2023-11-14T22:13:20.500Z');
  });
});
