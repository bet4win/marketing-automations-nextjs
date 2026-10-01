'use client';

import { useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GeorgianMark } from '@/components/partner-mark';
import { CompanyLink, type CompanyIndex } from '@/lib/entity-links';
import { isGeorgian } from '@/lib/georgian';
import { pickContacts, type Stand, type Suggestion } from '@/lib/targets';
import { cn } from '@/lib/utils';
import type { Contact, EventRow, Person } from '@/lib/types';

/** A company's stands, each opening the floorplan at it. */
function StandChips({
  stands, at, onBooth,
}: {
  stands: Stand[];
  at: EventRow | null;
  onBooth: (booth: string, at: EventRow | null) => void;
}) {
  return (
    <>
      {stands.map((st) => (
        <button
          key={st.booth} type="button" onClick={() => onBooth(st.booth, at)}
          title={`Stand ${st.booth}${st.zone ? `, ${st.zone}` : ''} — copy and open the floorplan`}
          className="rounded border border-primary/50 px-1.5 py-px font-mono text-[10.5px] text-primary hover:bg-primary/15"
        >
          {st.booth}
        </button>
      ))}
    </>
  );
}

const GRADE_TIP: Record<Suggestion['grade'], string> = {
  confirmed: 'Stated by the company or its partner in a press release or its own page.',
  likely: 'From a review, a lobby listing or an indirect report — worth confirming.',
};

/**
 * A suggested-targets list, grouped into its sections.
 *
 * Every company is a link to its panel and every person to theirs: this is a
 * list you work from, so it has to lead somewhere. Who to meet is picked from
 * the contacts we hold (lib/targets.ts), never stored with the list.
 */
export function TargetsView({
  suggestions, loadError, index, contactsBy, people, onOpenCompany, onSelectPerson,
  events, onBooth,
}: {
  events: EventRow[];
  /** Copies the booth and opens the floorplan at it, as the board's booth cells do. */
  onBooth: (booth: string, at: EventRow | null) => void;
  suggestions: Suggestion[] | null;
  loadError: string | null;
  index: CompanyIndex;
  contactsBy: Record<string, Contact[]>;
  people: Person[];
  onOpenCompany: (companyId: string) => void;
  onSelectPerson: (p: Person) => void;
}) {
  const sections = useMemo(() => {
    const by = new Map<string, Suggestion[]>();
    for (const s of [...(suggestions ?? [])].sort((a, b) => (
      a.section_order - b.section_order || a.rank - b.rank))) {
      if (!by.has(s.section)) by.set(s.section, []);
      by.get(s.section)!.push(s);
    }
    return [...by.values()];
  }, [suggestions]);

  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const eventOf = (id: string | null) => events.find((e) => e.id === id) ?? null;
  const onFloor = (suggestions ?? []).filter((s) => s.stands.length > 0).length;

  if (loadError) {
    return <p className="p-10 text-center text-sm text-muted-foreground">Could not load targets: {loadError}</p>;
  }
  if (!suggestions) {
    return <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (!suggestions.length) {
    return <p className="p-10 text-center text-sm text-muted-foreground">No suggested targets yet.</p>;
  }

  let n = 0;
  return (
    <ScrollArea className="min-h-0 flex-1">
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-4">
        <h1 className="text-base font-semibold">SBC Summit 2026 — distribution targets</h1>
        <p className="mb-4 text-xs text-muted-foreground">
          {suggestions.length} companies from the attendee list, with the route each one takes content
          through. Who to meet is picked from the people we hold, Georgian names first.
          {' '}{onFloor} have a stand; the rest are attending without one, so book a meeting with
          them directly.
        </p>

        {sections.map((rows) => (
          <section key={rows[0].section} className="mb-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {rows[0].section_title}
            </h2>
            {rows[0].section_blurb && (
              <p className="mb-2 text-xs text-muted-foreground">{rows[0].section_blurb}</p>
            )}
            <ol className="divide-y divide-border rounded-md border border-border">
              {rows.map((s) => {
                n += 1;
                const name = index.byId.get(s.company_id)?.name ?? 'Unknown company';
                const meet = pickContacts(contactsBy[s.company_id] ?? [], s.contact_kind);
                return (
                  <li key={s.company_id} className="grid grid-cols-[28px_1fr] gap-x-2 px-3 py-2 lg:grid-cols-[28px_minmax(0,1.1fr)_minmax(0,1fr)]">
                    <span className="pt-0.5 text-right text-xs tabular-nums text-muted-foreground">{n}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <CompanyLink id={s.company_id} name={name} onOpen={onOpenCompany}
                          className="text-[13px] font-medium" />
                        <StandChips stands={s.stands} at={eventOf(s.event_id)} onBooth={onBooth} />
                        {s.route && (
                          <span className="rounded bg-secondary px-1.5 py-px text-[10.5px] text-muted-foreground">
                            {s.route}
                          </span>
                        )}
                        <span title={GRADE_TIP[s.grade]}
                          className={cn('text-[10.5px]',
                            s.grade === 'confirmed' ? 'text-primary' : 'text-muted-foreground')}>
                          {s.grade}
                        </span>
                      </div>
                      {s.stands.length === 0 && (
                        <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11.5px] text-amber-800 dark:text-amber-300">
                          {s.stand_via_name && s.via_stands.length > 0 ? (
                            <>
                              No stand of its own — try {s.stand_via_name}
                              <StandChips stands={s.via_stands} at={eventOf(s.event_id)} onBooth={onBooth} />
                              or reach out personally.
                            </>
                          ) : 'No stand — reach out personally to book a meeting.'}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs leading-relaxed text-foreground/90">{s.rationale}</p>
                      {s.flag && (
                        <p className="mt-1 rounded border border-l-[3px] border-border border-l-amber-600 bg-secondary/60 px-2 py-0.5 text-[11.5px] dark:border-l-amber-400">
                          {s.flag}
                        </p>
                      )}
                      {s.sources.length > 0 && (
                        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[10.5px]">
                          {s.sources.map((u) => (
                            <a key={u} href={u} target="_blank" rel="noopener"
                              className="text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-primary">
                              {new URL(u).hostname.replace(/^www\./, '')}
                            </a>
                          ))}
                        </p>
                      )}
                    </div>
                    <div className="col-start-2 mt-1.5 min-w-0 lg:col-start-3 lg:mt-0">
                      {meet.length === 0 ? (
                        <p className="text-[11.5px] text-muted-foreground">No named contact held.</p>
                      ) : (
                        <ul className="space-y-0.5">
                          {meet.map((c) => {
                            const p = personById.get(c.id);
                            return (
                              <li key={c.id} className="flex min-w-0 items-center gap-1 text-[11.5px]">
                                {p ? (
                                  <button type="button" onClick={() => onSelectPerson(p)}
                                    className="truncate text-left text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid">
                                    {c.full_name}
                                  </button>
                                ) : <span className="truncate">{c.full_name}</span>}
                                {isGeorgian(c) && <GeorgianMark names={[c.full_name]} />}
                                {c.job_title && (
                                  <span className="truncate text-muted-foreground">· {c.job_title}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </main>
    </ScrollArea>
  );
}
