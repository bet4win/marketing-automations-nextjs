/**
 * Which company an email address belongs to, for filing synced messages.
 *
 * An exact address we hold wins; then the domain, walked up one label at a
 * time so `mail.example.com` finds `example.com`. A domain two companies share
 * matches neither: filing a message under the wrong company is worse than the
 * unmatched inbox. Free-mail domains never match by domain, or every gmail.com
 * sender would land on whichever company listed a gmail address.
 */

export const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
  'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'gmx.de', 'web.de', 'mail.ru', 'yandex.ru',
  'yandex.com', 'zoho.com', 'hey.com', 'fastmail.com', 'qq.com', '163.com',
]);

export interface EmailIndex {
  /** Lowercased address → company id. */
  byAddress: Map<string, string>;
  /** Lowercased domain → every company that claims it. */
  byDomain: Map<string, Set<string>>;
}

export type EmailMatch =
  | { companyId: string; by: 'address' | 'domain' }
  | null;

export const normaliseAddress = (address: string) => address.trim().toLowerCase();

/** `https://www.Example.com/about` → `example.com`. Null when there is no host. */
export function normaliseDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  return host.includes('.') ? host : null;
}

export function buildEmailIndex(
  addresses: { email: string | null; company_id: string }[],
  domains: { domain: string | null; company_id: string }[],
): EmailIndex {
  const byAddress = new Map<string, string>();
  for (const { email, company_id } of addresses) {
    if (email?.includes('@')) byAddress.set(normaliseAddress(email), company_id);
  }
  const byDomain = new Map<string, Set<string>>();
  for (const { domain, company_id } of domains) {
    const d = normaliseDomain(domain);
    if (!d || FREE_MAIL.has(d)) continue;
    const set = byDomain.get(d) ?? new Set<string>();
    set.add(company_id);
    byDomain.set(d, set);
  }
  return { byAddress, byDomain };
}

export function matchEmail(address: string, index: EmailIndex): EmailMatch {
  const a = normaliseAddress(address);
  const exact = index.byAddress.get(a);
  if (exact) return { companyId: exact, by: 'address' };

  let domain = a.split('@')[1] ?? '';
  if (FREE_MAIL.has(domain)) return null;
  while (domain.includes('.')) {
    const owners = index.byDomain.get(domain);
    if (owners) return owners.size === 1 ? { companyId: [...owners][0]!, by: 'domain' } : null;
    domain = domain.slice(domain.indexOf('.') + 1);
  }
  return null;
}
