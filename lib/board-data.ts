import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Category, EventRow, Status } from '@/lib/types';

/**
 * Everything the board needs before its first paint.
 *
 * Shared by the three view routes, which are otherwise identical — each is a
 * few lines that names its view and hands over. Wrapped in React's `cache` so
 * a render that reaches it twice pays for one round trip.
 *
 * Fetched on the server rather than by the client so the first paint is the
 * board and not an empty shell. The route guard has already read the session
 * to get here, so reading it again is cheap and keeps this function honest
 * about its own preconditions.
 */
export type BoardData = {
  email: string;
  name: string | null;
  events: EventRow[];
  categories: Category[];
  statuses: Status[];
  /** Non-null when reference data could not be read; the page renders it. */
  error: string | null;
};

export const loadBoard = cache(async (): Promise<BoardData> => {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // The display name lives in `user_metadata`, which the user writes through
  // /api/account. Read here rather than fetched by the client so the header
  // does not show an email for a moment and then change.
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = [meta.full_name, meta.name, meta.user_name]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0);

  const [events, categories, statuses] = await Promise.all([
    supabase.from('events').select('*').order('starts_on', { nullsFirst: false }),
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('statuses').select('*').order('sort_order'),
  ]);

  return {
    email: user.email ?? '',
    name: name?.trim() ?? null,
    events: (events.data ?? []) as EventRow[],
    categories: (categories.data ?? []) as Category[],
    statuses: (statuses.data ?? []) as Status[],
    error: events.error?.message ?? null,
  };
});
