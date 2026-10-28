import { describe, expect, it } from 'vitest';
import { assignable, decodeSnippet, parseAddressList, toFiling, type GmailMessage } from './gmail-parse';

const msg = (headers: Record<string, string>, labelIds: string[] = ['INBOX'], extra: Partial<GmailMessage> = {}): GmailMessage => ({
  id: 'g1',
  labelIds,
  snippet: 'Hi Gio, thanks for the deck &amp; the demo',
  internalDate: String(Date.UTC(2026, 9, 27, 9, 30)),
  payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
  ...extra,
});

const ME = 'gnadirashvili@bet4.win';

describe('parseAddressList', () => {
  it('keeps commas inside quoted names', () => {
    expect(parseAddressList('"Doe, Jane" <Jane@X.com>, bob@y.com')).toEqual([
      { address: 'jane@x.com', name: 'Doe, Jane' },
      { address: 'bob@y.com', name: null },
    ]);
  });

  it('drops what is not an address', () => {
    expect(parseAddressList('undisclosed-recipients:;')).toEqual([]);
    expect(parseAddressList(null)).toEqual([]);
  });
});

describe('decodeSnippet', () => {
  it('unescapes and trims to the snippet limit', () => {
    expect(decodeSnippet('It&#39;s &quot;live&quot; &amp; ready')).toBe('It\'s "live" & ready');
    expect(decodeSnippet('x'.repeat(500))).toHaveLength(200);
    expect(decodeSnippet('')).toBeNull();
  });
});

describe('toFiling', () => {
  it('files a reply from them as inbound, by Message-ID', () => {
    const f = toFiling(msg({
      From: 'Natalya Z <natalya@softswiss.com>', To: ME, Subject: 'Re: Sweepstakes', 'Message-ID': '<abc@mail.softswiss.com>',
    }), ME, 'bet4.win');
    expect(f).toMatchObject({
      direction: 'in',
      parties: [{ address: 'natalya@softswiss.com', name: 'Natalya Z' }],
      subject: 'Re: Sweepstakes',
      snippet: 'Hi Gio, thanks for the deck & the demo',
      messageId: 'abc@mail.softswiss.com',
      occurredAt: '2026-10-27T09:30:00.000Z',
      ccOnly: false,
    });
  });

  it('marks an inbound message that only copied us', () => {
    const f = toFiling(msg({ From: 'ahsan@lab.com', To: 'david@bet4.win', Cc: ME }), ME, 'bet4.win');
    expect(f?.ccOnly).toBe(true);
  });

  it('keeps the thread, and leaves cc_only unset on what we sent', () => {
    const f = toFiling(msg({ To: 'a@revolver.games' }, ['SENT'], { threadId: 't9' }), ME, 'bet4.win');
    expect(f).toMatchObject({ threadId: 't9', ccOnly: null });
  });

  it('files what we sent against every outside recipient, not colleagues', () => {
    const f = toFiling(msg({
      From: ME, To: 'a@revolver.games, ceo@bet4.win', Cc: 'engineering@bet4.win, b@upgaming.com, a@revolver.games',
    }, ['SENT']), ME, 'bet4.win');
    expect(f?.direction).toBe('out');
    expect(f?.parties.map((p) => p.address)).toEqual(['a@revolver.games', 'b@upgaming.com']);
  });

  it('skips internal-only mail', () => {
    expect(toFiling(msg({ From: 'ceo@bet4.win', To: ME }), ME, 'bet4.win')).toBeNull();
  });

  it('skips newsletters, auto-replies, no-reply senders and bulk tabs', () => {
    expect(toFiling(msg({ From: 'news@softswiss.com', 'List-Unsubscribe': '<mailto:x>' }), ME, 'bet4.win')).toBeNull();
    expect(toFiling(msg({ From: 'n@softswiss.com', 'Auto-Submitted': 'auto-replied' }), ME, 'bet4.win')).toBeNull();
    expect(toFiling(msg({ From: 'no-reply@softswiss.com' }), ME, 'bet4.win')).toBeNull();
    expect(toFiling(msg({ From: 'n@softswiss.com' }, ['INBOX', 'CATEGORY_PROMOTIONS']), ME, 'bet4.win')).toBeNull();
    expect(toFiling(msg({ From: 'n@softswiss.com' }, ['DRAFT']), ME, 'bet4.win')).toBeNull();
  });

  it('keeps a human reply that says Auto-Submitted: no', () => {
    expect(toFiling(msg({ From: 'n@softswiss.com', 'Auto-Submitted': 'no' }), ME, 'bet4.win')).not.toBeNull();
  });

  it('falls back to the Gmail id without a Message-ID', () => {
    expect(toFiling(msg({ From: 'n@softswiss.com' }), ME, 'bet4.win')?.messageId).toBe('gmail:g1');
  });
});

describe('assignable', () => {
  it('keeps business domains and drops free mail', () => {
    expect(assignable({ address: 'x@newcasino.com', name: null })).toBe(true);
    expect(assignable({ address: 'friend@gmail.com', name: null })).toBe(false);
  });
});
