import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { gmail } from '@/lib/integrations/google';
import { threadText, type GmailFullMessage } from '@/lib/integrations/gmail-body';
import { MailboxError, mailboxFor, syncedMessage } from '@/lib/integrations/mailbox';

/**
 * The full text of the email thread a history row belongs to, read live from
 * the mailbox that synced it and returned to the caller only. Nothing here is
 * stored: the sync keeps snippets, and this is how the assistant reads the
 * rest when it needs to (drafting a reply, a message cut off).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const activity = new URL(request.url).searchParams.get('activity');
  if (!activity) return NextResponse.json({ error: 'Which message? Pass ?activity=<id>.' }, { status: 400 });

  try {
    const msg = await syncedMessage(supabase, activity);
    const box = await mailboxFor(supabase, msg.accountId);
    const thread = await gmail<{ messages?: GmailFullMessage[] }>(box.token, `threads/${msg.threadId}`, { format: 'full' });
    return NextResponse.json({ text: threadText(thread.messages ?? []), messages: thread.messages?.length ?? 0 },
      { headers: { 'cache-control': 'private, no-store' } });
  } catch (e) {
    const status = e instanceof MailboxError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
