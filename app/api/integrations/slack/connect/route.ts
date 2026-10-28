import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { slackAuthUrl } from '@/lib/integrations/slack';
import { issueState } from '@/lib/integrations/oauth-state';

/** Starts connecting Slack: off to Slack's consent screen, back to the callback. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const origin = new URL(request.url).origin;
  return NextResponse.redirect(slackAuthUrl({
    redirectUri: `${origin}/api/integrations/slack/callback`,
    state: await issueState(user.id),
  }));
}
