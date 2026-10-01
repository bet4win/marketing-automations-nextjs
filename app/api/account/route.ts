import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * The signed-in user's own account.
 *
 * Uses the caller's session, **not** the service-role key. `updateUser` acting
 * on your own metadata is exactly what a user token is allowed to do, so
 * reaching for the admin client here would hand the route the ability to edit
 * anyone's account in order to let you edit your own. The service-role key is
 * for things a user token genuinely cannot do — listing every account, in
 * /api/owners — and nothing else.
 *
 * The display name lives in `user_metadata.full_name`. Worth saying plainly:
 * `user_metadata` is writable by the user it belongs to, so it must never be
 * read as an authorisation claim. A name on a dropdown is not one.
 */

/** Long enough for "Jean-Baptiste van der Berg", short enough not to break rows. */
const MAX_NAME = 64;

function shape(user: {
  id: string; email?: string; user_metadata?: Record<string, unknown>;
  created_at?: string; last_sign_in_at?: string;
}) {
  const meta = user.user_metadata ?? {};
  const name = [meta.full_name, meta.name, meta.user_name]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return {
    id: user.id,
    email: user.email ?? null,
    name: name?.trim() ?? null,
    created_at: user.created_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
  };
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  return NextResponse.json({ account: shape(user) }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  if (typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name must be a string' }, { status: 400 });
  }
  // Collapse whitespace and strip control characters: this string ends up in
  // dropdowns, table cells and CSV exports, and a stray newline or tab breaks
  // all three in different ways.
  const name = body.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length > MAX_NAME) {
    return NextResponse.json(
      { error: `Display name must be ${MAX_NAME} characters or fewer` }, { status: 400 });
  }

  // Empty clears it, rather than storing "" — the readers test for a non-blank
  // string, and null is the honest way to say "no name set".
  const { data, error } = await supabase.auth.updateUser({
    data: { full_name: name || null },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ account: shape(data.user) }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
