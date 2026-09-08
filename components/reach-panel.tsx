'use client';

import { Fragment, useState } from 'react';
import { HelpCircle, Network, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CompanyLink, searchCompanies, type CompanyIndex } from '@/lib/entity-links';
import type { DistributionEdge, ReachRoute } from '@/lib/types';

/**
 * Who carries our games onward from here, and what that pays.
 *
 * The map an off-the-shelf CRM cannot draw, because it does not hold both
 * sides of a market. This one holds 2,351 companies spanning operators,
 * aggregators, platforms and studios.
 *
 * Two things make it more than a list of names:
 *
 * **Each edge has a price.** Revolver charges Winpesa 8% of GGR and passes us
 * 75% of what it collects, so that operator is worth 6% of its GGR to us. The
 * 75% is our deal; the 8% belongs to the edge, because it differs per operator
 * and the aggregator is the only party who knows it.
 *
 * **The chain does not stop at operators.** Revolver also gives our games to
 * Relax Gaming, another aggregator with operators of its own, so one partner's
 * reach can be far wider than its own integrations. That is why an edge says
 * whether its rate is a terminal GGR charge or a pass-through that multiplies.
 *
 * An unknown rate stays unknown. It is a question to put to the aggregator,
 * and the panel counts those rather than guessing.
 */

const CONFIDENCE: Record<DistributionEdge['confidence'], string> = {
  confirmed: 'text-emerald-700 dark:text-emerald-300',
  likely: 'text-sky-700 dark:text-sky-300',
  assumed: 'text-muted-foreground',
};

/**
 * Categories whose companies pass content onward rather than ending the chain.
 * Used only to preselect the rate basis — it is shown and editable, because a
 * category is a guess about a company and this is a claim about a contract.
 */
const NEXT_CONFIDENCE: Record<DistributionEdge['confidence'], DistributionEdge['confidence']> = {
  confirmed: 'likely', likely: 'assumed', assumed: 'confirmed',
};

const RELAYS = new Set(['aggregator', 'platform', 'casino_platform', 'content_aggregator']);

export function ReachPanel({
  companyId, carriedBy, carries, routes, companyIndex,
  onOpenCompany, onAdd, onRemove, onRate,
}: {
  companyId: string;
  /** Edges where this company is downstream — someone carries it. */
  carriedBy: DistributionEdge[] | undefined;
  /** Edges where this company is upstream — it carries others. */
  carries: DistributionEdge[] | undefined;
  /** What our content earns through this company, computed by the database. */
  routes: ReachRoute[] | undefined;
  companyIndex: CompanyIndex;
  /** Every name here is another company we hold a profile for — see the link
      rule in the skill. Pushes onto the panel stack rather than replacing. */
  onOpenCompany: (companyId: string) => void;
  onAdd: (
    upstreamId: string, downstreamId: string,
    basis?: DistributionEdge['rate_basis'],
  ) => void;
  onRemove: (edge: DistributionEdge) => void;
  onRate: (
    edge: DistributionEdge,
    patch: {
      rate_pct?: number | null;
      rate_basis?: DistributionEdge['rate_basis'];
      confidence?: DistributionEdge['confidence'];
    },
  ) => void;
}) {
  const [adding, setAdding] = useState<null | 'up' | 'down'>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [showAll, setShowAll] = useState({ up: false, down: false });

  if (carriedBy === undefined || carries === undefined) {
    return <p className="text-[12.5px] text-muted-foreground">Loading…</p>;
  }

  const live = carriedBy.filter((e) => e.partner_live);
  const unpriced = carries.filter((e) => e.rate_pct === null);

  const q = query.trim().toLowerCase();
  const matches = searchCompanies(companyIndex, query, { exclude: companyId });

  const key = (e: DistributionEdge) => `${e.upstream_id}:${e.downstream_id}`;

  /**
   * Both directions cap at twelve rows until asked, and both can be opened.
   *
   * Relax Gaming's operator wall put 66 downstream edges on one company, so a
   * panel that renders all of them is 66 rows of scroll before the controls
   * beneath it. The cap that was here said "+54 more." and stopped there — a
   * count of rows with no way to reach them, which is worse than either
   * showing them or not counting them, because it tells you the data exists
   * and then refuses to produce it.
   */
  const LIMIT = 12;
  const shown = (which: 'up' | 'down', edges: DistributionEdge[]) =>
    (showAll[which] ? edges : edges.slice(0, LIMIT));

  const moreRow = (which: 'up' | 'down', total: number) => (total <= LIMIT ? null : (
    <Button
      variant="ghost" size="sm" className="h-9 w-full text-xs"
      aria-expanded={showAll[which]}
      onClick={() => setShowAll((s) => ({ ...s, [which]: !s[which] }))}
    >
      {showAll[which] ? 'Show fewer' : `Show all ${total}`}
    </Button>
  ));

  /**
   * Yield per reached company, keyed by id.
   *
   * Only the database can work this out: it multiplies our share of the
   * partner's take by every pass-through hop and the final GGR charge, and a
   * single unknown anywhere makes the answer unknown rather than optimistic.
   */
  const yieldFor = new Map((routes ?? []).map((r) => [r.reached_id, r]));

  const edgeRow = (e: DistributionEdge, name: string, upstreamIsOther: boolean) => {
    const k = key(e);
    return (
      <div key={k} className="rounded-md border border-border bg-secondary/40 px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <CompanyLink
            id={upstreamIsOther ? e.upstream_id : e.downstream_id}
            name={name}
            onOpen={onOpenCompany}
            className="min-w-0 flex-1 truncate text-[12.5px]"
          />
          {/* Only in "Carried by": in "Carries" the upstream is this very
              company, so its own status on every row is noise. */}
          {upstreamIsOther && e.partner_live && (
            <span className="shrink-0 rounded bg-emerald-500/15 dark:bg-emerald-400/15 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-200">
              {e.upstream_status_label ?? 'live'}
            </span>
          )}
          {/* Cycles confirmed → likely → assumed. Editable because the grade
              is the difference between a rate you can quote and one you
              cannot, and it changes as you learn things. */}
          <button
            type="button"
            onClick={() => onRate(e, { confidence: NEXT_CONFIDENCE[e.confidence] })}
            title={`How well we know this link — click for ${NEXT_CONFIDENCE[e.confidence]}`}
            className={cn('shrink-0 rounded px-1 text-[10.5px]', CONFIDENCE[e.confidence])}
          >
            {e.confidence}
          </button>
          <button type="button" onClick={() => onRemove(e)}
            aria-label={`Remove the link to ${name}`}
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive">
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        </div>

        {(
          editing === k ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              <Input
                value={rate} onChange={(ev) => setRate(ev.target.value)}
                inputMode="decimal" placeholder="8" autoFocus
                aria-label={`Rate for ${name}`} className="h-8 w-[72px] text-[13px]"
              />
              <span className="text-[11px] text-muted-foreground">
                % {e.rate_basis === 'ggr' ? 'of GGR' : 'passed up'}
              </span>
              <Button size="sm" className="ml-auto h-8 text-xs"
                onClick={() => {
                  // Empty clears it back to unknown rather than storing 0:
                  // "they have not told us" is not "they charge nothing".
                  onRate(e, { rate_pct: rate.trim() ? Number(rate) : null });
                  setEditing(null);
                }}>
                Save
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs"
                onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { setEditing(k); setRate(e.rate_pct?.toString() ?? ''); }}
                className={cn('rounded px-1.5 py-0.5 text-[11px]',
                  e.rate_pct === null
                    ? 'bg-amber-500/15 dark:bg-amber-400/15 text-amber-700 dark:text-amber-300'
                    : 'bg-muted text-foreground')}
              >
                {e.rate_pct === null
                  ? 'rate unknown — ask them'
                  : `${e.rate_pct}% ${e.rate_basis === 'ggr' ? 'of GGR' : 'passed up'}`}
              </button>
              {/* The basis is shown and switchable, because getting it wrong
                  silently truncates the chain: a pass-through edge marked as
                  GGR hides everything the downstream reaches. */}
              <button
                type="button"
                onClick={() => onRate(e, {
                  rate_basis: e.rate_basis === 'ggr' ? 'pass_through' : 'ggr',
                })}
                title={e.rate_basis === 'ggr'
                  ? 'Terminal: they pay this share of their own GGR. Switch if they pass our games on.'
                  : 'Chained: they pass this share of what they collect. Switch if they are the end of the line.'}
                className="text-[10.5px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                {e.rate_basis === 'ggr' ? 'ends here' : 'passes on'}
              </button>
              {/* The number the whole model exists to produce: what a company
                  is actually worth to us once every hop has taken its cut. */}
              {(() => {
                const y = yieldFor.get(e.downstream_id);
                if (!y) return null;
                return y.our_ggr_pct === null ? null : (
                  <span className="rounded bg-emerald-500/15 dark:bg-emerald-400/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-200"
                    title={`${y.our_share_of_take !== null ? (y.our_share_of_take * 100).toFixed(0) + '% of ' : ''}${y.their_ggr_pct}% GGR, via ${y.chain.join(' → ')}`}>
                    we earn {y.our_ggr_pct}% of GGR
                  </span>
                );
              })()}
            </div>
          )
        )}
      </div>
    );
  };

  const addRow = (label: string, which: 'up' | 'down') => (
    adding === which ? (
      <div className="space-y-1.5 rounded-md border border-primary/50 bg-secondary/40 p-2">
        <Input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a company name…" autoFocus
          aria-label={label} className="h-9 text-[13px]"
        />
        {matches.map((m) => (
          <button
            key={m.id} type="button"
            onClick={() => {
              // Direction matters: this company is upstream when it carries,
              // downstream when it is carried. Backwards inverts the map.
              //
              // The basis is left to the database, which knows the target's
              // category. The client tried to read it off `CompanyIndex`,
              // which carries only {id, name}, so every edge came out
              // terminal and an aggregator downstream silently hid everything
              // beyond it.
              if (which === 'down') onAdd(companyId, m.id);
              else onAdd(m.id, companyId, 'pass_through');
              setAdding(null); setQuery('');
            }}
            className="block w-full truncate rounded border border-border bg-secondary/60 px-2 py-2 text-left text-[12px] hover:border-primary"
          >
            {m.name}
          </button>
        ))}
        {q.length >= 2 && matches.length === 0 && (
          <p className="text-[11.5px] text-muted-foreground">No company by that name.</p>
        )}
        <Button size="sm" variant="outline" className="h-8 w-full text-xs"
          onClick={() => { setAdding(null); setQuery(''); }}>Cancel</Button>
      </div>
    ) : (
      <Button variant="outline" size="sm" className="h-9 w-full text-xs"
        onClick={() => { setAdding(which); setQuery(''); }}>
        <Plus className="mr-1 size-3.5" /> {label}
      </Button>
    )
  );

  return (
    <div className="space-y-3">
      {carriedBy.length > 0 && (
        <div className={cn('flex gap-2 rounded-r-md border border-l-[3px] border-border p-2.5',
          live.length > 0
            ? 'border-l-emerald-600 dark:border-l-emerald-400 bg-emerald-500/10 dark:bg-emerald-400/10'
            : 'border-l-amber-600 dark:border-l-amber-400 bg-secondary/60')}>
          <Network aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[12px] leading-relaxed text-foreground">
            {live.length > 0
              ? <>Reachable now through{' '}
                  {live.map((e, i) => (
                    <Fragment key={e.upstream_id}>
                      {i > 0 && ', '}
                      <CompanyLink
                        id={e.upstream_id} name={e.upstream_name}
                        onOpen={onOpenCompany} className="font-semibold"
                      />
                    </Fragment>
                  ))}
                  {' '}— already {live[0].upstream_status_label?.toLowerCase()}. No new
                  partner needed.</>
              : <>Carried by {carriedBy.length} aggregator{carriedBy.length === 1 ? '' : 's'},
                  none of which we work with yet. Reaching them means a direct deal or a
                  new partner first.</>}
          </p>
        </div>
      )}

      {unpriced.length > 0 && (
        <div className="flex gap-2 rounded-r-md border border-l-[3px] border-border border-l-amber-600 dark:border-l-amber-400 bg-secondary/60 p-2.5">
          <HelpCircle aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[12px] leading-relaxed text-foreground">
            {unpriced.length} of {carries.length} onward route
            {carries.length === 1 ? '' : 's'} {unpriced.length === 1 ? 'has' : 'have'} no
            rate on file, so what {unpriced.length === 1 ? 'it earns' : 'they earn'} cannot
            be worked out. They are the only party who knows — it is one question
            to their account manager.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Carried by {carriedBy.length > 0 && `(${carriedBy.length})`}
        </p>
        {shown('up', carriedBy).map((e) => edgeRow(e, e.upstream_name, true))}
        {moreRow('up', carriedBy.length)}
        {addRow('Add someone who carries them', 'up')}
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Carries {carries.length > 0 && `(${carries.length})`}
        </p>
        {shown('down', carries).map((e) => edgeRow(e, e.downstream_name, false))}
        {moreRow('down', carries.length)}
        {addRow('Add someone they carry', 'down')}
      </div>
    </div>
  );
}
