'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  CompanyLink, searchCompanies, type CompanyIndex, type CompanyRef,
} from '@/lib/entity-links';
import type { Opportunity } from '@/lib/types';

/**
 * The business, as opposed to the relationship.
 *
 * A company's relationship status says where you stand overall; a deal says
 * what is being sold, by what route, on what terms and live when. Without this
 * there was nothing to forecast and priority was a hand-set guess.
 *
 * Stages are the deal's own, not the outreach status: a lead can be Replied
 * while the deal is nowhere, and a deal can be integrating while nobody has
 * emailed for weeks.
 */

export const STAGES: Opportunity['stage'][] = [
  'exploring', 'negotiating', 'contracted', 'integrating', 'live', 'lost',
];

const STAGE_CLASS: Record<Opportunity['stage'], string> = {
  exploring: 'border-border bg-secondary text-muted-foreground',
  negotiating: 'border-amber-600/60 dark:border-amber-400/60 bg-amber-500/15 dark:bg-amber-400/15 text-amber-700 dark:text-amber-200',
  contracted: 'border-sky-600/60 dark:border-sky-400/60 bg-sky-500/15 dark:bg-sky-400/15 text-sky-700 dark:text-sky-200',
  integrating: 'border-violet-600/60 dark:border-violet-400/60 bg-violet-500/15 dark:bg-violet-400/15 text-violet-700 dark:text-violet-200',
  live: 'border-emerald-600/60 dark:border-emerald-400/60 bg-emerald-500/15 dark:bg-emerald-400/15 text-emerald-700 dark:text-emerald-200',
  lost: 'border-border bg-secondary text-muted-foreground',
};

/**
 * `via` is what the route's partner field is called on screen. Only `direct`
 * has none — the other two both reach players through somebody else, and which
 * word is right differs, so the label comes from the route rather than being
 * one generic "Partner".
 */
const ROUTES: {
  key: Opportunity['route']; label: string; hint: string; via: string | null;
}[] = [
  { key: 'direct', label: 'Direct', hint: 'Straight to the operator', via: null },
  {
    key: 'via_aggregator', label: 'Via aggregator', hint: 'Carried by a partner',
    via: 'Carried by',
  },
  {
    key: 'aggregator_listing', label: 'Listing', hint: 'Our games on their platform',
    via: 'Listed on',
  },
];

/** Module scope — a field row declared inside remounts on every keystroke. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11.5px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

const money = (n: number | null, ccy: string | null) =>
  (n === null ? null : `${(ccy ?? 'EUR') === 'EUR' ? '€' : ''}${n.toLocaleString()}/mo`);

/**
 * One form, used to add and to edit.
 *
 * The first cut could only add — a rev share typed wrong meant deleting the
 * deal and retyping it, which loses the created date and any stage history
 * along with the typo. Anything that can be created has to be correctable.
 */
export function DealPanel({
  deals, companyId, companyName, companyIndex, onOpenCompany,
  onCreate, onPatch, onDelete,
}: {
  /** Undefined until loaded; empty means genuinely none. */
  deals: Opportunity[] | undefined;
  companyId: string;
  companyName: string;
  /** Searched for the partner a deal routes through. */
  companyIndex: CompanyIndex;
  /** The partner a deal routes through is a company we hold, so it links. */
  onOpenCompany: (companyId: string) => void;
  onCreate: (draft: Partial<Opportunity>) => void;
  onPatch: (id: string, patch: Partial<Opportunity>) => void;
  onDelete: (deal: Opportunity) => void;
}) {
  /** null = closed, 'new' = adding, otherwise the id being edited. */
  const [open, setOpen] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [games, setGames] = useState('');
  const [route, setRoute] = useState<Opportunity['route']>('direct');
  const [via, setVia] = useState<CompanyRef | null>(null);
  const [viaQuery, setViaQuery] = useState('');
  const [rev, setRev] = useState('');
  const [value, setValue] = useState('');
  const [liveOn, setLiveOn] = useState('');
  const [note, setNote] = useState('');

  const startAdd = () => {
    setOpen('new');
    setTitle(''); setGames(''); setRoute('direct');
    setVia(null); setViaQuery('');
    setRev(''); setValue(''); setLiveOn(''); setNote('');
  };

  const startEdit = (d: Opportunity) => {
    setOpen(d.id);
    setTitle(d.title ?? '');
    setGames(d.games ?? '');
    setRoute(d.route);
    // The name comes from the board view's join, so a stored partner opens the
    // form already resolved rather than as a bare id to look up.
    setVia(d.via_company_id && d.via_company_name
      ? { id: d.via_company_id, name: d.via_company_name } : null);
    setViaQuery('');
    setRev(d.rev_share_pct?.toString() ?? '');
    setValue(d.monthly_value?.toString() ?? '');
    setLiveOn(d.expected_live_on ?? '');
    setNote(d.note ?? '');
  };

  const viaLabel = ROUTES.find((r) => r.key === route)?.via ?? null;
  const viaMatches = searchCompanies(companyIndex, viaQuery, { exclude: companyId });

  const submit = () => {
    const draft = {
      title: title.trim() || null,
      games: games.trim() || null,
      route,
      // A direct deal has no partner by definition, so switching back to it
      // clears one rather than leaving a stale name attached to a route that
      // contradicts it.
      via_company_id: viaLabel ? via?.id ?? null : null,
      // Blank stays null rather than becoming 0: "we have not agreed a rate"
      // and "the rate is zero" are different things.
      rev_share_pct: rev.trim() ? Number(rev) : null,
      monthly_value: value.trim() ? Math.round(Number(value)) : null,
      expected_live_on: liveOn || null,
      note: note.trim() || null,
    };
    if (open === 'new') onCreate(draft);
    else if (open) onPatch(open, draft);
    setOpen(null);
  };

  if (deals === undefined) {
    return <p className="text-[12.5px] text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-2">
      {deals.length === 0 && open === null && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          No deal recorded. A relationship says where you stand with
          {' '}{companyName}; a deal says what is being sold and when it goes live.
        </p>
      )}

      {deals.filter((d) => d.id !== open).map((d) => (
        <div key={d.id} className="rounded-md border border-border bg-secondary/40 p-2.5">
          <div className="mb-1 flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
              {d.title || d.games || 'Untitled deal'}
            </span>
            <span className={cn('shrink-0 rounded border px-1.5 text-[10px] font-semibold uppercase tracking-wide',
              STAGE_CLASS[d.stage])}>
              {d.stage}
            </span>
          </div>

          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-2 text-[11.5px]">
            <dt className="text-muted-foreground">Route</dt>
            <dd className="text-foreground">
              {ROUTES.find((r) => r.key === d.route)?.label}
              {d.via_company_name && (
                <>
                  {' — '}
                  {d.via_company_id
                    ? <CompanyLink id={d.via_company_id} name={d.via_company_name}
                        onOpen={onOpenCompany} />
                    : d.via_company_name}
                </>
              )}
            </dd>
            {d.games && (<><dt className="text-muted-foreground">Games</dt>
              <dd className="text-foreground">{d.games}</dd></>)}
            {d.rev_share_pct !== null && (<><dt className="text-muted-foreground">Rev share</dt>
              <dd className="text-foreground">{d.rev_share_pct}%</dd></>)}
            {d.monthly_value !== null && (<><dt className="text-muted-foreground">Value</dt>
              <dd className="text-foreground">{money(d.monthly_value, d.currency)}</dd></>)}
            {d.expected_live_on && (
              <><dt className="text-muted-foreground">Live by</dt>
              <dd className={cn('text-foreground',
                // Past its date and not live: the forecast has stopped being
                // true, and saying so is the point of recording a date.
                d.days_to_live !== null && d.days_to_live < 0 && d.stage !== 'live'
                  && 'text-amber-700 dark:text-amber-300')}>
                {d.expected_live_on}
                {d.days_to_live !== null && d.days_to_live < 0 && d.stage !== 'live'
                  && ` · ${-d.days_to_live}d overdue`}
              </dd></>)}
          </dl>

          {d.note && (
            <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted-foreground">
              {d.note}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1">
            {STAGES.map((st) => (
              <button
                key={st} type="button"
                onClick={() => onPatch(d.id, { stage: st })}
                aria-pressed={d.stage === st}
                className={cn('rounded-full border px-2 py-0.5 text-[10.5px] capitalize',
                  d.stage === st
                    ? STAGE_CLASS[st]
                    : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground')}
              >
                {st}
              </button>
            ))}
            <button
              type="button" onClick={() => startEdit(d)}
              aria-label={`Edit ${d.title || 'this deal'}`}
              className="ml-auto rounded p-1.5 text-muted-foreground hover:text-primary"
            >
              <Pencil aria-hidden className="size-3.5" />
            </button>
            <button
              type="button" onClick={() => onDelete(d)}
              aria-label={`Delete ${d.title || 'this deal'}`}
              className="rounded p-1.5 text-muted-foreground hover:text-destructive"
            >
              <Trash2 aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>
      ))}

      {open !== null && (
        <div className="space-y-2 rounded-md border border-primary/50 bg-secondary/40 p-2.5">
          <Row label="What is it">
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Content deal, originals bundle…" className="h-8 text-[13px]" />
          </Row>
          <Row label="Games">
            <Input value={games} onChange={(e) => setGames(e.target.value)}
              placeholder="Crash, Mines, 3 slots…" className="h-8 text-[13px]" />
          </Row>
          <Row label="Route">
            <div className="flex flex-wrap gap-1">
              {ROUTES.map((r) => (
                <button
                  key={r.key} type="button" onClick={() => setRoute(r.key)}
                  aria-pressed={route === r.key} title={r.hint}
                  className={cn('rounded-full border px-2.5 py-0.5 text-[11.5px]',
                    route === r.key
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-secondary/40 text-muted-foreground')}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </Row>
          {/* Only for the routes that have a partner — the field appearing at
              all is what says a route goes through somebody. */}
          {viaLabel && (
            <Row label={viaLabel}>
              {via ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/60 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                    {via.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setVia(null); setViaQuery(''); }}
                    className="shrink-0 text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  <Input
                    value={viaQuery} onChange={(e) => setViaQuery(e.target.value)}
                    placeholder="Type a company name…"
                    aria-label={`${viaLabel} — search companies`}
                    className="h-8 text-[13px]"
                  />
                  {viaMatches.map((m) => (
                    <button
                      key={m.id} type="button"
                      onClick={() => { setVia(m); setViaQuery(''); }}
                      className="block w-full truncate rounded border border-border bg-secondary/60 px-2 py-1.5 text-left text-[12px] hover:border-primary"
                    >
                      {m.name}
                    </button>
                  ))}
                  {viaQuery.trim().length >= 2 && viaMatches.length === 0 && (
                    <p className="text-[11.5px] text-muted-foreground">
                      No company by that name. Add it from the board first — a
                      partner has to be a company we hold, or the deal names
                      something nothing else can reach.
                    </p>
                  )}
                </div>
              )}
            </Row>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Row label="Rev share %">
              <Input value={rev} onChange={(e) => setRev(e.target.value)}
                inputMode="decimal" placeholder="12.5" className="h-8 text-[13px]" />
            </Row>
            <Row label="Value / mo">
              <Input value={value} onChange={(e) => setValue(e.target.value)}
                inputMode="numeric" placeholder="4000" className="h-8 text-[13px]" />
            </Row>
            <Row label="Live by">
              <Input type="date" value={liveOn} onChange={(e) => setLiveOn(e.target.value)}
                className="h-8 text-[13px]" />
            </Row>
          </div>
          <Row label="Note">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)}
              className="min-h-16 text-[13px]" />
          </Row>
          <div className="flex gap-2">
            <Button size="sm" className="h-9 flex-1 text-xs" onClick={submit}>
              {open === 'new' ? 'Add deal' : 'Save changes'}
            </Button>
            <Button size="sm" variant="outline" className="h-9 text-xs"
              onClick={() => setOpen(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {open === null && (
        <Button variant="outline" size="sm" className="h-9 w-full text-xs" onClick={startAdd}>
          <Plus className="mr-1 size-3.5" /> Add a deal
        </Button>
      )}
    </div>
  );
}
