import type { PersonRole } from './types';

/** A bigger selection is likelier a mis-click than a set of duplicates. */
export const MERGE_MAX = 10;

export const canMerge = (n: number) => n >= 2 && n <= MERGE_MAX;

export type CompanyWeight = {
  id: string; name: string; people: number; stands: number; events: number; hasState: boolean;
};

/** The company holding the most is the one to keep; the first wins a tie. */
export function defaultKeeper(companies: CompanyWeight[]): string {
  const score = (c: CompanyWeight) => c.people + c.stands + c.events + (c.hasState ? 1 : 0);
  return companies.reduce((best, c) => (score(c) > score(best) ? c : best)).id;
}

/** Every distinct name once, in the order given — the typo may be the keeper's. */
export function nameChoices(names: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = raw?.trim();
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

/** The fullest row survives a same-company collapse; the first wins a tie. */
export function defaultRowKeeper(rows: PersonRole[]): string {
  const filled = (r: PersonRole) =>
    [r.job_title, r.email, r.phone, r.linkedin_url].filter(Boolean).length;
  return rows.reduce((best, r) => (filled(r) > filled(best) ? r : best)).id;
}
