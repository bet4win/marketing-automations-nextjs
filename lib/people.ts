import type { CompanyIndex } from './entity-links';
import type { Attribution, Contact, ManualContact, Person } from './types';

/**
 * The people directory holds named individuals only.
 *
 * A contact row without a name is an address, not a person — 303 rows carry
 * `kind = 'person'` but only the ones with `full_name` describe someone. Listing
 * the rest here would pad the count with mailboxes nobody can ask for by name.
 *
 * Scraped and hand-entered people are merged, but keep separate `origin`s: one
 * was derived by a machine and the other read off a page by a person, and the
 * UI has to be able to say which.
 */
export function buildPeople(
  contacts: Contact[], manual: ManualContact[], index: CompanyIndex,
): Person[] {
  const nameOf = (id: string) => index.byId.get(id)?.name ?? 'Unknown company';

  const named = mergeContacts(contacts, manual)
    .filter((c): c is Contact & { full_name: string } => Boolean(c.full_name));

  return named
    .map((c) => ({
      ...c,
      company_name: nameOf(c.company_id),
      origin: c.origin ?? 'scraped',
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/**
 * A hand-entered person, in the shape everything that lists contacts already
 * reads. One mapping rather than one per surface: the people directory, the
 * company panel, the board's Contact column, the has-email filter and the CSV
 * all resolve a contact the same way, so a person typed in on one screen
 * cannot be missing from another.
 */
export function manualToContact(m: ManualContact): Contact {
  return {
    id: m.id,
    company_id: m.company_id,
    kind: 'person',
    full_name: m.full_name,
    job_title: m.job_title,
    email: m.email,
    phone: m.phone,
    linkedin_url: m.linkedin_url,
    // Someone read this off a page and confirmed it before saving, which is a
    // stronger claim than anything the mailbox parser produces.
    attribution: 'confirmed',
    source_url: m.linkedin_url,
    is_personal_data: m.is_personal_data,
    origin: 'entered',
  };
}

/**
 * Scraped and hand-entered contacts as one list.
 *
 * A hand-entered record wins over a scraped one for the same person: it was
 * reviewed, whereas the scraped spelling was guessed off a mailbox. Superseded
 * on **either** the name at that company or the address — the scraped row for
 * "a.petrosyan@" and the typed row for "Aram Petrosyan" are one person, and
 * listing both would read as two.
 *
 * Only scraped rows are ever dropped. Two entered rows sharing an address are
 * two deliberate records, and this is not the place to overrule that.
 */
export function mergeContacts(contacts: Contact[], manual: ManualContact[]): Contact[] {
  const entered = manual.map(manualToContact);
  const nameKey = (companyId: string, name: string) =>
    `${companyId}:${name.trim().toLowerCase()}`;
  const mailKey = (addr: string) => addr.trim().toLowerCase();

  const names = new Set(entered.map((c) => nameKey(c.company_id, c.full_name!)));
  const mails = new Set(entered.filter((c) => c.email).map((c) => mailKey(c.email!)));

  const kept = contacts.filter((c) => {
    if (c.full_name && names.has(nameKey(c.company_id, c.full_name))) return false;
    if (c.email && mails.has(mailKey(c.email))) return false;
    return true;
  });
  return [...kept, ...entered];
}

/** Every token must appear somewhere in the row, so terms narrow rather than widen. */
export function searchPeople(people: Person[], query: string): Person[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return people;
  return people.filter((p) => {
    const hay = [p.full_name, p.job_title, p.company_name, p.email, p.phone]
      .filter(Boolean).join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * The company's LinkedIn People tab, which lists employees.
 *
 * A link the user clicks in their own browser — not a fetch. That distinction
 * is the whole point: browsing LinkedIn is what the site is for, whereas
 * automating a logged-in session against it is what gets an account banned.
 */
export function linkedinPeopleUrl(companyLinkedIn: string | null, companyName: string) {
  const base = companyLinkedIn?.replace(/\/+$/, '');
  if (base && /\/company\//.test(base)) return `${base}/people/`;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(companyName)}`;
}

/**
 * Whether `linkedin_url` actually points at LinkedIn.
 *
 * The column is named for the usual case and holds whatever profile was found:
 * every person imported from the onlyigaming directory carries an
 * `onlyigaming.com/profiles/…` URL. Showing LinkedIn's mark on those says the
 * person is somewhere they are not, and it is the mark people scan for.
 *
 * Matched on the string rather than `new URL`, which throws on the
 * scheme-less values this field also holds.
 */
export const isLinkedInUrl = (url: string | null | undefined) =>
  Boolean(url && /^(?:https?:\/\/)?(?:[\w-]+\.)*linkedin\.com(?:[/?#]|$)/i.test(url.trim()));

/** Just the host, to name a profile link that is not LinkedIn. */
export const profileHost = (url: string) =>
  url.trim().match(/^(?:https?:\/\/)?(?:www\.)?([^/?#]+)/i)?.[1] ?? 'the web';

/** Ranked worst-to-best so the table can warn on weakly attributed names. */
export const ATTRIBUTION_CLASS: Record<Attribution, string> = {
  confirmed: 'text-emerald-700 dark:text-emerald-400',
  from_address: 'text-amber-700 dark:text-amber-400',
  role: 'text-muted-foreground',
  unattributed: 'text-muted-foreground/60',
};
