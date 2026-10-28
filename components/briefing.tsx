'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sunrise } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { briefing, type BriefFollowUp, type Briefing } from '@/lib/briefing';
import { shift, today as todayLocal } from '@/lib/dates';
import { lastWordByCompany, ourThreads, weOweReply } from '@/lib/messages';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { Activity } from '@/lib/types';

/**
 * Today: follow-ups due, replies we owe, and the coming week, opened by itself
 * on the first visit of the day when anything needs doing, and from the
 * header's Today button any time. Follow-ups are the user's own and unowned
 * ones; replies owed use the Messages tab's rule (lib/messages.ts).
 */

const SEEN_KEY = 'lanyard.briefing.seen';

const shortDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Section({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode[] }) {
  return (
    <section className="space-y-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}{children.length > 0 && ` · ${children.length}`}
      </h3>
      {children.length ? <ul className="divide-y divide-border rounded-md border border-border">{children}</ul>
        : empty && <p className="text-[12.5px] text-muted-foreground">{empty}</p>}
    </section>
  );
}

function Row({ name, what, when, urgent, onOpen }: {
  name: string; what: string; when: string; urgent?: boolean; onOpen: () => void;
}) {
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="grid w-full grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-baseline gap-x-3 px-2.5 py-1.5 text-left hover:bg-secondary/40">
        <span className="truncate text-[12.5px] font-medium">{name}</span>
        <span className="truncate text-[12px] text-muted-foreground">{what}</span>
        <span className={cn('font-mono text-[11px]', urgent ? 'text-destructive' : 'text-muted-foreground')}>{when}</span>
      </button>
    </li>
  );
}

export function TodayBriefing({ email, onOpenCompany }: { email: string; onOpenCompany: (companyId: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [brief, setBrief] = useState<Briefing | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const today = todayLocal();
    const [follow, msgs] = await Promise.all([
      supabase.from('next_follow_ups')
        .select('company_id,company_name,next_action,next_action_on,contact_name')
        .or(`owner.eq."${email}",owner.is.null`)
        .lte('next_action_on', shift(today, 7)),
      supabase.from('activity_feed')
        .select('company_id,company_name,direction,cc_only,thread_ref,subject,met_name,occurred_at')
        .in('kind', ['message', 'email']).order('occurred_at', { ascending: false }).limit(3000),
    ]);
    const rows = (msgs.data ?? []) as Activity[];
    const threads = ourThreads(rows);
    const b = briefing({
      today,
      followUps: (follow.data ?? []) as BriefFollowUp[],
      owed: lastWordByCompany(rows).filter((r) => weOweReply(r, threads)),
    });
    setBrief(b);
    return b;
  }, [supabase, email]);

  // Once a day, and only when something needs doing: a briefing that says
  // "nothing" every morning teaches people to close it unread.
  useEffect(() => {
    void load().then((b) => {
      if (b.count > 0 && localStorage.getItem(SEEN_KEY) !== todayLocal()) setOpen(true);
    });
  }, [load]);

  const close = () => {
    localStorage.setItem(SEEN_KEY, todayLocal());
    setOpen(false);
  };
  const go = (companyId: string) => {
    close();
    onOpenCompany(companyId);
  };

  return (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs"
        onClick={() => { void load(); setOpen(true); }}>
        <Sunrise aria-hidden className="mr-1 size-3.5" />
        Today
        {brief && brief.count > 0 && (
          <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary">{brief.count}</span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="flex max-h-[85dvh] w-[640px] max-w-none flex-col gap-0 p-0 sm:max-w-none">
          <DialogHeader className="border-b border-border p-3">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Sunrise aria-hidden className="size-4 text-primary" />
              Today
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              {brief?.count
                ? `${brief.due.length} follow-up${brief.due.length === 1 ? '' : 's'} due, ${brief.owed.length} repl${brief.owed.length === 1 ? 'y' : 'ies'} to send.`
                : 'Nothing due and nothing to answer.'}
            </DialogDescription>
          </DialogHeader>

          {brief && (
            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
              <Section title="Waiting on a reply from us" empty="Nobody is waiting on us.">
                {brief.owed.map((o) => (
                  <Row key={o.company_id} name={o.company_name} onOpen={() => go(o.company_id)}
                    what={[o.met_name, o.subject].filter(Boolean).join(': ')}
                    when={o.days === 0 ? 'today' : `${o.days}d ago`} urgent={o.days >= 2} />
                ))}
              </Section>
              <Section title="Due and overdue" empty="No follow-ups due.">
                {brief.due.map((f) => (
                  <Row key={`${f.company_id}-${f.next_action_on}`} name={f.company_name} onOpen={() => go(f.company_id)}
                    what={[f.next_action ?? 'Follow up', f.contact_name && `with ${f.contact_name}`].filter(Boolean).join(', ')}
                    when={f.late === 0 ? 'today' : `${f.late}d late`} urgent={f.late > 0} />
                ))}
              </Section>
              <Section title="Coming up this week">
                {brief.soon.map((f) => (
                  <Row key={`${f.company_id}-${f.next_action_on}`} name={f.company_name} onOpen={() => go(f.company_id)}
                    what={[f.next_action ?? 'Follow up', f.contact_name && `with ${f.contact_name}`].filter(Boolean).join(', ')}
                    when={shortDate(f.next_action_on)} />
                ))}
              </Section>
            </div>
          )}

          <div className="flex justify-end border-t border-border p-3">
            <Button size="sm" onClick={close}>Got it</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
