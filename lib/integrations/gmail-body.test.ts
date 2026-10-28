import { describe, expect, it } from 'vitest';
import { bodyText, htmlToText, stripQuoted, threadText, type GmailFullMessage } from './gmail-body';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

const message = (id: string, at: number, from: string, text: string): GmailFullMessage => ({
  id,
  internalDate: String(at),
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'From', value: from }, { name: 'To', value: 'gio@bet4.win' },
      { name: 'Date', value: `day ${at}` }, { name: 'Subject', value: 'Re: Sweepstakes lobbies' },
    ],
    parts: [
      { mimeType: 'text/plain', body: { data: b64(text) } },
      { mimeType: 'text/html', body: { data: b64(`<p>${text}</p>`) } },
    ],
  },
});

describe('bodyText', () => {
  it('prefers text/plain and skips attachments', () => {
    expect(bodyText({
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', filename: 'notes.txt', body: { data: b64('attachment') } },
        { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('the body') } }] },
      ],
    })).toBe('the body');
  });

  it('falls back to html as text', () => {
    expect(bodyText({ mimeType: 'text/html', body: { data: b64('<div>Hi&nbsp;Gio<br>Thanks</div><style>x{}</style>') } }))
      .toBe('Hi Gio\nThanks\n');
  });
});

describe('stripQuoted', () => {
  it('cuts Gmail quoting, wrapped or not', () => {
    expect(stripQuoted('Sounds good.\n\nOn Mon, 26 Oct 2026 at 09:42, Gio <gio@bet4.win>\nwrote:\n> earlier')).toBe('Sounds good.');
    expect(stripQuoted('Yes.\nOn Mon, 26 Oct 2026, Gio wrote:\nold')).toBe('Yes.');
  });

  it('cuts an Outlook header block and > lines', () => {
    expect(stripQuoted('Please see the NDA.\n\nFrom: Gio <g@bet4.win>\nSent: Monday\nTo: Alena')).toBe('Please see the NDA.');
    expect(stripQuoted('Top\n> quoted\nBottom')).toBe('Top\nBottom');
  });
});

describe('htmlToText', () => {
  it('decodes numeric entities', () => {
    expect(htmlToText('It&#39;s live')).toBe("It's live");
  });
});

describe('threadText', () => {
  it('orders oldest first and keeps each message once', () => {
    const text = threadText([
      message('b', 2, 'Ana <ana@alea.com>', 'We have no capacity this quarter.\n\nOn Mon, Gio wrote:\n> our pitch'),
      message('a', 1, 'Gio <gio@bet4.win>', 'Our pitch for your sweepstakes lobbies.'),
    ]);
    expect(text.indexOf('Our pitch')).toBeLessThan(text.indexOf('no capacity'));
    expect(text.match(/Our pitch/g)).toHaveLength(1);
    expect(text.startsWith('Subject: Re: Sweepstakes lobbies')).toBe(true);
  });

  it('drops the oldest messages first when the thread is too long', () => {
    const long = 'x'.repeat(3900);
    const msgs = Array.from({ length: 6 }, (_, i) => message(String(i), i, `p${i}@a.com`, `${i} ${long}`));
    const text = threadText(msgs);
    expect(text).toContain('earlier messages left out');
    expect(text).toContain('5 x');
    expect(text).not.toContain('From: p0@a.com');
  });
});
