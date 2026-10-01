'use client';

import { useEffect, useMemo, useState } from 'react';
import { Merge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { defaultRowKeeper, nameChoices } from '@/lib/merge';
import { cn } from '@/lib/utils';
import type { Person, PersonRole } from '@/lib/types';

/**
 * Rows at the same company are one role typed twice and collapse; rows at
 * different companies are roles of one person and are linked. Grouped by
 * company, so which is which is visible before confirming.
 */
export function MergePeople({
  open, onOpenChange, people, onMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: Person[];
  onMerge: (rows: string[], keep: string, name: string) => Promise<boolean>;
}) {
  const rows = useMemo(() => people.flatMap((p) => p.roles), [people]);
  const byCompany = useMemo(() => {
    const m = new Map<string, PersonRole[]>();
    for (const r of rows) m.set(r.company_id, [...(m.get(r.company_id) ?? []), r]);
    return [...m.values()];
  }, [rows]);
  const names = useMemo(() => nameChoices(people.map((p) => p.full_name)), [people]);

  const [keepAt, setKeepAt] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKeepAt(Object.fromEntries(byCompany.map((g) => [g[0].company_id, defaultRowKeeper(g)])));
    setName(names[0] ?? '');
  }, [open, byCompany, names]);

  const confirm = async () => {
    setBusy(true);
    // `keep` decides the person's marks first; the first company's survivor.
    const keep = keepAt[byCompany[0][0].company_id];
    const ordered = [...Object.values(keepAt), ...rows.map((r) => r.id).filter((id) => !Object.values(keepAt).includes(id))];
    const ok = await onMerge(ordered, keep, name);
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] w-[600px] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border p-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Merge aria-hidden className="size-4" /> Merge into one person
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</legend>
            {names.map((n) => (
              <label key={n} className="flex cursor-pointer items-center gap-2 text-xs">
                <input type="radio" name="merge-person-name" checked={name === n} onChange={() => setName(n)}
                  className="accent-[oklch(0.78_0.11_184)]" />
                {n}
              </label>
            ))}
          </fieldset>
          {byCompany.map((group) => (
            <fieldset key={group[0].company_id} className="space-y-1.5">
              <legend className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group[0].company_name}{group.length > 1 ? ' — keep one' : ' — kept as a role'}
              </legend>
              {group.map((r) => (
                <label key={r.id} className={cn('flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs',
                  group.length > 1 && 'cursor-pointer',
                  keepAt[r.company_id] === r.id ? 'border-primary bg-primary/10' : 'border-border bg-secondary/40')}>
                  {group.length > 1 && (
                    <input type="radio" name={`keep-${r.company_id}`} checked={keepAt[r.company_id] === r.id}
                      onChange={() => setKeepAt((k) => ({ ...k, [r.company_id]: r.id }))}
                      className="accent-[oklch(0.78_0.11_184)]" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    <b>{r.full_name}</b>{r.job_title ? ` · ${r.job_title}` : ''}
                  </span>
                  <span className="shrink-0 truncate text-muted-foreground">
                    {[r.email, r.phone].filter(Boolean).join(' · ') || 'no address'}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            At a company with more than one row, the one you keep takes any details
            the others have, and the others are removed. Each other company stays
            as a role of the same person. This cannot be undone.
          </p>
        </div>
        <DialogFooter className="border-t border-border p-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={confirm} disabled={busy || !name}>
            {busy ? 'Merging…' : `Merge as ${name || '…'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
