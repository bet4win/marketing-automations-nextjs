import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * The OAuth `state`: a random value in an httpOnly cookie, echoed back by the
 * provider. A callback whose state does not match the cookie was not started
 * from this browser, so a forged link cannot connect someone else's mailbox to
 * your account. Bound to the user who started it, and short-lived.
 */

const COOKIE = 'lanyard_oauth_state';

export async function issueState(userId: string): Promise<string> {
  const state = randomBytes(24).toString('base64url');
  (await cookies()).set(COOKIE, `${state}.${userId}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/integrations',
    maxAge: 600,
  });
  return state;
}

/** True when `state` is the one issued to `userId`. Consumes the cookie either way. */
export async function checkState(state: string | null, userId: string): Promise<boolean> {
  const jar = await cookies();
  const stored = jar.get(COOKIE)?.value ?? '';
  jar.delete({ name: COOKIE, path: '/api/integrations' });
  const expected = Buffer.from(`${state ?? ''}.${userId}`);
  const actual = Buffer.from(stored);
  return Boolean(state) && expected.length === actual.length && timingSafeEqual(expected, actual);
}
