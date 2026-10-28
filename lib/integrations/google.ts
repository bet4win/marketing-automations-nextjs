import 'server-only';
import { ReauthError } from './syncer';

/**
 * Google OAuth and the few Gmail endpoints the sync uses, over fetch. The
 * googleapis package would be most of the bundle for five calls.
 *
 * The OAuth client is an Internal app in the bet4.win Workspace: only bet4.win
 * accounts can connect, which is also why Google's review of restricted Gmail
 * scopes does not apply.
 */

export const GMAIL_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.settings.basic',
];

export const GOOGLE_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

/** What the Vault secret of a Gmail account holds. */
export interface GoogleTokens {
  refresh_token: string;
  access_token: string;
  /** Epoch ms. */
  expires_at: number;
}

function client() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set.');
  return { id, secret };
}

export function googleAuthUrl(opts: { redirectUri: string; state: string; loginHint?: string }): string {
  const params = new URLSearchParams({
    client_id: client().id,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    // A refresh token, every time: without prompt=consent Google issues one
    // only on the first grant, and a reconnect would come back without it.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: opts.state,
  });
  if (opts.loginHint) params.set('login_hint', opts.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = client();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok) {
    const why = json.error_description ?? json.error ?? res.statusText;
    // invalid_grant: revoked, expired, or the password changed.
    throw json.error === 'invalid_grant' ? new ReauthError(`Google refused access: ${why}`) : new Error(`Google: ${why}`);
  }
  return json;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const t = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  return {
    tokens: t.refresh_token
      ? { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 }
      : null,
    scopes: (t.scope ?? '').split(' ').filter(Boolean),
    email: t.id_token ? emailFromIdToken(t.id_token) : null,
  };
}

/**
 * The address in an ID token. Not signature-checked: it came straight from
 * Google's token endpoint over TLS, which Google documents as sufficient.
 */
export function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return payload.email_verified && typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** A usable access token, refreshed when it has under a minute left. Null = unchanged. */
export async function freshTokens(tokens: GoogleTokens): Promise<GoogleTokens | null> {
  if (tokens.expires_at - Date.now() > 60_000) return null;
  const t = await tokenRequest({ refresh_token: tokens.refresh_token, grant_type: 'refresh_token' });
  return { ...tokens, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 };
}

/** Best effort: a token Google no longer knows is already as revoked as it gets. */
export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' })
    .catch(() => undefined);
}

export async function gmailPost<T>(accessToken: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return (await res.json()) as T;
  if (res.status === 401) throw new ReauthError('Gmail refused the token. Connect the account again.');
  const text = await res.text();
  throw new Error(`Gmail ${res.status} on ${path}: ${text.slice(0, 200)}`);
}

/** The history id is older than Gmail keeps (about a week): list instead. */
export class HistoryGoneError extends Error {}

export async function gmail<T>(accessToken: string, path: string, params?: Record<string, string | string[]>): Promise<T> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
  }
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (res.ok) return (await res.json()) as T;
  if (res.status === 401) throw new ReauthError('Gmail refused the token. Connect the account again.');
  if (res.status === 404 && path === 'history') throw new HistoryGoneError('History expired');
  if (res.status === 404) throw Object.assign(new Error('Not found'), { status: 404 });
  const body = await res.text();
  throw new Error(`Gmail ${res.status} on ${path}: ${body.slice(0, 200)}`);
}
