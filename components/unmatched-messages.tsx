'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { ConnectedAccount } from '@/lib/integrations/types';

/**
 * People no company on the board matches: mail you sent to an unknown
 * address, and Slack people from outside workspaces. Assigning one saves the
 * address as a contact (or the Slack id as a handle) of the company you pick,
 * so their next message matches by itself, and files what is waiting.
 * Ignoring drops it. Only your own rows are visible (RLS).
 */

type Unmatched = {
  id: string;
  account_id: string;
  channel: 'email' | 'slack' | 'telegram';
  direction: 'in' | 'out';
  address: string;
  name: string | null;
  subject: string | null;
  snippet: string | null;
  occurred_at: string;
  external_ref: string;
};

type Group = { address: string; name: string | null; rows: Unmatched[] };

function AssignRow({ group, onAssign, onIgnore }: {
  group: Group;
  onAssign: (g: Group, company: { id: string; name: string }) => Promise<void>;
  onIgnore: (g: Group) => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setHits([]);
    const t = setTimeout(async () => {
      const { data } = await supabase.from('company_resolved').select('id,name')
        .ilike('name', `%${q.replace(/[%_]/g, '')}%`).eq('hidden', false).order('name').limit(6);
      setHits((data ?? []) as { id: string; name: string }[]);
    }, 200);
    return () => clearTimeout(t);
  }, [query, supabase]);

  const latest = group.rows[0]!;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <li className="grid gap-1.5 rounded-md border border-border p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[12.5px] font-medium">{group.name ?? group.address}</span>
        {group.name && (
          <span className="text-[11.5px] text-muted-foreground">
            {/^(slack|telegram):/.test(group.address) ? group.address.split(':')[0].replace(/^./, (c) => c.toUpperCase()) : group.address}
          </span>
        )}
        <span className="text-[11.5px] text-muted-foreground">
          · {group.rows.length} message{group.rows.length === 1 ? '' : 's'}, last {latest.occurred_at.slice(0, 10)}
        </span>
      </div>
      {latest.subject && <p className="truncate text-[12px] text-muted-foreground">{latest.subject}</p>}
      <div className="flex gap-2">
        <Input
          value={query} onChange={(e) => setQuery(e.target.value)} disabled={busy}
          placeholder="Assign to a company…" aria-label={`Assign ${group.address} to a company`}
          className="h-8 text-[12.5px]"
        />
        <Button variant="ghost" size="sm" className="h-8 text-[12px]" disabled={busy}
          onClick={() => run(() => onIgnore(group))}>
          Ignore
        </Button>
      </div>
      {hits.map((c) => (
        <button
          key={c.id} type="button" disabled={busy}
          onClick={() => run(() => onAssign(group, c))}
          className="block w-full truncate rounded border border-border bg-secondary/60 px-2 py-1.5 text-left text-[12px] hover:border-primary"
        >
          {c.name}
        </button>
      ))}
    </li>
  );
}

export function UnmatchedMessages({ accounts, className }: { accounts: ConnectedAccount[]; className?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Unmatched[] | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('unmatched_messages').select('*')
      .order('occurred_at', { ascending: false }).limit(500);
    if (!error) setRows((data ?? []) as Unmatched[]);
  }, [supabase]);

  useEffect(() => { void load(); }, [load, accounts.length]);

  const groups = useMemo(() => {
    const by = new Map<string, Group>();
    for (const r of rows ?? []) {
      const g = by.get(r.address) ?? { address: r.address, name: r.name, rows: [] };
      g.rows.push(r);
      by.set(r.address, g);
    }
    return [...by.values()];
  }, [rows]);

  const drop = async (g: Group) => {
    const { error } = await supabase.from('unmatched_messages').delete().eq('address', g.address);
    if (error) throw new Error(error.message);
    setRows((prev) => prev?.filter((r) => r.address !== g.address) ?? prev);
  };

  const assign = async (g: Group, company: { id: string; name: string }) => {
    try {
      // A chat id (slack:T/U) is remembered as a handle; an address as a contact.
      const chat = /^(slack|telegram):(.+)$/.exec(g.address);
      const { error: ce } = chat
        ? await supabase.from('contact_handles').insert({
          company_id: company.id, channel: chat[1], handle: chat[2], full_name: g.name,
        })
        : await supabase.from('manual_contacts').insert({
          company_id: company.id, full_name: g.name ?? g.address, email: g.address,
          source: 'manual', is_personal_data: true, note: 'Added from an unmatched message',
        });
      if (ce) throw new Error(ce.message);
      const shared = new Map(accounts.map((a) => [a.id, a.share_activity]));
      const { error: ae } = await supabase.from('lead_activity').upsert(g.rows.map((r) => ({
        company_id: company.id, kind: 'message', channel: r.channel, direction: r.direction,
        subject: r.subject, body: r.snippet, occurred_at: r.occurred_at,
        met_name: g.name ?? g.address, account_id: r.account_id,
        external_ref: `${r.external_ref}|${company.id}`,
        private: shared.get(r.account_id) === false,
      })), { onConflict: 'channel,external_ref', ignoreDuplicates: true });
      if (ae) throw new Error(ae.message);
      for (const direction of new Set(g.rows.map((r) => r.direction))) {
        const first = [...g.rows].reverse().find((r) => r.direction === direction)!;
        await supabase.rpc('record_message_touch', {
          company: company.id, direction, on_date: first.occurred_at.slice(0, 10),
        });
      }
      await drop(g);
      toast.success(`${g.address} is now a contact at ${company.name}`);
    } catch (e) {
      toast.error(`Could not assign: ${(e as Error).message}`);
    }
  };

  const ignore = async (g: Group) => {
    try { await drop(g); } catch (e) { toast.error(`Could not ignore: ${(e as Error).message}`); }
  };

  if (!rows || groups.length === 0) return null;
  return (
    <div className={cn('grid gap-2', className)}>
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium">
        <Inbox aria-hidden className="size-3.5 text-primary" />
        People not on the board
      </p>
      <ul className="grid gap-2">
        {groups.map((g) => (
          <AssignRow key={g.address} group={g} onAssign={assign} onIgnore={ignore} />
        ))}
      </ul>
    </div>
  );
}
