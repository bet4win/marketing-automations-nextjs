import { LeadDesk } from '@/components/lead-desk';
import { loadBoard } from '@/lib/board-data';
import { BoardError } from '@/components/board-error';

/**
 * The board itself, shared by all three view routes.
 *
 * It lives in the **layout**, not in the pages, and that is the whole point of
 * the route group. A layout is preserved when you navigate between its
 * children, so switching tabs no longer remounts `LeadDesk`.
 *
 * Measured before this existed: one tab click refetched 1,423 leads across
 * four pages, 1,387 contacts across three, the schedule and the owners API,
 * and took four seconds. Before the views were routes it was client state and
 * instant. Routing the tabs was right; paying for it on every click was not.
 */
export default async function BoardLayout() {
  const data = await loadBoard();
  if (data.error) return <BoardError message={data.error} />;
  return <LeadDesk {...data} />;
}
