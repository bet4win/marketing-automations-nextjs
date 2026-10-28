import { describe, expect, it } from 'vitest';
import { bodyHtml, bodyPlain, draftRaw, encodeHeader, replySubject } from './gmail-draft';

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');
const partText = (mime: string, type: string) => {
  const block = mime.split('--lanyard-test').find((b) => b.includes(`Content-Type: ${type}`))!;
  return Buffer.from(block.split('\r\n\r\n')[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8');
};

describe('bodyHtml', () => {
  it('makes paragraphs, line breaks, bold and links, and escapes the rest', () => {
    expect(bodyHtml('Hi Ana,\n\nWe are **already live** on Alea.\nTry [Sunset Riders](https://b4wcdn.com/x?token=DEMO).\n\n<script>'))
      .toBe('<p>Hi Ana,</p>\n<p>We are <b>already live</b> on Alea.<br>Try <a href="https://b4wcdn.com/x?token=DEMO">Sunset Riders</a>.</p>\n<p>&lt;script&gt;</p>');
  });
});

describe('bodyPlain', () => {
  it('drops bold markers and spells links out', () => {
    expect(bodyPlain('**Live** now: [demo](https://x.io/d)')).toBe('Live now: demo (https://x.io/d)');
  });
});

describe('encodeHeader', () => {
  it('leaves ASCII alone and encodes the rest', () => {
    expect(encodeHeader('Re: Alea')).toBe('Re: Alea');
    expect(encodeHeader('Ana López')).toBe(`=?UTF-8?B?${Buffer.from('Ana López').toString('base64')}?=`);
  });
});

describe('replySubject', () => {
  it('adds Re: once', () => {
    expect(replySubject('Bet4.win for Alea')).toBe('Re: Bet4.win for Alea');
    expect(replySubject('RE: Bet4.win for Alea')).toBe('RE: Bet4.win for Alea');
  });
});

describe('draftRaw', () => {
  const mime = decode(draftRaw({
    from: 'gio@bet4.win', to: ['ana.lopez@alea.com'], cc: ['engineering@bet4.win'],
    subject: 'Re: Sweepstakes lobbies', body: 'Hi Ana,\n\n**Positioning**, not integration.',
    inReplyTo: 'abc@mail.alea.com', signatureHtml: '<b>Gio</b>',
  }, 'lanyard-test'));

  it('threads the reply and addresses it', () => {
    expect(mime).toContain('To: ana.lopez@alea.com\r\nCc: engineering@bet4.win\r\n');
    expect(mime).toContain('In-Reply-To: <abc@mail.alea.com>\r\nReferences: <abc@mail.alea.com>');
  });

  it('carries both parts, the signature only in HTML', () => {
    expect(partText(mime, 'text/plain')).toBe('Hi Ana,\n\nPositioning, not integration.');
    expect(partText(mime, 'text/html')).toContain('<b>Positioning</b>, not integration.');
    expect(partText(mime, 'text/html')).toContain('<b>Gio</b>');
  });
});
