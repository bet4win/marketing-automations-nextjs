import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/**
 * Whether a request to a job route carries the job secret.
 *
 * Job routes are public to the route guard (pg_cron has no session), so this
 * is their only lock. With JOB_SECRET unset every request is refused rather
 * than every request let through.
 */
export function isJobRequest(request: Request): boolean {
  const secret = process.env.JOB_SECRET;
  if (!secret) return false;
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
