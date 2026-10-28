import 'server-only';
import { ReauthError } from './syncer';

/**
 * Slack's OAuth (user tokens) and Web API, over fetch. The app lives in our
 * own workspace and each Lanyard user authorises it for themselves, so what
 * it reads is what that user can read, and nothing of anyone else's.
 */

export const SLACK_USER_SCOPES = [
  'channels:history', 'channels:read', 'groups:history', 'groups:read',
  'im:history', 'im:read', 'mpim:history', 'mpim:read',
  'users:read', 'users:read.email', 'team:read',
];

export const SLACK_ENV = ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'];

function client() {
  const id = process.env.SLACK_CLIENT_ID;
  const secret = process.env.SLACK_CLIENT_SECRET;
  if (!id || !secret) throw new Error('SLACK_CLIENT_ID and SLACK_CLIENT_SECRET are not set.');
  return { id, secret };
}

export function slackAuthUrl(opts: { redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: client().id,
    user_scope: SLACK_USER_SCOPES.join(','),
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

/** Slack answers 200 with ok: false; these mean the token is gone for good. */
const DEAD_TOKEN = new Set(['invalid_auth', 'token_revoked', 'account_inactive', 'not_authed', 'token_expired']);

export async function slack<T>(method: string, token: string | null, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: new URLSearchParams(params),
  });
  if (res.status === 429) throw new Error(`Slack rate limit on ${method}; the next tick carries on.`);
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) {
    const why = json.error ?? res.statusText;
    throw DEAD_TOKEN.has(why) ? new ReauthError(`Slack refused the token (${why}). Connect again.`) : new Error(`Slack ${method}: ${why}`);
  }
  return json;
}

export async function exchangeSlackCode(code: string, redirectUri: string) {
  const { id, secret } = client();
  return slack<{
    team?: { id: string; name: string };
    authed_user?: { id: string; access_token?: string; scope?: string };
  }>('oauth.v2.access', null, { client_id: id, client_secret: secret, code, redirect_uri: redirectUri });
}
