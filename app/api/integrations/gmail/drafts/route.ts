import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { gmail, gmailPost } from '@/lib/integrations/google';
import { draftRaw } from '@/lib/integrations/gmail-draft';
import { MailboxError, mailboxFor, syncedMessage } from '@/lib/integrations/mailbox';

/**
 * Saves a draft in the caller's Gmail: what the assistant wrote and the user
 * confirmed on the draft card. Nothing is sent. A reply goes into the thread
 * of the message it answers, from the mailbox that received it; Gmail's own
 * signature for that address is appended, since a draft made through the API
 * gets none.
 */

const address = z.string().trim().email();
const body = z.object({
  to: z.array(address).min(1).max(20),
  cc: z.array(address).max(20).default([]),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
  reply_to: z.string().uuid().nullish(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  }
  const d = parsed.data;

  try {
    const replyTo = d.reply_to ? await syncedMessage(supabase, d.reply_to) : null;
    const box = await mailboxFor(supabase, replyTo?.accountId);
    const sendAs = await gmail<{ signature?: string }>(box.token, `settings/sendAs/${encodeURIComponent(box.address)}`)
      .catch(() => ({ signature: '' }));
    const raw = draftRaw({
      from: box.address, to: d.to, cc: d.cc, subject: d.subject, body: d.body,
      inReplyTo: replyTo?.messageId, signatureHtml: sendAs.signature || null,
    });
    const draft = await gmailPost<{ id: string; message: { id: string } }>(box.token, 'drafts', {
      message: { raw, ...(replyTo ? { threadId: replyTo.threadId } : {}) },
    });
    return NextResponse.json({ id: draft.id, from: box.address, threaded: Boolean(replyTo) });
  } catch (e) {
    const status = e instanceof MailboxError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
