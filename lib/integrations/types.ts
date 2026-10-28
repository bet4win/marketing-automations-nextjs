/** Kinds of account a user can connect. Matches `connected_accounts.provider`. */
export type Provider = 'gmail' | 'slack' | 'telegram';

export const PROVIDER_LABEL: Record<Provider, string> = {
  gmail: 'Gmail', slack: 'Slack', telegram: 'Telegram',
};

/** A row of `connected_accounts`, as its owner reads it. */
export type ConnectedAccount = {
  id: string;
  user_id: string;
  provider: Provider;
  external_id: string;
  label: string;
  status: 'active' | 'needs_reauth' | 'error';
  paused: boolean;
  share_activity: boolean;
  scopes: string[];
  cursor: Record<string, unknown>;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
};
