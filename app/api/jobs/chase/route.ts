import { NextResponse } from 'next/server';
import { NO_SECRET_KEY, createAdminClient } from '@/lib/supabase/admin';
import { todayIn } from '@/lib/dates';
import { isJobRequest } from '@/lib/integrations/job-auth';

/**
 * The hourly chase, POSTed by pg_cron (20261028130000_briefing_not_digest.sql):
 * for every user, "No reply yet" follow-ups on their leads where our message
 * has gone unanswered past their wait. Idempotent: it only fills empty next
 * actions, so running it every hour is safe, and it catches a user's new day
 * within the hour wherever they are.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_WAIT = 5;

export async function POST(request: Request) {
  if (!isJobRequest(request)) return NextResponse.json({ error: 'Not allowed' }, { status: 401 });
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: NO_SECRET_KEY }, { status: 500 });
  }

  const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  const { data: settings } = await admin.from('user_settings').select('user_id,timezone,no_reply_days');
  const byUser = new Map((settings ?? []).map((s) => [s.user_id as string, s]));

  let chased = 0;
  let failed = 0;
  for (const user of list.users) {
    if (!user.email) continue;
    const s = byUser.get(user.id);
    try {
      const { data, error: e } = await admin.rpc('set_no_reply_follow_ups', {
        owner_email: user.email, owner_id: user.id,
        days: s?.no_reply_days ?? DEFAULT_WAIT, today: todayIn(s?.timezone ?? 'UTC'),
      });
      if (e) throw new Error(e.message);
      chased += data?.length ?? 0;
    } catch (e) {
      console.error('Chase failed for a user:', (e as Error).message);
      failed += 1;
    }
  }
  return NextResponse.json({ chased, failed });
}
