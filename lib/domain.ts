import type { Attribution, Contact, Lead, Priority, Reach } from './types';

export const REACHES: Reach[] = ['Global', 'Multi-market', 'Regional', 'Emerging', 'Unknown'];
export const PRIORITIES: Priority[] = ['High', 'Med', 'Low'];

const REACH_RANK = Object.fromEntries(REACHES.map((r, i) => [r, i]));

/**
 * How firmly a name is attached to an address. Shown in the UI rather than
 * hidden, because a guessed name and a confirmed one must never look alike.
 */
export const GRADES: Record<Attribution, { label: string; tip: string }> = {
  confirmed: {
    label: 'confirmed',
    tip: 'Name printed beside this address on the source page.',
  },
  from_address: {
    label: 'from address',
    tip: 'Parsed from a firstname.lastname mailbox — spelling unconfirmed.',
  },
  role: { label: 'role mailbox', tip: 'Function mailbox, not a person.' },
  unattributed: { label: 'unattributed', tip: 'Address found, no name tied to it.' },
};

const GRADE_RANK: Record<Attribution, number> = {
  confirmed: 0,
  from_address: 1,
  unattributed: 2,
  role: 3,
};

/**
 * The dark shades are 300, not 400. Measured on `--card`: the 400s came out
 * 3.37:1 for Global and 3.61:1 for Multi-market, under the 4.5 this size of
 * text needs. That failure predates the light theme — it only surfaced when
 * the whole board was walked with a contrast audit rather than eyeballed.
 */
export const REACH_CLASS: Record<Reach, string> = {
  Global: 'text-emerald-700 dark:text-emerald-300',
  'Multi-market': 'text-sky-700 dark:text-sky-300',
  Regional: 'text-muted-foreground',
  Emerging: 'text-violet-700 dark:text-violet-300',
  Unknown: 'text-muted-foreground/60',
};

/**
 * A colour per category, not per group.
 *
 * The badges keyed off `GROUP_CLASS` before, so "Casino Game Studio" and
 * "Content Aggregator" were identical — both are in the Content group, and a
 * company that is both showed two same-coloured chips.
 *
 * Hues stay within their group's family, so the taxonomy is still legible at a
 * glance, but every category is distinguishable from its siblings. All are
 * Tailwind 300/400 shades, which clear AA on this dark background; the border
 * carries the same hue at 700/800 where it only has to meet the 3:1 bar for
 * non-text.
 */
export const CATEGORY_CLASS: Record<string, string> = {
  // Content
  studio:     'border-sky-700 text-sky-700 dark:text-sky-300',
  live:       'border-cyan-700 text-cyan-700 dark:text-cyan-300',
  crash:      'border-teal-700 text-teal-700 dark:text-teal-300',
  agg:        'border-indigo-700 text-indigo-700 dark:text-indigo-300',
  // Platform
  platform:   'border-violet-700 text-violet-700 dark:text-violet-300',
  sbplatform: 'border-purple-700 text-purple-700 dark:text-purple-300',
  sportsdata: 'border-fuchsia-700 text-fuchsia-700 dark:text-fuchsia-300',
  esports:    'border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-400',
  // Payments
  psp:        'border-emerald-700 text-emerald-700 dark:text-emerald-300',
  apm:        'border-green-700 text-green-700 dark:text-green-300',
  crypto:     'border-lime-700 text-lime-700 dark:text-lime-300',
  banking:    'border-teal-300 dark:border-teal-800 text-teal-700 dark:text-teal-400',
  // Compliance
  kyc:        'border-amber-700 text-amber-700 dark:text-amber-300',
  regtech:    'border-yellow-700 text-yellow-700 dark:text-yellow-300',
  rg:         'border-orange-700 text-orange-700 dark:text-orange-300',
  testlab:    'border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400',
  regulator:  'border-orange-300 dark:border-orange-800 text-orange-700 dark:text-orange-400',
  // Marketing
  affnet:     'border-rose-700 text-rose-700 dark:text-rose-300',
  afftech:    'border-pink-700 text-pink-700 dark:text-pink-300',
  adnet:      'border-red-700 text-red-700 dark:text-red-300',
  crm:        'border-fuchsia-300 dark:border-fuchsia-800 text-fuchsia-700 dark:text-fuchsia-400',
  agency:     'border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400',
  media:      'border-pink-300 dark:border-pink-800 text-pink-700 dark:text-pink-400',
  // Tech
  infra:      'border-blue-700 text-blue-700 dark:text-blue-300',
  comms:      'border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-400',
  ai:         'border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-400',
  // Services
  hr:         'border-yellow-300 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400',
  consult:    'border-stone-600 text-stone-700 dark:text-stone-300',
  // Demand
  operator:   'border-red-300 dark:border-red-800 text-red-700 dark:text-red-400',
  // Unknown
  other:      'border-border text-muted-foreground',
};

/** Category colour, falling back to the group's when a key is unmapped. */
export const categoryClass = (key: string | null, group: string | null) =>
  (key && CATEGORY_CLASS[key]) || GROUP_CLASS[group ?? 'Unknown'] || GROUP_CLASS.Unknown;

export const GROUP_CLASS: Record<string, string> = {
  Content: 'border-sky-300 dark:border-sky-900 text-sky-700 dark:text-sky-300',
  Platform: 'border-violet-300 dark:border-violet-900 text-violet-700 dark:text-violet-300',
  Payments: 'border-emerald-300 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300',
  Compliance: 'border-amber-300 dark:border-amber-900 text-amber-700 dark:text-amber-300',
  Marketing: 'border-pink-300 dark:border-pink-900 text-pink-700 dark:text-pink-300',
  Tech: 'border-blue-300 dark:border-blue-900 text-blue-700 dark:text-blue-300',
  Services: 'border-yellow-300/60 dark:border-yellow-900/60 text-yellow-700 dark:text-yellow-200',
  Demand: 'border-red-300 dark:border-red-900 text-red-700 dark:text-red-300',
  Unknown: 'border-border text-muted-foreground',
};

export const reachRank = (r: Reach | null) => (r ? REACH_RANK[r] ?? 9 : 9);

/**
 * Priority as a magnitude, not a word.
 *
 * Sorting the raw label is alphabetical, which puts Low above Med. Ranked so
 * that bigger means more important, descending reads High → Med → Low, which
 * is the only order anyone wants from a priority column. Unset returns '' so
 * the comparator's blanks-always-last rule still applies in both directions.
 */
const PRIORITY_RANK: Record<Priority, number> = { High: 3, Med: 2, Low: 1 };

export const priorityRank = (p: Priority | null) =>
  (p && PRIORITY_RANK[p] !== undefined ? PRIORITY_RANK[p] : '');

/** Emails for a company, most firmly attributed first. */
export function emailsOf(contacts: Contact[]) {
  return contacts
    .filter((c) => c.email)
    .sort((a, b) => (GRADE_RANK[a.attribution ?? 'unattributed'] ?? 9)
                  - (GRADE_RANK[b.attribution ?? 'unattributed'] ?? 9));
}

export const phonesOf = (contacts: Contact[]) => contacts.filter((c) => c.phone && !c.email);
export const namedOf = (contacts: Contact[]) => contacts.filter((c) => c.full_name);
export const bestContact = (contacts: Contact[]) => emailsOf(contacts)[0];

/**
 * Research links, minus the ones already answered. A search link disappears
 * once enrichment found the thing it was going to look for, so what remains
 * is genuinely outstanding work rather than a wall of buttons.
 */
export function researchLinks(lead: Lead, hasEmail: boolean) {
  const q = encodeURIComponent;
  const n = lead.name;
  const out: { label: string; href: string; hint: string }[] = [];

  if (lead.domain) out.push({ label: 'Website', href: `https://${lead.domain}`, hint: lead.domain });
  else out.push({
    label: 'Google — find official site',
    href: `https://www.google.com/search?q=${q(`${n} official site`)}`, hint: 'search',
  });

  if (!lead.linkedin_url) out.push({
    label: 'Find LinkedIn company page',
    href: `https://www.linkedin.com/search/results/companies/?keywords=${q(n)}`, hint: 'search',
  });

  // Named decision-makers are never in the dataset (Apollo people search is
  // gated on the current plan), so this one always stays.
  out.push({
    label: 'LinkedIn people (BD/sales)',
    href: `https://www.linkedin.com/search/results/people/?keywords=${q(`${n} business development`)}`,
    hint: 'search',
  });

  if (!hasEmail) out.push({
    label: 'Google — find contact email',
    href: `https://www.google.com/search?q=${q(`${n} contact email sales`)}`, hint: 'search',
  });

  out.push({
    label: 'News & funding',
    href: `https://www.google.com/search?q=${q(`${n} news funding`)}&tbm=nws`, hint: 'news',
  });
  return out;
}

export const formatRevenue = (v: number | null) =>
  v ? `$${(v / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })}M` : null;

/**
 * A `statuses.color` that reads on either theme.
 *
 * The stored hex is one value, picked against a dark board. Measured: the
 * Replied teal `#4ec9b0` comes out 3.59:1 on the dark card and 1.79:1 on the
 * light one — failing on both, and worst exactly where it was designed to
 * work. A second column per theme would mean every future status needing two
 * decisions and both of them being guesses about a background.
 *
 * So the hex is mixed toward whichever foreground is current. `--foreground`
 * is near-white in the dark theme and near-black in the light one, so the same
 * expression pushes the colour away from the surface in both directions, in
 * CSS, with nothing in JS needing to know which theme is showing.
 */
export const statusInk = (hex: string | null | undefined) =>
  (hex ? `color-mix(in oklab, ${hex} 55%, var(--foreground))` : undefined);
