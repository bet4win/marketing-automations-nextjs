/**
 * The dedup key for a company name, and a typed domain cleaned to a host.
 *
 * The normalisation must stay in step with `ingest/seed.py:norm`, which is
 * what computes the same key on the ingest side. If they drift, a company
 * added by hand will duplicate the next time it is scraped.
 */
export function normalizeName(name: string) {
  let n = name.replace(/\(.*?\)/g, ' ').replace(/&/g, ' and ')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
  for (const suf of ['limited', 'ltd', 'gmbh', 'llc', 'inc', 'bv', 'nv', 'oy',
    'ab', 'plc', 'srl', 'sarl', 'aps', 'pte', 'sa', 'ag']) {
    if (n.endsWith(suf) && n.length > suf.length + 3) {
      n = n.slice(0, -suf.length);
      break;
    }
  }
  return n;
}

export const cleanDomain = (v: string) =>
  v.trim().replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').toLowerCase() || null;
