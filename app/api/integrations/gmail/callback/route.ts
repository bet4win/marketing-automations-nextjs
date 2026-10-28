import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { exchangeCode } from '@/lib/integrations/google';
import { checkState } from '@/lib/integrations/oauth-state';

/**
 * Google's redirect back. Checks the state, trades the code for tokens, and
 * stores the account for the signed-in user: the row through the service-role
 * client (users cannot insert their own), the tokens into Vault. Ends on the
 * account page either way, with the outcome in the query string.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (outcome: string) => NextResponse.redirect(`${url.origin}/account?gmail=${outcome}`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${url.origin}/login`);
  if (!(await checkState(url.searchParams.get('state'), user.id))) return back('expired');
  if (url.searchParams.get('error')) return back('declined');
  const code = url.searchParams.get('code');
  if (!code) return back('failed');

  try {
    const { tokens, scopes, email } = await exchangeCode(code, `${url.origin}/api/integrations/gmail/callback`);
    if (!tokens || !email) return back('failed');
    if (!scopes.includes('https://www.googleapis.com/auth/gmail.readonly')) return back('scopes');

    const admin = createAdminClient();
    const { data, error } = await admin.from('connected_accounts').upsert({
      user_id: user.id, provider: 'gmail', external_id: email, label: email, scopes,
      status: 'active', last_error: null,
    }, { onConflict: 'user_id,provider,external_id' }).select('id').single();
    if (error || !data) throw new Error(error?.message ?? 'No account row');
    const { error: se } = await admin.rpc('connected_account_set_secret', {
      account: data.id, secret: JSON.stringify(tokens),
    });
    if (se) throw new Error(se.message);
    return back('connected');
  } catch (e) {
    // The page only says it failed; the reason is for whoever reads the logs.
    console.error('Gmail connect failed:', (e as Error).message);
    return back('failed');
  }
}
