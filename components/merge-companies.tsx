'use client';

import { useEffect, useMemo, useState } from 'react';
import { Merge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { defaultKeeper, nameChoices } from '@/lib/merge';
import { cn } from '@/lib/utils';
import type { Lead } from '@/lib/types';

/**
 * Pick which company survives and what it is called. Permanent: everything on
 * the others moves to the keeper and they are deleted, so the dialog says what
 * each one holds before anything happens.
 */
export function MergeCompanies({
  open, onOpenChange, leads, peopleCount, onMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: Lead[];
  peopleCount: (companyId: string) => number;
  onMerge: (keep: string, drops: string[], name: string) => Promise<boolean>;
}) {
  const weights = useMemo(() => leads.map((l) => ({
    id: l.company_id, name: l.name, people: peopleCount(l.company_id),
    stands: l.stand_count ?? 0, events: l.event_count ?? 0, hasState: Boolean(l.company_status_id),
  })), [leads, peopleCount]);
  const names = useMemo(() => nameChoices(leads.map((l) => l.name)), [leads]);

  const [keep, setKeep] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  // Re-seeded on every open, so a second merge does not inherit the last one.
  useEffect(() => {
    if (!open || !weights.length) return;
    const k = defaultKeeper(weights);
    setKeep(k);
    setName(leads.find((l) => l.company_id === k)?.name ?? names[0] ?? '');
  }, [open, weights, leads, names]);

  const confirm = async () => {
    setBusy(true);
    const ok = await onMerge(keep, leads.map((l) => l.company_id).filter((id) => id !== keep), name);
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] w-[560px] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border p-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Merge aria-hidden className="size-4" /> Merge {leads.length} companies
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Keep</legend>
            {weights.map((w) => (
              <label key={w.id} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-xs',
                keep === w.id ? 'border-primary bg-primary/10' : 'border-border bg-secondary/40')}>
                <input type="radio" name="merge-keep" checked={keep === w.id} onChange={() => setKeep(w.id)}
                  className="accent-[oklch(0.78_0.11_184)]" />
                <span className="min-w-0 flex-1 truncate font-medium">{w.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {w.people} people · {w.stands} stands · {w.events} events
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</legend>
            {names.map((n) => (
              <label key={n} className="flex cursor-pointer items-center gap-2 text-xs">
                <input type="radio" name="merge-name" checked={name === n} onChange={() => setName(n)}
                  className="accent-[oklch(0.78_0.11_184)]" />
                {n}
              </label>
            ))}
          </fieldset>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Everything on the others — people, stands, pipeline, notes, deals and
            distribution — moves to the one you keep, and the others are deleted.
            Their names stay as aliases, so search and the next crawl both find
            the kept company. This cannot be undone.
          </p>
        </div>
        <DialogFooter className="border-t border-border p-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={confirm} disabled={busy || !keep || !name}>
            {busy ? 'Merging…' : `Merge into ${name || '…'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
