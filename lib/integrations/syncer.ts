import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConnectedAccount } from './types';

/** The provider refused the token: the owner has to connect again. */
export class ReauthError extends Error {}

export interface SyncContext {
  admin: SupabaseClient;
  /** Epoch ms after which a syncer should stop at the next safe point. */
  deadline: number;
}

export interface Syncer {
  /** Files what is new since `account.cursor` and returns where it stopped. */
  sync(account: ConnectedAccount, ctx: SyncContext): Promise<{
    cursor: Record<string, unknown>;
    filed: number;
  }>;
}
