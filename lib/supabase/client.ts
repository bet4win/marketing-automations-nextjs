'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client.
 *
 * The publishable key is public by design: it identifies the project, it does
 * not grant access. RLS is the access control, and every table denies the
 * `anon` role outright, so this key reads nothing until a user signs in.
 * Never expose `sb_secret_` / `service_role` here — NEXT_PUBLIC_ variables are
 * inlined into the client bundle.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
