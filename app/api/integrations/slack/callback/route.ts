import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { exchangeSlackCode, slack } from '@/lib/integrations/slack';
import { checkState } from '@/lib/integrations/oauth-state';
import type { SlackUser } from '@/lib/integrations/slack-parse';

/**
 * Slack's redirect back. Checks the state, trades the code for the user's
 * token, and stores the account for the signed-in user: the row through the
 * service role, the token (with the team and user it belongs to) in Vault.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (outcome: string) => NextResponse.redirect(`${url.origin}/account?slack=${outcome}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${url.origin}/login`);
  if (!(await checkState(url.searchParams.get('state'), user.id))) return back('expired');
  if (url.searchParams.get('error')) return back('declined');
  const code = url.searchParams.get('code');
  if (!code) return back('failed');

  try {
    const { team, authed_user: who } = await exchangeSlackCode(code, `${url.origin}/api/integrations/slack/callback`);
    if (!team || !who?.access_token) return back('failed');
    const me = await slack<{ user: SlackUser }>('users.info', who.access_token, { user: who.id }).then((r) => r.user);
    const name = me.profile?.display_name || me.profile?.real_name || me.real_name || who.id;

    const admin = createAdminClient();
    const { data, error } = await admin.from('connected_accounts').upsert({
      user_id: user.id, provider: 'slack', external_id: `${team.id}/${who.id}`,
      label: `${name} on ${team.name}`, scopes: (who.scope ?? '').split(',').filter(Boolean),
      status: 'active', last_error: null,
    }, { onConflict: 'user_id,provider,external_id' }).select('id').single();
    if (error || !data) throw new Error(error?.message ?? 'No account row');
    const { error: se } = await admin.rpc('connected_account_set_secret', {
      account: data.id, secret: JSON.stringify({ access_token: who.access_token, team_id: team.id, user_id: who.id }),
    });
    if (se) throw new Error(se.message);
    return back('connected');
  } catch (e) {
    console.error('Slack connect failed:', (e as Error).message);
    return back('failed');
  }
}
