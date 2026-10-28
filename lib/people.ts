import type { CompanyIndex } from './entity-links';
import type { Attribution, Contact, ManualContact, Person, PersonLink, PersonRole } from './types';

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
  links: PersonLink[] = [], names: Map<string, string> = new Map(),
): Person[] {
  const nameOf = (id: string) => index.byId.get(id)?.name ?? 'Unknown company';
  const personOf = new Map(links.map((l) => [l.contact_id ?? l.manual_contact_id!, l.person_id]));

  const roles: PersonRole[] = mergeContacts(contacts, manual)
    .filter((c) => Boolean(c.full_name))
    .map((c) => ({ ...c, company_name: nameOf(c.company_id), origin: c.origin ?? 'scraped' }));

  // Linked rows are one person; an unlinked row is a person on its own.
  const groups = new Map<string, PersonRole[]>();
  for (const r of roles) {
    const key = personOf.get(r.id) ?? `row:${r.id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return [...groups.entries()]
    .map(([key, rs]) => {
      const sorted = [...rs].sort((a, b) => a.company_name.localeCompare(b.company_name));
      const person_id = key.startsWith('row:') ? null : key;
      return {
        ...sorted[0],
        full_name: (person_id && names.get(person_id)) || sorted[0].full_name!,
        person_id,
        roles: sorted,
      };
    })
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

/** How a desk-held row is labelled. `null` for scraped rows, which show their attribution grade. */
export function enteredLabel(c: Pick<Contact, 'origin'>) {
  if (c.origin !== 'entered') return null;
  return { label: 'entered', tip: 'Held in the desk, not found by a crawl. Editable from the person panel.' };
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
    const hay = [p.full_name, p.email, p.phone,
      ...p.roles.flatMap((r) => [r.job_title, r.company_name, r.email])]
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
 * LinkedIn's people search for one person, by name and employer.
 *
 * Offered wherever we hold a name and no way to reach them — most of the
 * attendee-list imports. Same rule as `linkedinPeopleUrl`: a link the user
 * follows in their own browser, never a fetch.
 */
export const linkedinPersonSearchUrl = (name: string, companyName: string) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${name} ${companyName}`)}`;

/** A named person we hold no address, number or profile for. */
export const unreachable = (c: Pick<Contact, 'full_name' | 'email' | 'phone' | 'linkedin_url'>) =>
  Boolean(c.full_name && !c.email && !c.phone && !c.linkedin_url);

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
