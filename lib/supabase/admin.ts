import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. **Server only, and it must stay that way.**
 *
 * This key bypasses RLS entirely — it can read and write every row in the
 * project regardless of policy. The `server-only` import above is the guard:
 * if any client component ever pulls this module into its graph, the build
 * fails with an explicit error rather than shipping the key to every visitor.
 * That is also why the variable has no `NEXT_PUBLIC_` prefix, which would
 * inline it into the bundle.
 *
 * Reach for this only for things the signed-in user's own token genuinely
 * cannot do. Listing `auth.users` is one: the admin endpoints are not exposed
 * to `authenticated`, by design. Anything reachable through RLS should keep
 * going through `lib/supabase/server.ts` so policies stay in force.
 */

/** Missing-key message, exported so the route can say the same thing. */
export const NO_SECRET_KEY =
  'No Supabase secret key configured. Add SUPABASE_SECRET_KEY (an sb_secret_… '
  + 'key from Project Settings → API Keys) to .env.local. It must NOT be '
  + 'prefixed NEXT_PUBLIC_, which would ship it to the browser.';

export function createAdminClient() {
  // Either naming works: `SUPABASE_SECRET_KEY` for the current sb_secret_ keys,
  // `SUPABASE_SERVICE_ROLE_KEY` for the legacy service_role JWT.
  const key = process.env.SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error(NO_SECRET_KEY);

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    // No session handling at all: this client is per-request and must never
    // pick up or persist a user's session.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
