/**
 * Turn a block of text a user copied off a page into draft people rows.
 *
 * Every failure class in `exhibitor-research/references/pitfalls.md` applies
 * here too — job titles read as names, legal entities read as names, UI chrome
 * read as names. The difference is that this parser is not the last word: its
 * output is shown for review and can be edited or dropped before anything is
 * saved. So it aims for high recall and leaves precision to the person, which
 * is the opposite trade-off to the unattended pipeline.
 */

/** A word in a candidate name means it is a role, not a person. */
const TITLE_WORDS = new Set([
  'account', 'analyst', 'associate', 'assistant', 'business', 'chief', 'commercial',
  'consultant', 'coordinator', 'country', 'data', 'department', 'deputy', 'development',
  'digital', 'director', 'engineer', 'executive', 'founder', 'general', 'global',
  'group', 'head', 'lead', 'manager', 'managing', 'marketing', 'officer', 'operations',
  'partner', 'president', 'principal', 'product', 'regional', 'representative',
  'sales', 'senior', 'specialist', 'strategy', 'support', 'team', 'technical',
  'vice', 'vp', 'ceo', 'cto', 'coo', 'cfo', 'cmo', 'owner', 'recruiter', 'talent',
]);

/** Legal-entity suffixes: a company, not a person. */
const LEGAL = new Set([
  'ab', 'ag', 'aps', 'as', 'bv', 'co', 'corp', 'gmbh', 'inc', 'kft', 'llc', 'ltd',
  'ltda', 'nv', 'oy', 'oyj', 'plc', 'pte', 'sa', 'sarl', 'sl', 'spa', 'srl', 'zrt',
  'group', 'holding', 'holdings', 'technologies', 'solutions', 'gaming', 'limited',
]);

/**
 * Capitalised words that are never part of a name. "Due Diligence" is the
 * canonical offender — two capitalised words, no role word, and it shipped
 * into the dataset once already. Place words are here because a copied list
 * puts a location line directly under each person.
 */
const NON_NAME = new Set([
  'due', 'diligence', 'show', 'more', 'results', 'people', 'you', 'may', 'know',
  'open', 'work', 'status', 'offline', 'online', 'view', 'profile', 'connect',
  'message', 'follow', 'invite', 'premium', 'shared', 'mutual', 'connection',
  'connections', 'degree', 'about', 'contact', 'privacy', 'terms',
  'united', 'kingdom', 'states', 'area', 'greater', 'region', 'city', 'county',
  'province', 'district', 'republic', 'metropolitan', 'remote',
]);

/** Interface chrome that shows up in a copied list. */
const NOISE = [
  /^status is (online|offline|reachable)$/i,
  /^(message|connect|follow|following|invite|pending|withdraw)$/i,
  /^view [^\n]*profile$/i,
  /^see (more|all)/i,
  /^\d+(st|nd|rd|th)\+?$/i,
  /^·?\s*\d+(st|nd|rd|th)\+?\s*(degree)?\s*(connection)?$/i,
  /^(\d+|\w+)\s+mutual connections?$/i,
  /^\d+\s+(followers?|connections?)$/i,
  /^open to work$/i,
  /^premium$/i,
  /^(show|load) more results?$/i,
  /^people you may know$/i,
  /^\s*·\s*$/,
];

const LINKEDIN_RE = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+\/?/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /\+\d[\d\s().-]{7,}\d/;

export type DraftPerson = {
  key: string;
  full_name: string;
  job_title: string;
  linkedin_url: string;
  email: string;
  phone: string;
};

const clean = (s: string) =>
  s.replace(/\s+/g, ' ')
    .replace(/^[·•\-–—|,\s]+/, '')
    .replace(/[·•|,\s]+$/, '')
    .trim();

/** 2–4 capitalised tokens, no role words, no company suffixes. */
export function looksLikeName(line: string): boolean {
  const s = clean(line);
  if (!s || s.length < 4 || s.length > 60) return false;
  if (/[@0-9(){}[\]/\\]/.test(s)) return false;
  if (/\bat\b/i.test(s)) return false;
  // "Yerevan, Armenia" — a copied list puts the location right under the name,
  // and a comma is far more likely to be a place than part of one.
  if (s.includes(',')) return false;

  const parts = s.split(' ').filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;

  for (const p of parts) {
    const w = p.replace(/[.'’-]/g, '').toLowerCase();
    if (!w) return false;
    if (TITLE_WORDS.has(w) || LEGAL.has(w) || NON_NAME.has(w)) return false;
    // Must start with an uppercase letter — covers accents, rejects "and", "of".
    if (p[0] !== p[0].toUpperCase() || p[0] === p[0].toLowerCase()) return false;
  }
  return true;
}

const isNoise = (line: string) => {
  const s = clean(line);
  return !s || NOISE.some((re) => re.test(s));
};

/**
 * Parse pasted text into drafts.
 *
 * Copied people lists repeat the name (once for the avatar's alt text, once
 * for the link), so a line identical to the one before it is dropped. The line
 * after a name is taken as the job title unless it is itself a name.
 */
export function parsePastedPeople(text: string): DraftPerson[] {
  const lines = text.split(/\r?\n/).map(clean).filter((l) => l && !isNoise(l));

  const out: DraftPerson[] = [];
  let prev = '';

  for (const line of lines) {
    if (line === prev) continue;
    prev = line;

    // A pasted profile URL belongs to the person it follows.
    if (/^https?:\/\//i.test(line)) {
      const m = line.match(LINKEDIN_RE);
      if (m && out.length) out[out.length - 1].linkedin_url ||= m[0];
      continue;
    }

    if (looksLikeName(line)) {
      // No positional URL assignment: matching the Nth url to the Nth person
      // handed one person another's profile whenever the paste held fewer urls
      // than names. A url is only attached when it sits beside the person.
      out.push({
        key: `${out.length}:${line}`,
        full_name: line,
        job_title: '',
        linkedin_url: '',
        email: '',
        phone: '',
      });
      continue;
    }

    const cur = out[out.length - 1];
    if (!cur) continue;

    const email = line.match(EMAIL_RE)?.[0];
    if (email) { cur.email ||= email; continue; }

    const phone = line.match(PHONE_RE)?.[0];
    if (phone) { cur.phone ||= phone.replace(/\s+/g, ' ').trim(); continue; }

    // First descriptive line after the name is the title. "Head of BD at Acme"
    // keeps only the role — the company is already known from the picker.
    if (!cur.job_title) cur.job_title = line.split(/\s+\bat\b\s+/i)[0].slice(0, 120);
  }

  // Same person twice in one paste (LinkedIn repeats across sections).
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = p.full_name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
