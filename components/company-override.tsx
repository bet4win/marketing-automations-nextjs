'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, EyeOff, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createClient } from '@/lib/supabase/client';
import { REACHES, categoryClass } from '@/lib/domain';
import { processLogo, type Ink } from '@/lib/logo-image';
import { cn } from '@/lib/utils';
import type { Category, Lead, Reach } from '@/lib/types';

/**
 * Correct ingested data by hand.
 *
 * Writes `company_overrides`, never `companies`. The scraped value stays where
 * ingestion put it and the views prefer the override, so every correction is
 * reversible and a re-crawl can neither undo a fix nor be undone by one.
 *
 * Blank means "no opinion, use the ingested value", which is why each field
 * shows what would apply if you cleared it. Presenting an override as if it
 * were scraped is the thing to avoid — that is what the "edited" markers and
 * the per-field revert are for.
 */

type Field = 'name' | 'domain' | 'hq_city' | 'hq_country';

/**
 * Module scope, deliberately — the same trap that cost the filter rail its
 * search focus. Declared inside the component this is a new component *type*
 * every render, so React remounts the input on each keystroke and focus goes
 * with it.
 */
function OverrideRow({
  label, value, placeholder, edited, onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  edited: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        {label}
        {edited && (
          <span className="rounded bg-amber-500/20 dark:bg-amber-400/20 px-1 text-[10px] text-amber-700 dark:text-amber-300">edited</span>
        )}
      </Label>
      <Input
        value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} aria-label={label} className="h-8 text-[13px]"
      />
      {placeholder && !value.trim() && (
        <p className="text-[11px] text-muted-foreground">Blank — ingested value applies</p>
      )}
    </div>
  );
}

export type LogoDraft = { dataUri: string; ink: Ink; sourceUrl: string | null };

/**
 * A logo chosen by hand, from a link.
 *
 * The URL is fetched by `/api/company-logo` rather than by this component,
 * because the whole point of storing the pixels is that no user's browser ever
 * talks to the host the logo came from. What comes back is boxed to 96px here
 * — see `lib/logo-image.ts` for why the resizing is client-side.
 *
 * Both tiles are shown because `ink` is a guess the pipeline makes for you: a
 * white wordmark is invisible on white, so it earns a dark ground, and the
 * only way to know it chose right is to see it both ways before saving.
 */
function LogoRow({
  scraped, value, onChange,
}: {
  scraped: { dataUri: string; ink: Ink } | null;
  value: LogoDraft | null;
  onChange: (v: LogoDraft | null) => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const shown = value ?? scraped;

  const fetchIt = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/company-logo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `The server answered ${res.status}.`);
      const p = await processLogo(j.dataUri, j.contentType);
      onChange({ dataUri: p.dataUri, ink: p.ink, sourceUrl: j.sourceUrl ?? url.trim() });
      setUrl('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 grid gap-1.5">
      <Label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        Logo
        {value && (
          <span className="rounded bg-amber-500/20 dark:bg-amber-400/20 px-1 text-[10px] text-amber-700 dark:text-amber-300">edited</span>
        )}
      </Label>

      <div className="flex items-center gap-2">
        {(['light', 'dark'] as const).map((tile) => (
          <div
            key={tile}
            className={cn('flex h-14 w-24 items-center justify-center rounded-md border border-border',
              tile === 'light' ? 'bg-neutral-100' : 'bg-neutral-900')}
          >
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown.dataUri} alt="" className="max-h-10 max-w-20 object-contain" />
            ) : (
              <span className="text-[10px] text-muted-foreground">none</span>
            )}
          </div>
        ))}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {shown
            ? <>Reads as a <b>{shown.ink}</b> mark, so it gets {shown.ink === 'light' ? 'a dark tile' : 'no tile'}.</>
            : 'Nothing scraped for this company.'}
          {!value && scraped && <><br />Scraped. Paste a link to replace it.</>}
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fetchIt(); } }}
          placeholder="https://… a link to the logo image"
          aria-label="Logo image URL"
          className="h-8 text-[13px]"
        />
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 text-xs"
          onClick={fetchIt} disabled={busy || !url.trim()}>
          {busy ? 'Fetching…' : 'Fetch'}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-xs"
            onClick={() => onChange(null)}>
            Use the scraped one
          </Button>
        )}
      </div>
      {value?.sourceUrl && (
        <p className="truncate text-[11px] text-muted-foreground">From {value.sourceUrl}</p>
      )}
    </div>
  );
}

export function CompanyOverride({
  lead, open, onOpenChange, categories, onSaved,
}: {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: Category[];
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [draft, setDraft] = useState<Record<Field, string>>({
    name: '', domain: '', hq_city: '', hq_country: '',
  });
  const [reach, setReach] = useState<Reach | ''>('');
  const [cats, setCats] = useState<string[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [hiddenReason, setHiddenReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [logo, setLogo] = useState<LogoDraft | null>(null);
  const [scrapedLogo, setScrapedLogo] = useState<{ dataUri: string; ink: Ink } | null>(null);

  /**
   * Load the existing override when the dialog opens on a company.
   *
   * In an effect, not in the render body. The first version did both the
   * setState calls and the query inline during render, which React does not
   * allow — it took the whole page down with "This page couldn't load".
   */
  const companyId = lead?.company_id ?? null;
  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    setCats(lead?.category_keys ?? []);
    setHidden(Boolean(lead?.hidden));
    setHiddenReason(lead?.hidden_reason ?? '');
    supabase.from('company_overrides').select('*')
      .eq('company_id', companyId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setDraft({
          name: data?.name ?? '', domain: data?.domain ?? '',
          hq_city: data?.hq_city ?? '', hq_country: data?.hq_country ?? '',
        });
        setReach(data?.reach ?? '');
        setNote(data?.note ?? '');
        setLogo(data?.logo_data_uri
          ? {
            dataUri: data.logo_data_uri as string,
            ink: (data.logo_ink as Ink) ?? 'dark',
            sourceUrl: (data.logo_source_url as string) ?? null,
          }
          : null);
      });
    // `company_logos`, not the resolved view: this is the one screen that has
    // to show what you would get back by clearing the override, so it wants
    // the scraped row specifically rather than whichever one currently wins.
    supabase.from('company_logos').select('data_uri,ink')
      .eq('company_id', companyId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setScrapedLogo(data
          ? { dataUri: data.data_uri as string, ink: (data.ink as Ink) ?? 'dark' }
          : null);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyId, supabase]);

  // Every hook must run before the early return, or the hook order changes
  // between renders and React throws — which took the page down rather than
  // failing quietly.
  const grouped = useMemo(() => {
    const g: Record<string, Category[]> = {};
    categories.forEach((c) => { (g[c.group_name] ??= []).push(c); });
    return g;
  }, [categories]);

  if (!lead) return null;
  const isOver = (f: string) => (lead.overridden ?? []).includes(f);

  const toggleCat = (key: string) => setCats((p) => {
    const cur = p ?? [];
    return cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
  });

  const save = async () => {
    setSaving(true);
    try {
      const blank = (v: string) => (v.trim() ? v.trim() : null);
      const { error } = await supabase.from('company_overrides').upsert({
        company_id: lead.company_id,
        name: blank(draft.name),
        domain: blank(draft.domain)?.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, ''),
        hq_city: blank(draft.hq_city),
        hq_country: blank(draft.hq_country),
        reach: reach || null,
        hidden,
        hidden_reason: hidden ? blank(hiddenReason) : null,
        note: blank(note),
        // Null clears it, and clearing restores the scraped logo — the same
        // contract every other field here has.
        logo_data_uri: logo?.dataUri ?? null,
        logo_ink: logo?.ink ?? null,
        logo_source_url: logo?.sourceUrl ?? null,
      }, { onConflict: 'company_id' });
      if (error) throw error;

      // Categories: suppress what was unticked rather than deleting it, or the
      // next seed's `on conflict do nothing` would quietly bring it back.
      const want = cats ?? [];
      const { data: existing } = await supabase.from('company_categories')
        .select('category_key,is_primary,suppressed').eq('company_id', lead.company_id);
      const have = new Set((existing ?? []).map((r) => r.category_key));

      const toAdd = want.filter((k) => !have.has(k));
      if (toAdd.length) {
        const { error: e2 } = await supabase.from('company_categories').insert(
          toAdd.map((k, i) => ({
            company_id: lead.company_id, category_key: k,
            is_primary: i === 0 && want.length > 0 && !want.some((w) => have.has(w)),
            source: 'manual', suppressed: false,
          })));
        if (e2) throw e2;
      }
      for (const row of existing ?? []) {
        const shouldSuppress = !want.includes(row.category_key);
        if (shouldSuppress !== row.suppressed) {
          const { error: e3 } = await supabase.from('company_categories')
            .update({ suppressed: shouldSuppress })
            .eq('company_id', lead.company_id).eq('category_key', row.category_key);
          if (e3) throw e3;
        }
      }
      // Keep exactly one primary, and make it one the user still wants.
      if (want.length) {
        await supabase.from('company_categories').update({ is_primary: false })
          .eq('company_id', lead.company_id);
        await supabase.from('company_categories').update({ is_primary: true })
          .eq('company_id', lead.company_id).eq('category_key', want[0]);
      }

      toast.success(`Saved corrections for ${lead.name}`);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const revertAll = async () => {
    setSaving(true);
    const { error } = await supabase.from('company_overrides')
      .delete().eq('company_id', lead.company_id);
    await supabase.from('company_categories')
      .update({ suppressed: false }).eq('company_id', lead.company_id);
    setSaving(false);
    if (error) return toast.error(`Could not revert: ${error.message}`);
    toast.success('Reverted to the ingested values');
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] w-[680px] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border p-3">
          <DialogTitle className="text-sm">
            Correct ingested data — {lead.ingested_name ?? lead.name}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <p className="mb-3 rounded-r border border-l-[3px] border-border border-l-sky-600 dark:border-l-sky-400 bg-secondary/60 p-2.5 text-[12px] leading-relaxed text-foreground">
            Corrections are stored separately from the scraped data, so the next
            ingest run cannot undo them and clearing a field restores what was
            scraped. Leave anything blank to keep the ingested value.
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            {([
              ['name', 'Name', lead.ingested_name ?? lead.name],
              ['domain', 'Website', lead.domain ?? 'none ingested'],
              ['hq_city', 'City', lead.hq_city ?? 'none ingested'],
              ['hq_country', 'Country', lead.hq_country ?? 'none ingested'],
            ] as [Field, string, string][]).map(([f, label, ph]) => (
              <OverrideRow
                key={f} label={label} value={draft[f]} placeholder={ph}
                edited={isOver(f)}
                onChange={(v) => setDraft((d) => ({ ...d, [f]: v }))}
              />
            ))}
          </div>

          <LogoRow scraped={scrapedLogo} value={logo} onChange={setLogo} />

          <div className="mt-3 grid gap-1">
            <Label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              Market reach
              {isOver('reach') && (
                <span className="rounded bg-amber-500/20 dark:bg-amber-400/20 px-1 text-[10px] text-amber-700 dark:text-amber-300">edited</span>
              )}
            </Label>
            <div className="flex flex-wrap gap-1">
              {(['', ...REACHES] as const).map((r) => (
                <button
                  key={r || 'inherit'} type="button" onClick={() => setReach(r as Reach | '')}
                  aria-pressed={reach === r}
                  className={cn('rounded-full border px-2.5 py-0.5 text-[11.5px]',
                    reach === r
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground')}
                >
                  {r || `Ingested (${lead.reach ?? 'Unknown'})`}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Categories {cats?.length ? `— ${cats.length}, first is primary` : '— none'}
            </p>
            <div className="space-y-2">
              {Object.entries(grouped).map(([group, list]) => (
                <div key={group}>
                  <p className="mb-1 text-[11px] text-muted-foreground">{group}</p>
                  <div className="flex flex-wrap gap-1">
                    {list.map((c) => {
                      const on = (cats ?? []).includes(c.key);
                      const i = (cats ?? []).indexOf(c.key);
                      return (
                        <button
                          key={c.key} type="button" onClick={() => toggleCat(c.key)}
                          aria-pressed={on}
                          className={cn(
                            'flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px]',
                            on
                              ? `${categoryClass(c.key, c.group_name)} bg-secondary`
                              : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground')}
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
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Unticking an ingested category suppresses it rather than deleting
              it, so the next seed cannot bring it back.
            </p>
          </div>

          <div className="mt-4 grid gap-1">
            <Label className="text-[11.5px] text-muted-foreground">Why this was corrected</Label>
            <Textarea
              value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Optional — the reason, for whoever reads this next"
              aria-label="Override note" className="min-h-16 text-[13px]"
            />
          </div>

          <div className="mt-4 rounded-md border border-border bg-secondary/40 p-2.5">
            <label className="flex items-center gap-2 text-[12.5px] text-foreground">
              <input type="checkbox" checked={hidden}
                onChange={(e) => setHidden(e.target.checked)} />
              <EyeOff aria-hidden className="size-3.5 text-muted-foreground" />
              Hide this company from the listings
            </label>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Not a delete. Ingestion would restore a deleted row; a hidden one
              stays hidden, and stays here to inspect or un-hide.
            </p>
            {hidden && (
              <Input
                value={hiddenReason} onChange={(e) => setHiddenReason(e.target.value)}
                placeholder="Reason — e.g. duplicate, not a real company"
                aria-label="Reason for hiding" className="mt-2 h-8 text-[13px]"
              />
            )}
          </div>
        </div>

        <DialogFooter className="flex-row items-center gap-2 border-t border-border p-3">
          {(lead.overridden ?? []).length > 0 && (
            <Button variant="outline" size="sm" className="h-8 text-xs"
              disabled={saving} onClick={revertAll}>
              <RotateCcw className="mr-1 size-3.5" /> Revert all
            </Button>
          )}
          <Button variant="outline" size="sm" className="ml-auto h-8 text-xs"
            onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" className="h-8 text-xs" disabled={saving} onClick={save}>
            <Save className="mr-1 size-3.5" /> {saving ? 'Saving…' : 'Save corrections'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
