import dns from 'node:dns/promises';
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Fetch an image the user pointed at, so the browser does not have to.
 *
 * The logo table stores data URIs rather than remote URLs, and the reasoning
 * (20260907600000) applies just as much to a logo chosen by hand: a remote URL
 * means every panel open sends our users' IP and referrer to somebody else's
 * host, and the image dies the day that site tidies its uploads folder. So the
 * server fetches it once and hands back the bytes; the browser boxes them to
 * 96px and stores the result on `company_overrides`.
 *
 * It follows the two rules `/api/owners` sets out — authenticate the caller
 * first, return the least it can — but unlike that route it needs no
 * service-role key, because it touches no privileged table. The session is
 * checked only to establish that the caller is allowed to make this server
 * fetch URLs at all.
 */

export const runtime = 'nodejs';   // needs DNS; the edge runtime has none

const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 10_000;
const MAX_HOPS = 3;

/**
 * A server that fetches a URL a user typed can be aimed at the network the
 * server is on — cloud metadata endpoints, an internal admin panel, a database
 * that trusts its subnet. So the host has to resolve to a public address, and
 * it is rechecked on every redirect: a public URL that 302s to 169.254.169.254
 * is the standard way round a check that only looks at what was typed.
 *
 * Honest about the gap: a name that passes here and resolves differently a
 * moment later when fetch does its own lookup (DNS rebinding) is not closed by
 * this. Closing it means dialling the validated IP and carrying the Host
 * header ourselves. For an authenticated internal tool this is the
 * proportionate guard, not the complete one.
 */
function isPrivateV4(ip: string) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127                       // this host, private, loopback
    || (a === 169 && b === 254)                            // link-local, incl. cloud metadata
    || (a === 172 && b >= 16 && b <= 31)                   // private
    || (a === 192 && b === 168)                            // private
    || (a === 100 && b >= 64 && b <= 127)                  // carrier NAT
    || (a === 192 && b === 0)                              // protocol assignments
    || (a === 198 && (b === 18 || b === 19))               // benchmarking
    || a >= 224                                            // multicast and reserved
  );
}

function isPrivate(ip: string, family: number) {
  if (family === 4) return isPrivateV4(ip);
  const v6 = ip.toLowerCase();
  // IPv4 written as IPv6 is still IPv4, and is the usual way past a v6 check.
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return v6 === '::' || v6 === '::1'
    || /^f[cd]/.test(v6)       // unique local
    || /^fe[89ab]/.test(v6);   // link-local
}

async function assertPublic(hostname: string) {
  let addrs;
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve ${hostname}.`);
  }
  // Every address, not just the first: a name answering with one public and
  // one private address would otherwise pass and then be dialled on either.
  if (addrs.some((a) => isPrivate(a.address, a.family))) {
    throw new Error('That address is on a private network.');
  }
}

function parse(raw: string) {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('That is not a URL.');
  }
  if (u.protocol !== 'https:') {
    throw new Error('Only https URLs are accepted.');
  }
  return u;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  if (typeof body.url !== 'string' || !body.url.trim()) {
    return NextResponse.json({ error: 'No URL given.' }, { status: 400 });
  }

  let res: Response;
  let url: URL;
  try {
    url = parse(body.url);
    await assertPublic(url.hostname);

    // Redirects are followed by hand so each hop can be checked. `fetch` with
    // the default `follow` would validate the first host and then quietly go
    // wherever it was sent.
    let hops = 0;
    for (;;) {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'image/*' },
      });
      if (res.status < 300 || res.status >= 400) break;
      const next = res.headers.get('location');
      if (!next) break;
      if ((hops += 1) > MAX_HOPS) throw new Error('Too many redirects.');
      url = parse(new URL(next, url).toString());
      await assertPublic(url.hostname);
    }
  } catch (e) {
    const m = (e as Error).message;
    return NextResponse.json(
      { error: /aborted|timeout/i.test(m) ? 'That host did not answer in time.' : m },
      { status: 400 },
    );
  }

  if (!res.ok) {
    return NextResponse.json({ error: `That URL answered ${res.status}.` }, { status: 400 });
  }

  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) {
    // Worth naming what came back: a login page or an HTML error is the
    // common case, and "not an image" alone reads as though the URL is wrong.
    return NextResponse.json(
      { error: `That is not an image — the server sent ${type || 'no content type'}.` },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'That image is over 3MB.' }, { status: 400 });
  }
  if (buf.byteLength < 100) {
    return NextResponse.json({ error: 'That image is empty.' }, { status: 400 });
  }

  return NextResponse.json(
    {
      dataUri: `data:${type};base64,${buf.toString('base64')}`,
      contentType: type,
      bytes: buf.byteLength,
      // The URL actually read, after redirects — that is the provenance worth
      // recording, not the one that was typed.
      sourceUrl: url.toString(),
    },
    // Someone else's image, fetched on behalf of one signed-in user. A shared
    // cache keyed on this URL has no business holding it.
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
