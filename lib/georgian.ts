import type { Contact } from './types';

/**
 * Whether a person's surname reads as Georgian.
 *
 * A heuristic, and tuned by reading every surname we held on 2026-09-23 rather
 * than written from first principles. The four endings asked for were
 * -shvili, -dze, -ia and -iani; only the first two are clean on their own:
 *
 * - **-shvili, -dze** — 287 people, every one Georgian.
 * - **-iani** — also Italian: Giuliani, Reggiani, Graziani. The Italian ones
 *   share a handful of endings, so those are excluded; on our data that split
 *   16 Georgian from 7 Italian with no miss either way.
 * - **-ia** — mostly *not* Georgian: Garcia (27 people), Farrugia (10,
 *   Maltese), Correia, Mallia, Cilia, and Russian feminine -skaia. Only the
 *   endings Georgian (largely Megrelian) surnames actually use are accepted:
 *   Nadaraia, Khvichia, Shengelia, Tsipuria, Mamporia, Adamia, Gabunia,
 *   Zantaria, Odisharia. Each ending was checked against the non-Georgian
 *   names that also end in -ia, which is why several are narrower than they
 *   look (`[nha]taria`, not `taria`: Portaria).
 *
 * - **-ava** — half Belarusian feminine (Marozava, Tsikhanava, Antonava)
 *   and Srivastava. The Georgian ones share the consonant before it
 *   (Ugulava, Karchava, Khorava, Jobava, Gabedava, Sichinava), which the
 *   Belarusian -nava/-kava/-zava/-sava do not; Salsanava is the one miss.
 * - **-ani** beyond -iani — Italian, Persian, Arabic and Sindhi (Pisani,
 *   Rahmani, Soltani, Panjwani): 2 Georgian of 54. Only -vani is accepted
 *   (Mdivani, Chikovani); -wani is Sindhi.
 * - **-uli** — Arabuli, Kariauli, Berdzuli; one Venda Mukhavhuli of four.
 *
 * First names were tried as a second signal and dropped: they add Ana Garcia
 * and Ekaterina Losinskaia and still miss David Shengelia, because Ana and
 * David are not specific to anywhere.
 *
 * It will be wrong sometimes. The mark says "Georgian name", not "Georgian".
 */
const IANI_ITALIAN = /(?:uliani|ggiani|ziani|sciani|miani|llipiani|viviani|biani|diani)$/;
const IA_GEORGIAN = new RegExp(
  '(?:' + [
    '[^ns]aia',          // Nadaraia, Kordzaia, Gvajaia — not Russian -naia/-skaia
    'khia', '[ri]chia',  // Gogokhia; Darchia, Khvichia — not Maltese Cachia
    'shia', 'ghia',
    'uria', 'oria',      // Tsipuria, Mamporia
    'umia', 'amia',      // Tsurtsumia, Adamia, Arakhamia
    'unia', 'onia',      // Gabunia, Shonia
    'dzabia', 'utia',    // Gvadzabia, Khubutia
    'golia',             // Grigolia — not Dolia
    '[nglbv]elia',       // Shengelia, Danelia — not Celia
    '(?:ba|sa|va)lia',   // Kobalia, Gvasalia — not Prialia, Natalia
    'andia',             // Zarandia
    '[nha]taria', 'sharia', // Zantaria, Khoshtaria, Lataria, Odisharia
  ].join('|') + ')$',
);
// Ugulava, Korchilava, Karchava, Jobava, Khorava, Surmava, Gabedava,
// Ochigava, Pantskhava, Sichinava — not Belarusian Paharelava, Marozava.
const AVA_GEORGIAN = /(?:[ui]lava|chava|bava|rava|mava|dava|gava|khava|inava)$/;

export function surnameOf(fullName: string | null | undefined): string | null {
  const parts = (fullName ?? '').trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 1].replace(/[.()]/g, '').toLowerCase();
}

export function isGeorgianName(fullName: string | null | undefined): boolean {
  const s = surnameOf(fullName);
  if (!s || s.length < 5) return false;
  if (s.endsWith('shvili') || s.endsWith('dze') || s.endsWith('uli')) return true;
  if (s.endsWith('iani')) return !IANI_ITALIAN.test(s);
  if (s.endsWith('vani')) return true;
  if (s.endsWith('ava')) return AVA_GEORGIAN.test(s);
  // Russian feminine -skaia has a "k" before -aia, which the character class
  // in IA_GEORGIAN cannot see: Berezovskaia, Losinskaia.
  if (s.endsWith('ia')) return !s.endsWith('skaia') && IA_GEORGIAN.test(s);
  return false;
}

/**
 * Whether to flag a person: a human's mark when there is one, else the rule.
 * Everything that shows or filters on the flag goes through this, so a
 * correction reaches the badge, the company mark and the filter together.
 */
export const isGeorgian = (c: Pick<Contact, 'full_name' | 'georgian_mark'>) =>
  c.georgian_mark ?? isGeorgianName(c.full_name);

/** The named people at a company flagged Georgian. */
export const georgiansOf = (contacts: Contact[]) => contacts.filter(isGeorgian);
