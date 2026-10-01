import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { NO_SECRET_KEY, createAdminClient } from '@/lib/supabase/admin';
import type { Owner } from '@/lib/types';

/**
 * The people who can own a lead: the project's Supabase auth users.
 *
 * `auth.users` is not reachable with the signed-in user's own token — the admin
 * endpoints are deliberately not granted to `authenticated` — so this has to
 * run on the server with the service-role key. Hence a route handler rather
 * than a query from the browser.
 *
 * Two rules it follows:
 *
 * - **Authenticate the caller first.** The service-role key bypasses RLS, so an
 *   unauthenticated route here would be an open directory of every account on
 *   the project. `getUser()`, not `getSession()`: it revalidates the token
 *   against the auth server rather than trusting the cookie.
 * - **Return the least it can.** Colleagues' email addresses are personal data;
 *   `listUsers` also hands back phone numbers, IP-bearing sign-in records, app
 *   metadata and identity providers, and none of that belongs in a dropdown.
 *   Only id, email and a display name leave this function.
 *
 * Not cached: `private, no-store`. A shared cache holding a user directory
 * keyed only by URL would serve it to the next caller, signed in or not.
 */

const PER_PAGE = 1000;   // the admin API defaults to 50; ask for the maximum

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // A missing key is a deployment mistake, not a user error, and it should
    // say so plainly instead of surfacing as an empty dropdown.
    return NextResponse.json({ error: NO_SECRET_KEY }, { status: 500 });
  }

  const owners: Owner[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    for (const u of data.users) {
      // No email means an account that cannot be written into `owner`, since
      // that column stores the address. Skip rather than offer a blank option.
      if (!u.email) continue;
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const name = [meta.full_name, meta.name, meta.user_name]
        .find((v): v is string => typeof v === 'string' && v.trim().length > 0);
      owners.push({ id: u.id, email: u.email, name: name?.trim() ?? null });
    }
    if (data.users.length < PER_PAGE) break;
  }

  owners.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));

  return NextResponse.json({ owners }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
