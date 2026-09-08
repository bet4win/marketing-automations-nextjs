import type { Owner } from './types';

/**
 * What to show for a stored owner value.
 *
 * `lead_states.owner` holds an email address, so every place that renders one
 * has to resolve it against the account list or it shows the raw address. One
 * function rather than the same `find(...)?.name ?? value` in five components,
 * because the fallback is the part that matters: a value with no matching
 * account still has to be shown, not swallowed.
 */
export function ownerLabel(value: string | null | undefined, owners: Owner[]) {
  const v = value?.trim();
  if (!v) return null;
  return owners.find((o) => o.email === v)?.name ?? v;
}

/** The account list's own label. Name when set, address otherwise. */
export function displayName(o: Owner) {
  return o.name ?? o.email;
}

/**
 * Initials for an avatar, from a display name or an address.
 *
 * Two letters at most, and it falls back to the first character of the local
 * part so an account with no name still gets something rather than an empty
 * circle.
 */
export function initials(nameOrEmail: string) {
  const name = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail;
  const words = name.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0]?.slice(0, 2) ?? '?').toUpperCase();
}
