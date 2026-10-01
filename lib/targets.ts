import { isGeorgian } from './georgian';
import type { Contact } from './types';

/** One row of a suggested-targets list — see the `suggestions` table. */
export type Suggestion = {
  list_slug: string;
  section: string;
  section_order: number;
  section_title: string;
  section_blurb: string | null;
  rank: number;
  company_id: string;
  contact_kind: 'op' | 'agg';
  rationale: string;
  route: string | null;
  grade: 'confirmed' | 'likely';
  sources: string[];
  flag: string | null;
  /** The show this list is for; its floorplan is where `stands` come from. */
  event_id: string | null;
  /** From suggestion_board: this company's own stands at that show. */
  stands: Stand[];
  /** A group company to try when it has no stand of its own. */
  stand_via: string | null;
  stand_via_name: string | null;
  via_stands: Stand[];
};

export type Stand = { booth: string; zone: string | null };

/**
 * Titles worth meeting, best first. At an operator it is whoever picks the
 * games; at an aggregator, whoever signs studios. Leadership is the fallback
 * for both, since at a small company the CEO is the content team.
 */
const TIERS: Record<Suggestion['contact_kind'], RegExp[]> = {
  op: [
    /head of (casino|gaming|games|content|product)|casino (content|product|director|manager|lead)|(games?|content|slots?) (manager|acquisition|integration|lead|director)/i,
    /partnership|business dev|\bbd\b|commercial|\bc[eco]o\b|chief|founder|managing director|head of/i,
  ],
  agg: [
    /(provider|studio|content|supplier|game) (partner|acquisition|relations|onboarding|integration)|head of (content|games|aggregat|partnership|provider)|partnership|business dev|\bbd\b/i,
    /commercial|\bc[eco]o\b|chief|founder|managing director|head of/i,
  ],
};

const tier = (title: string | null, kind: Suggestion['contact_kind']) => {
  const i = TIERS[kind].findIndex((re) => re.test(title ?? ''));
  return i < 0 ? TIERS[kind].length : i;
};

/**
 * Who to meet at a suggested company, from the contacts we hold.
 *
 * Picked here rather than stored with the suggestion, so the list never holds
 * a copy of anyone's name: erase a person and they are gone from this page
 * too. Within a tier a Georgian-flagged person comes first — the handshake is
 * the point — and one is added beyond `n` if the top picks have none, as long
 * as their role is relevant at all.
 */
export function pickContacts(
  contacts: Contact[], kind: Suggestion['contact_kind'], n = 2,
): Contact[] {
  const named = contacts.filter((c) => c.full_name);
  const ranked = [...named].sort((a, b) => (
    tier(a.job_title, kind) - tier(b.job_title, kind)
    || Number(isGeorgian(b)) - Number(isGeorgian(a))
  ));
  const picks = ranked.slice(0, n);
  if (!picks.some(isGeorgian)) {
    const g = ranked.find((c) => isGeorgian(c) && tier(c.job_title, kind) < TIERS[kind].length);
    if (g) picks.push(g);
  }
  return picks;
}
