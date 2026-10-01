import type { Contact } from './types';

/**
 * What a human has said about a person, from `person_marks`.
 *
 * `georgian` null means the surname rule decides (lib/georgian.ts); `known`
 * is whether someone on the team knows them personally. No row at all means
 * neither has been said.
 */
export type PersonMark = { georgian: boolean | null; known: boolean };

export const NO_MARK: PersonMark = { georgian: null, known: false };

/** `person_marks` key: the company and the lowercased name, as mergeContacts matches. */
export const markKey = (companyId: string, fullName: string) =>
  `${companyId}:${fullName.trim().toLowerCase()}`;

/** A mark that says nothing is stored as no row. */
export const isEmptyMark = (m: PersonMark) => m.georgian === null && !m.known;

/** Attach marks to contacts. Returns the input untouched when there are none. */
export function withMarks<T extends Contact>(contacts: T[], marks: ReadonlyMap<string, PersonMark>): T[] {
  if (!marks.size) return contacts;
  return contacts.map((c) => {
    const m = c.full_name ? marks.get(markKey(c.company_id, c.full_name)) : undefined;
    return m === undefined ? c : { ...c, georgian_mark: m.georgian, known: m.known };
  });
}
