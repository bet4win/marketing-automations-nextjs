import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Change your own password.
 *
 * `updateUser({ password })` does not ask for the old one — an active session
 * is enough. That is a weak default for a shared workstation: anyone who gets a
 * borrowed browser tab could lock the real owner out of their own account. So
 * the current password is verified first, and only then is the new one set.
 *
 * The verification runs on a **throwaway client** with `persistSession: false`.
 * Signing in through the cookie-bound server client would issue a second
 * session and rewrite the caller's auth cookies mid-request, which is both
 * surprising and a good way to sign someone out by accident.
 *
 * Brute force is bounded by Supabase's own rate limit on
 * `signInWithPassword` — this route deliberately verifies through that call
 * rather than reimplementing the check, so the limiter still applies.
 */

/** Above Supabase's default of 6. Short passwords on a shared tool are not worth it. */
const MIN_PASSWORD = 10;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  let body: { current?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }
  const current = typeof body.current === 'string' ? body.current : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!current) {
    return NextResponse.json({ error: 'Enter your current password' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: `New password must be at least ${MIN_PASSWORD} characters` }, { status: 400 });
  }
  if (password === current) {
    return NextResponse.json(
      { error: 'That is already your password' }, { status: 400 });
  }

  const probe = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: wrong } = await probe.auth.signInWithPassword({
    email: user.email, password: current,
  });
  if (wrong) {
    // Deliberately not echoing Supabase's message: on this route the only
    // account being tested is the caller's own, so the useful thing to say is
    // which field was wrong, and nothing about whether the account exists.
    return NextResponse.json({ error: 'Current password is not correct' }, { status: 400 });
  }
  // Drop the session that verification just created, rather than leaving a
  // second refresh token alive for a password we are about to invalidate.
  await probe.auth.signOut();

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
