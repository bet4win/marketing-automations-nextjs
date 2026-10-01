import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/auth',
  // Dev-only measurement rig; the page itself 404s in a production build.
  ...(process.env.NODE_ENV === 'production' ? [] : ['/dev-perf']),
];

/**
 * Refreshes the auth token and guards routes. Wired up by proxy.ts
 * (Next 16 renamed the middleware file convention to proxy).
 *
 * Sessions live in cookies rather than localStorage precisely so this can run:
 * the server knows who you are before a page renders, so a protected route
 * never flashes its contents before redirecting.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Must be getUser(), not getSession(): getUser() revalidates the token with
  // the auth server, so a revoked or forged cookie cannot pass the guard.
  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    // An API route gets a status, not a redirect. Redirecting `fetch()` to the
    // login page returns HTML, so the caller's `res.json()` throws a parse
    // error and the failure surfaces as "Unexpected token '<'" rather than as
    // "signed out". The handlers check the session themselves as well — this is
    // the outer layer, not the only one.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Remember where they were headed so login can send them back.
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
