import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { googleAuthUrl } from '@/lib/integrations/google';
import { issueState } from '@/lib/integrations/oauth-state';

/** Starts connecting Gmail: off to Google's consent screen, back to the callback. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const origin = new URL(request.url).origin;
  const url = googleAuthUrl({
    redirectUri: `${origin}/api/integrations/gmail/callback`,
    state: await issueState(user.id),
    loginHint: user.email ?? undefined,
  });
  return NextResponse.redirect(url);
}
