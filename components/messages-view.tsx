'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/search-input';
import { UnmatchedMessages } from '@/components/unmatched-messages';
import { CHANNEL_LABEL } from '@/lib/domain';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { ConnectedAccount } from '@/lib/integrations/types';
import { directionOf, lastWordByCompany, noReplyYet, ourThreads, weOweReply } from '@/lib/messages';
import type { Activity } from '@/lib/types';

/**
 * Every written exchange with a company, newest first: what connected accounts
 * synced and what was logged by hand, typed emails included. A conversation is
 * a company's, so a row opens the company.
 *
 * The two questions it exists to answer are whose turn it is: companies
 * waiting on a reply from us, and companies we are waiting on, longest wait
 * first. The rule is lib/messages.ts.
 */

const LIMIT = 1000;

type Filter = 'all' | 'in' | 'out' | 'owe' | 'waiting';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'From them' },
  { key: 'out', label: 'From us' },
  { key: 'owe', label: 'We owe a reply' },
  { key: 'waiting', label: 'No reply yet' },
];

const TURN: Partial<Record<Filter, string>> = { owe: 'unanswered', waiting: 'waiting' };

const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export function MessagesView({ onOpenCompany }: { onOpenCompany: (companyId: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const [feed, own] = await Promise.all([
      supabase.from('activity_feed').select('*').in('kind', ['message', 'email'])
        .order('occurred_at', { ascending: false }).limit(LIMIT),
      supabase.from('connected_accounts').select('*'),
    ]);
    if (feed.error) setError(feed.error.message);
    else { setError(null); setRows((feed.data ?? []) as Activity[]); }
    setAccounts((own.data ?? []) as ConnectedAccount[]);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    if (!rows) return [];
    let out: Activity[];
    if (filter === 'owe' || filter === 'waiting') {
      const threads = ourThreads(rows);
      out = lastWordByCompany(rows)
        .filter((r) => (filter === 'owe' ? weOweReply(r, threads) : noReplyYet(r)))
        .reverse();
    } else {
      out = filter === 'all' ? rows : rows.filter((r) => directionOf(r) === filter);
    }
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return out;
    return out.filter((r) => {
      const hay = [r.company_name, r.met_name, r.subject, r.body].filter(Boolean).join(' ').toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [rows, filter, query]);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-3 py-1.5">
        <SearchInput
          value={query} onChange={setQuery}
          placeholder="Search messages — company, person, subject"
          ariaLabel="Search messages" className="h-7 w-[320px] text-xs"
        />
        <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
              className={cn(
                'rounded px-2.5 py-1 text-[11.5px] font-medium',
                filter === f.key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {TURN[filter] ? `${visible.length} companies` : `${visible.length} messages`}
        </span>
        <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => void load()}>
          <RefreshCw aria-hidden className="mr-1 size-3.5" /> Refresh
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {accounts.length > 0 && <UnmatchedMessages accounts={accounts} className="border-b border-border p-3" />}

        {error ? (
          <p className="p-10 text-center text-sm text-destructive">Could not load messages: {error}</p>
        ) : rows === null ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? 'No messages yet. Connect Gmail on your account page, or log one from a company.'
              : 'Nothing matches.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((r) => {
              const inbound = directionOf(r) === 'in';
              const Arrow = inbound ? ArrowDownLeft : ArrowUpRight;
              return (
                <li key={r.id}>
                  <button
                    type="button" onClick={() => onOpenCompany(r.company_id)}
                    className="grid w-full grid-cols-[5.5rem_minmax(0,12rem)_minmax(0,1fr)] items-baseline gap-x-3 px-3 py-2 text-left hover:bg-secondary/40"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {TURN[filter] ? `${daysSince(r.occurred_at)}d ${TURN[filter]}` : r.occurred_at.slice(0, 10)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">{r.company_name}</span>
                      <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                        <Arrow aria-hidden className={cn('size-3 shrink-0', inbound ? 'text-primary' : '')} />
                        <span className="sr-only">{inbound ? 'From them' : 'From us'}</span>
                        {r.channel ? CHANNEL_LABEL[r.channel] : 'Email'}
                        {r.met_name && ` · ${r.met_name}`}
                      </span>
                    </span>
                    <span className="min-w-0">
                      {r.subject && <span className="block truncate text-[12.5px] text-foreground">{r.subject}</span>}
                      {r.body && <span className="block truncate text-[12px] text-muted-foreground">{r.body}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
