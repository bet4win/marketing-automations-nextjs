'use client';

import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type CompanyRef = { id: string; name: string };

/** A company as the index is built from it. `prose_link` defaults to true. */
export type CompanyLinkName = CompanyRef & { prose_link?: boolean };

/**
 * A company name, as a link to its profile.
 *
 * The one definition of what a linked entity looks like. `linkifyCompanies`
 * renders mentions found in prose through it, and so does every component that
 * already holds an id — otherwise the two drift and the same company reads as
 * clickable in a note and inert in a panel.
 *
 * `stopPropagation` because these appear inside rows that are themselves
 * clickable: without it, opening the company from a people row would also
 * select the person.
 */
export function CompanyLink({
  id, name, label, className, onOpen,
}: {
  id: string;
  name: string;
  /** Shown instead of `name` when the surrounding text spells it differently. */
  label?: string;
  className?: string;
  onOpen: (companyId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(id); }}
      title={`Open ${name}`}
      className={cn('text-left text-primary underline decoration-dotted',
        'underline-offset-2 hover:decoration-solid', className)}
    >
      {label ?? name}
    </button>
  );
}

/**
 * Index of every company name and alias, for turning mentions in free text
 * into links. Built once from the whole `companies` table rather than the
 * current event, because notes routinely reference a company exhibiting at a
 * different show — Agreegain's note names Altenar, and the two need not appear
 * together.
 *
 * Two lists, because there are two ways a note names a company:
 *
 * - `ordered` is for **prose** — ingested notes, which cannot carry an `@` and
 *   are linked by finding names in running text. It leaves out short names
 *   and companies whose only list is one with `prose_links = false`, the SBC
 *   attendee list above all: ~940 of its names are ordinary words.
 * - `mentions` is for **`@` mentions** in notes people type. An `@` is a
 *   deliberate act, so neither guard applies and every company is in it.
 */
export type CompanyIndex = {
  byId: Map<string, CompanyRef>;
  /** Longest name first, so "BetConstruct" wins over a hypothetical "Bet". */
  ordered: { id: string; label: string }[];
  /** Every name and alias, longest first, lowercased for matching after `@`. */
  mentions: { id: string; label: string; lower: string }[];
};

// Short names are far too eager in prose: "G", "G1", "APS", "Juice", "Alea"
// would match ordinary words and legal boilerplate. Four characters is the
// point where false positives stop dominating in this dataset.
const MIN_NAME_LENGTH = 4;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildCompanyIndex(
  companies: CompanyLinkName[],
  aliases: { company_id: string; alias: string }[] = [],
): CompanyIndex {
  const byId = new Map(companies.map((c) => [c.id, { id: c.id, name: c.name }]));
  const prose = new Set(companies.filter((c) => c.prose_link !== false).map((c) => c.id));
  const seen = new Set<string>();
  const seenMention = new Set<string>();
  const ordered: CompanyIndex['ordered'] = [];
  const mentions: CompanyIndex['mentions'] = [];

  const add = (id: string, label: string) => {
    if (!byId.has(id)) return;
    const key = label.toLowerCase();
    if (!seenMention.has(key)) {
      seenMention.add(key);
      mentions.push({ id, label, lower: key });
    }
    if (label.length < MIN_NAME_LENGTH || seen.has(key) || !prose.has(id)) return;
    seen.add(key);
    ordered.push({ id, label });
  };

  companies.forEach((c) => add(c.id, c.name));
  aliases.forEach((a) => add(a.company_id, a.alias));
  ordered.sort((a, b) => b.label.length - a.label.length);
  mentions.sort((a, b) => b.label.length - a.label.length);
  return { byId, ordered, mentions };
}

/**
 * Search the index by name, for a picker: prefix matches first, so typing
 * "Rela" offers Relax before a longer name that merely contains it.
 *
 * `CompanyIndex` exists to linkify prose and carries no search of its own, so
 * this is it. It walks `mentions`, not `ordered`: `ordered` drops anything
 * under four characters and anything only on the attendee list, and both
 * guards are there to stop a name linking itself inside a sentence — they
 * have nothing to do with someone typing a name deliberately, and applying
 * the first here once made short-named companies unreachable from every
 * picker. Aliases still match, and resolve to the
 * canonical name, because that is the company you are choosing.
 *
 * Two characters is the floor here: one letter matches most of 2,351
 * companies, and a list of six arbitrary ones is worse than none.
 */
export function searchCompanies(
  index: CompanyIndex,
  query: string,
  { exclude, limit = 6 }: { exclude?: string; limit?: number } = {},
): CompanyRef[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const seen = new Set<string>();
  const hits: { ref: CompanyRef; prefix: number; length: number }[] = [];
  const consider = (id: string, label: string) => {
    const lower = label.toLowerCase();
    if (id === exclude || seen.has(id) || !lower.includes(q)) return;
    const name = index.byId.get(id)?.name;
    if (!name) return;
    seen.add(id);
    hits.push({
      ref: { id, name },
      prefix: lower.startsWith(q) ? 0 : 1,
      length: label.length,
    });
  };

  index.byId.forEach((c) => consider(c.id, c.name));
  index.mentions.forEach((c) => consider(c.id, c.label));

  return hits
    .sort((a, b) => a.prefix - b.prefix || a.length - b.length)
    .slice(0, limit)
    .map((h) => h.ref);
}

/**
 * Render ingested `text` with any known company mention replaced by a link.
 *
 * For notes a pipeline wrote, which cannot carry an `@`. Notes people type go
 * through `linkifyMentions` instead.
 *
 * Matching is whole-word and case-insensitive, longest name first, and a
 * company is never linked to itself. Anything not in the database stays plain
 * text — a mention of "Allwyn Hellas" is only a link if we actually hold a
 * profile to link to.
 */
export function linkifyCompanies(
  text: string | null | undefined,
  index: CompanyIndex,
  opts: { selfId?: string; onOpen: (companyId: string) => void },
): ReactNode {
  if (!text) return null;

  const candidates = index.ordered.filter((c) => c.id !== opts.selfId);
  if (!candidates.length) return text;

  const hits: Hit[] = [];
  const taken = (start: number, end: number) =>
    hits.some((h) => start < h.end && end > h.start);

  for (const c of candidates) {
    const re = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegex(c.label)})(?![A-Za-z0-9])`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index + m[1].length;
      const end = start + m[2].length;
      if (!taken(start, end)) hits.push({ start, end, id: c.id });
      // Step back one so adjacent mentions are not skipped by lastIndex.
      re.lastIndex = end;
    }
  }

  return renderHits(text, hits, index, opts.onOpen);
}


/**
 * Render `text` with each `@Company` mention replaced by a link.
 *
 * For notes people type. Only what follows an `@` is considered, so "adjust
 * the rev share" stays prose however many companies are called Adjust, and
 * the prose guards do not apply: short names and attendee-list companies are
 * reachable, because an `@` says the writer meant a company.
 *
 * The `@` must start a word, or every email address would be a mention —
 * `bd@flutter.com` names a mailbox, not Flutter. The longest name that
 * matches wins, so "@Growe Partners" is not read as "@Growe" plus text, and
 * the name must end at a word boundary or "@Betssonx" would link Betsson.
 */
export function linkifyMentions(
  text: string | null | undefined,
  index: CompanyIndex,
  opts: { selfId?: string; onOpen: (companyId: string) => void },
): ReactNode {
  if (!text) return null;
  const lower = text.toLowerCase();
  const hits: Hit[] = [];

  for (let at = lower.indexOf('@'); at !== -1; at = lower.indexOf('@', at + 1)) {
    if (at > 0 && /[A-Za-z0-9._%+-]/.test(text[at - 1])) continue;
    const hit = index.mentions.find((m) =>
      lower.startsWith(m.lower, at + 1) && !/[A-Za-z0-9]/.test(text[at + 1 + m.lower.length] ?? ''));
    if (!hit || hit.id === opts.selfId) continue;
    hits.push({ start: at, end: at + 1 + hit.lower.length, id: hit.id });
    at += hit.lower.length;
  }

  return renderHits(text, hits, index, opts.onOpen, MENTION_CLASS);
}

/**
 * A deliberate `@` mention reads as a tag, not as a guess: bold, with the
 * underline kept for hover. A prose match keeps the dotted underline, which
 * is what says "we think this is that company".
 */
const MENTION_CLASS = 'font-semibold no-underline hover:underline hover:decoration-solid';

type Hit = { start: number; end: number; id: string };

function renderHits(
  text: string, hits: Hit[], index: CompanyIndex, onOpen: (companyId: string) => void,
  className?: string,
): ReactNode {
  if (!hits.length) return text;
  hits.sort((a, b) => a.start - b.start);

  const out: ReactNode[] = [];
  let cursor = 0;
  hits.forEach((h, i) => {
    if (h.start > cursor) out.push(text.slice(cursor, h.start));
    const company = index.byId.get(h.id)!;
    out.push(
      <CompanyLink
        key={`${h.id}-${i}`}
        id={h.id}
        name={company.name}
        label={text.slice(h.start, h.end)}
        className={className}
        onOpen={onOpen}
      />,
    );
    cursor = h.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));

  return <>{out.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</>;
}
