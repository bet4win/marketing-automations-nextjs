'use client';

import { useMemo, useState } from 'react';
import { Building2, Check, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { Category, EventRow } from '@/lib/types';

/**
 * Create a company by hand.
 *
 * `companies` is otherwise scraper-owned and read-only in the browser. Insert
 * is the one exception, because a company someone types in is a new fact, not
 * an edit to a scraped one — and the seed merges on `normalized_name`, so if
 * ingestion later meets the same company it updates this row rather than
 * duplicating it. Nothing else about the row becomes editable.
 *
 * The normalisation below must stay in step with `ingest/seed.py:norm`, which
 * is what computes the same key on the ingest side. If they drift, a company
 * added here will duplicate the next time it is scraped.
 */
export function normalizeName(name: string) {
  let n = name.replace(/\(.*?\)/g, ' ').replace(/&/g, ' and ')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
  for (const suf of ['limited', 'ltd', 'gmbh', 'llc', 'inc', 'bv', 'nv', 'oy',
    'ab', 'plc', 'srl', 'sarl', 'aps', 'pte', 'sa', 'ag']) {
    if (n.endsWith(suf) && n.length > suf.length + 3) {
      n = n.slice(0, -suf.length);
      break;
    }
  }
  return n;
}

const cleanDomain = (v: string) =>
  v.trim().replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').toLowerCase() || null;

export function CompanyAdd({
  open, onOpenChange, categories, event, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: Category[];
  /** When a real event is selected, the new company is added to it. */
  event: EventRow | null;
  onCreated: (companyId: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [addToEvent, setAddToEvent] = useState(true);
  const [saving, setSaving] = useState(false);

  const grouped = useMemo(() => {
    const g: Record<string, Category[]> = {};
    categories.forEach((c) => { (g[c.group_name] ??= []).push(c); });
    return g;
  }, [categories]);

  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  const reset = () => {
    setName(''); setDomain(''); setCity(''); setCountry(''); setPicked([]);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return toast.error('A name is required.');
    const key = normalizeName(trimmed);
    if (!key) return toast.error('That name has no letters or digits in it.');

    setSaving(true);
    try {
      // Existing company with the same key? Open it instead of failing on the
      // unique index — the useful answer to "add X" when X is already here.
      const { data: existing } = await supabase
        .from('companies').select('id,name').eq('normalized_name', key).maybeSingle();
      if (existing) {
        toast.info(`${existing.name} is already in the database — opening it.`);
        onOpenChange(false);
        onCreated(existing.id);
        return;
      }

      const { data: created, error } = await supabase.from('companies').insert({
        name: trimmed,
        normalized_name: key,
        category_key: picked[0] ?? null,
        category_confidence: 'inferred',
        domain: cleanDomain(domain),
        domain_source: cleanDomain(domain) ? 'manual' : null,
        hq_city: city.trim() || null,
        hq_country: country.trim() || null,
        reach: 'Unknown',
        source: 'manual',
      }).select('id').single();
      if (error) throw error;

      if (picked.length) {
        const { error: catErr } = await supabase.from('company_categories').insert(
          picked.map((k, i) => ({
            company_id: created.id, category_key: k,
            is_primary: i === 0, source: 'manual',
          })));
        if (catErr) throw catErr;
      }

      if (addToEvent && event && event.kind !== undefined) {
        await supabase.from('event_entries')
          .insert({ event_id: event.id, company_id: created.id });
      }

      toast.success(`Added ${trimmed}`);
      reset();
      onOpenChange(false);
      onCreated(created.id);
    } catch (e) {
      toast.error(`Could not add: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const canAddToEvent = Boolean(event && event.id && !event.id.startsWith('__'));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] w-[620px] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border p-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Building2 aria-hidden className="size-4 text-primary" />
            Add a company
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ca-name" className="text-[11.5px] text-muted-foreground">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input id="ca-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Revolver Gaming" className="h-8 text-[13px]" />
              {name.trim() && (
                <p className="text-[11px] text-muted-foreground">
                  Dedup key: <code className="text-foreground">{normalizeName(name)}</code>
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ca-domain" className="text-[11.5px] text-muted-foreground">
                Website
              </Label>
              <Input id="ca-domain" value={domain} onChange={(e) => setDomain(e.target.value)}
                placeholder="revolvergaming.com" className="h-8 text-[13px]" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ca-city" className="text-[11.5px] text-muted-foreground">City</Label>
              <Input id="ca-city" value={city} onChange={(e) => setCity(e.target.value)}
                placeholder="London" className="h-8 text-[13px]" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ca-country" className="text-[11.5px] text-muted-foreground">
                Country
              </Label>
              <Input id="ca-country" value={country} onChange={(e) => setCountry(e.target.value)}
                placeholder="GB" className="h-8 text-[13px]" />
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Categories {picked.length > 0 && `— ${picked.length} selected, first is primary`}
            </p>
            <div className="space-y-2">
              {Object.entries(grouped).map(([group, list]) => (
                <div key={group}>
                  <p className="mb-1 text-[11px] text-muted-foreground">{group}</p>
                  <div className="flex flex-wrap gap-1">
                    {list.map((c) => {
                      const i = picked.indexOf(c.key);
                      const on = i >= 0;
                      return (
                        <button
                          key={c.key} type="button" onClick={() => toggle(c.key)}
                          aria-pressed={on}
                          className={cn(
                            'flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px]',
                            on
                              ? 'border-primary bg-primary/15 text-primary'
                              : 'border-border bg-secondary/40 text-muted-foreground hover:border-muted-foreground hover:text-foreground',
                          )}
                        >
                          {on && <Check aria-hidden className="size-3" />}
                          {c.label}
                          {i === 0 && <span className="text-[10px]">primary</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {canAddToEvent && (
            <label className="mt-4 flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <input type="checkbox" checked={addToEvent}
                onChange={(e) => setAddToEvent(e.target.checked)} />
              Also add to <span className="text-foreground">{event!.name}</span>
            </label>
          )}
        </div>

        <DialogFooter className="border-t border-border p-3">
          <Button variant="outline" size="sm" className="h-8 text-xs"
            onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" className="h-8 text-xs" disabled={saving || !name.trim()}
            onClick={save}>
            <Plus className="mr-1 size-3.5" />
            {saving ? 'Adding…' : 'Add company'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
