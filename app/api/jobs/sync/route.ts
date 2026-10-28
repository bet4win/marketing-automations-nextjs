import { NextResponse } from 'next/server';
import { NO_SECRET_KEY, createAdminClient } from '@/lib/supabase/admin';
import { isJobRequest } from '@/lib/integrations/job-auth';
import { runSync } from '@/lib/integrations/sync';

/**
 * The sync tick, POSTed by pg_cron every five minutes (see
 * supabase/migrations/20261027191000_job_runner.sql). Locked by the job
 * secret, not a session; the route guard lets /api/jobs through for that.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isJobRequest(request)) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 401 });
  }
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: NO_SECRET_KEY }, { status: 500 });
  }
  try {
    return NextResponse.json(await runSync(admin));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
