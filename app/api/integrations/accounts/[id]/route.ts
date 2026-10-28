import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revokeToken, type GoogleTokens } from '@/lib/integrations/google';
import { slack } from '@/lib/integrations/slack';

/**
 * Disconnects an account: revokes the grant at the provider, then deletes the
 * row, which deletes its Vault secret. The row is read and deleted with the
 * caller's own client, so RLS decides whose account this can touch; only the
 * token read needs the service role.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: account } = await supabase.from('connected_accounts').select('id,provider').eq('id', id).maybeSingle();
  if (!account) return NextResponse.json({ error: 'No such account' }, { status: 404 });

  try {
    const { data } = await createAdminClient().rpc('connected_account_secret', { account: id });
    const secret = data ? JSON.parse(data as string) : null;
    if (secret && account.provider === 'gmail') await revokeToken((secret as GoogleTokens).refresh_token);
    if (secret && account.provider === 'slack') await slack('auth.revoke', secret.access_token);
  } catch {
    // Disconnecting must not depend on the provider answering; the row goes regardless.
  }

  const { error } = await supabase.from('connected_accounts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  return NextResponse.json({ ok: true });
}
