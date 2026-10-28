'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Cable, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { GmailIcon, SlackIcon, TelegramIcon } from '@/components/brand-icons';
import { confirmAction } from '@/components/confirm';
import { createClient } from '@/lib/supabase/client';
import { PROVIDER_LABEL, type ConnectedAccount, type Provider } from '@/lib/integrations/types';

/**
 * The accounts you connected, whose messages with companies on the board are
 * filed on those companies' history. Reads and writes go straight to
 * `connected_accounts` under RLS: you see only your own rows, and may change
 * only the two switches or delete the row. Connecting goes through the
 * provider's OAuth, on the server.
 */

export const PROVIDER_ICON: Record<Provider, (p: { className?: string }) => React.ReactElement> = {
  gmail: GmailIcon, slack: SlackIcon, telegram: TelegramIcon,
};

const STATUS: Record<ConnectedAccount['status'], string> = {
  active: 'Connected',
  needs_reauth: 'Connect again: the provider refused access',
  error: 'Last sync failed',
};

/** What a provider's callback reports in `?gmail=` / `?slack=`. */
const OUTCOME: Record<string, (name: string) => { ok: boolean; text: string }> = {
  connected: (n) => ({ ok: true, text: `${n} connected. The first sync, within five minutes, reads the last 30 days.` }),
  declined: (n) => ({ ok: false, text: `${n} was not connected: access was declined.` }),
  expired: () => ({ ok: false, text: 'That sign-in expired or was started elsewhere. Try again.' }),
  scopes: (n) => ({ ok: false, text: `${n} was connected without permission to read messages. Try again and allow it.` }),
  failed: (n) => ({ ok: false, text: `Could not connect ${n}. Try again.` }),
};

const ago = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  : 'not yet');

export function ConnectedAccounts({ available }: {
  /** Providers this deployment has credentials for; only these can be connected. */
  available: Provider[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('connected_accounts').select('*').order('created_at');
    if (error) return toast.error(`Could not load your accounts: ${error.message}`);
    setAccounts((data ?? []) as ConnectedAccount[]);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const params = useSearchParams();
  const router = useRouter();
  const provider = (['gmail', 'slack'] as Provider[]).find((p) => params.get(p));
  const outcome = provider ? params.get(provider) : null;
  useEffect(() => {
    const o = provider && outcome ? OUTCOME[outcome]?.(PROVIDER_LABEL[provider]) : undefined;
    if (!o) return;
    if (o.ok) toast.success(o.text); else toast.error(o.text);
    // Once: a reload should not announce it again.
    router.replace('/account');
  }, [provider, outcome, router]);

  const patch = async (account: ConnectedAccount, p: Pick<Partial<ConnectedAccount>, 'paused' | 'share_activity'>) => {
    setAccounts((prev) => prev?.map((a) => (a.id === account.id ? { ...a, ...p } : a)) ?? prev);
    const { error } = await supabase.from('connected_accounts').update(p).eq('id', account.id);
    if (error) {
      toast.error(`Could not save: ${error.message}`);
      void load();
    }
  };

  const disconnect = async (account: ConnectedAccount) => {
    if (!(await confirmAction({
      title: `Disconnect ${account.label}?`,
      body: 'Lanyard stops reading it and gives the access back. Messages already filed stay on the board.',
      action: 'Disconnect',
      destructive: true,
    }))) return;
    // Through the server, which revokes the grant at the provider first.
    const res = await fetch(`/api/integrations/accounts/${account.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return toast.error(`Could not disconnect: ${body.error ?? res.statusText}`);
    }
    setAccounts((prev) => prev?.filter((a) => a.id !== account.id) ?? prev);
    toast.success(`${account.label} disconnected`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <Cable aria-hidden className="size-4 text-primary" />
          Connected accounts
        </CardTitle>
        <CardDescription className="text-[12.5px] leading-relaxed">
          Messages you exchange with companies on the board are added to their history: the
          subject and a short snippet, never the whole message. Mail with anyone else is not read
          into Lanyard.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {accounts === null ? (
          <p className="text-[12.5px] text-muted-foreground">Loading…</p>
        ) : accounts.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Nothing connected yet.</p>
        ) : (
          <ul className="grid gap-2">
            {accounts.map((a) => {
              const Icon = PROVIDER_ICON[a.provider];
              return (
              <li key={a.id} className="grid gap-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-x-2">
                  <Icon className="size-4 shrink-0" />
                  <span className="sr-only">{PROVIDER_LABEL[a.provider]}:</span>
                  <span className="text-[13px] font-medium">{a.label}</span>
                  <span className={a.status === 'active' ? 'text-[11.5px] text-muted-foreground' : 'text-[11.5px] text-destructive'}>
                    · {a.paused ? 'Paused' : STATUS[a.status]}
                  </span>
                </div>
                <p className="text-[11.5px] text-muted-foreground">
                  Last synced {ago(a.last_synced_at)}
                  {a.status !== 'active' && a.last_error && ` — ${a.last_error}`}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`share-${a.id}`} checked={a.share_activity}
                      onCheckedChange={(v) => patch(a, { share_activity: v === true })}
                    />
                    <Label htmlFor={`share-${a.id}`} className="text-[12px] font-normal text-muted-foreground">
                      Share what it files with the team
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`pause-${a.id}`} checked={a.paused}
                      onCheckedChange={(v) => patch(a, { paused: v === true })}
                    />
                    <Label htmlFor={`pause-${a.id}`} className="text-[12px] font-normal text-muted-foreground">
                      Paused
                    </Label>
                  </div>
                  <Button variant="ghost" size="sm" className="ml-auto h-8 text-[12px]" onClick={() => disconnect(a)}>
                    <Unplug aria-hidden className="mr-1.5 size-3.5" />
                    Disconnect
                  </Button>
                </div>
              </li>
              );
            })}
          </ul>
        )}

        {available.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {available.map((p) => {
              const Icon = PROVIDER_ICON[p];
              return (
                <Button key={p} variant="outline" size="sm" className="h-9" asChild>
                  {/* A plain anchor: the connect route redirects to the provider. */}
                  <a href={`/api/integrations/${p}/connect`}>
                    <Icon className="mr-1.5 size-3.5" />
                    Connect {PROVIDER_LABEL[p]}
                  </a>
                </Button>
              );
            })}
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            No account types are set up on this deployment yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
