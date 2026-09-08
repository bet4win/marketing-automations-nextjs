'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createClient } from '@/lib/supabase/client';
import { parsePastedPeople, type DraftPerson } from '@/lib/paste-people';
import type { CompanyIndex } from '@/lib/entity-links';

/**
 * Paste a list of people copied off a page, review what was parsed, save it.
 *
 * The review step is the point. The parser guesses, so nothing reaches the
 * database until someone has looked at the rows and can fix or drop them —
 * which is what lets the heuristics be loose enough to be useful.
 */
export function PeopleImport({
  open, onOpenChange, companyIndex, defaultCompanyId, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyIndex: CompanyIndex;
  defaultCompanyId?: string | null;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [companyId, setCompanyId] = useState<string>(defaultCompanyId ?? '');
  const [companyQuery, setCompanyQuery] = useState('');
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<DraftPerson[]>([]);
  const [saving, setSaving] = useState(false);

  // The dialog stays mounted between opens, so the initial useState value is
  // only ever read once. Re-apply the caller's company each time it opens —
  // otherwise opening from Digitain's drawer would still show whichever
  // company was picked last time.
  useEffect(() => {
    if (!open) return;
    setCompanyId(defaultCompanyId ?? '');
    setCompanyQuery('');
  }, [open, defaultCompanyId]);

  const companies = useMemo(
    () => [...companyIndex.byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [companyIndex],
  );

  const matches = useMemo(() => {
    const q = companyQuery.trim().toLowerCase();
    if (!q) return [];
    return companies.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [companies, companyQuery]);

  const chosen = companyId ? companyIndex.byId.get(companyId) : null;

  const reparse = (v: string) => {
    setText(v);
    setDrafts(parsePastedPeople(v));
  };

  const edit = (key: string, field: keyof DraftPerson, value: string) =>
    setDrafts((d) => d.map((p) => (p.key === key ? { ...p, [field]: value } : p)));

  const save = async () => {
    if (!companyId) return toast.error('Pick a company first.');
    const rows = drafts.filter((d) => d.full_name.trim());
    if (!rows.length) return toast.error('Nothing to save.');

    setSaving(true);
    const { error } = await supabase.from('manual_contacts').upsert(
      rows.map((d) => ({
        company_id: companyId,
        full_name: d.full_name.trim(),
        job_title: d.job_title.trim() || null,
        email: d.email.trim() || null,
        phone: d.phone.trim() || null,
        linkedin_url: d.linkedin_url.trim() || null,
        source: 'pasted',
      })),
      { onConflict: 'company_id,full_name' },
    );
    setSaving(false);

    if (error) return toast.error(`Save failed: ${error.message}`);
    toast.success(`Saved ${rows.length} ${rows.length === 1 ? 'person' : 'people'} at ${chosen?.name}`);
    setText('');
    setDrafts([]);
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] w-[880px] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border p-3">
          <DialogTitle className="text-sm">Add people</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-[10.5px] text-muted-foreground">Company</Label>
              {chosen ? (
                <div className="flex items-center gap-2">
                  <span className="truncate rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs">
                    {chosen.name}
                  </span>
                  <Button variant="ghost" size="sm" className="h-6 text-[11px]"
                    onClick={() => { setCompanyId(''); setCompanyQuery(''); }}>
                    change
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    value={companyQuery}
                    onChange={(e) => setCompanyQuery(e.target.value)}
                    placeholder="Search companies…"
                    className="h-7 text-xs"
                  />
                  {matches.length > 0 && (
                    <div className="rounded-md border border-border">
                      {matches.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { setCompanyId(c.id); setCompanyQuery(''); }}
                          className="block w-full truncate px-2 py-1 text-left text-xs hover:bg-muted"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label className="text-[10.5px] text-muted-foreground">
                Paste the list you copied
              </Label>
              <Textarea
                value={text}
                onChange={(e) => reparse(e.target.value)}
                placeholder={'Aram Petrosyan\nHead of Business Development\n…'}
                className="min-h-24 font-mono text-[11px]"
              />
            </div>
          </div>

          {drafts.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {drafts.length} parsed — check before saving
              </p>
              <table className="w-full table-fixed border-collapse text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-[22%] px-1 pb-1">Name</th>
                    <th className="w-[24%] px-1 pb-1">Job title</th>
                    <th className="w-[22%] px-1 pb-1">Email</th>
                    <th className="w-[16%] px-1 pb-1">Phone</th>
                    <th className="px-1 pb-1">LinkedIn</th>
                    <th className="w-7" />
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => (
                    <tr key={d.key}>
                      {(['full_name', 'job_title', 'email', 'phone', 'linkedin_url'] as const).map((f) => (
                        <td key={f} className="px-1 py-0.5">
                          <Input
                            value={d[f]}
                            onChange={(e) => edit(d.key, f, e.target.value)}
                            className="h-6 px-1 text-[11px]"
                          />
                        </td>
                      ))}
                      <td className="px-1">
                        <button
                          type="button"
                          aria-label={`Remove ${d.full_name}`}
                          onClick={() => setDrafts((x) => x.filter((p) => p.key !== d.key))}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="mt-3 rounded-r border border-l-2 border-border border-l-amber-600 bg-secondary/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
                These are named individuals, so they are personal data under GDPR.
                Confirm a lawful basis before outreach, and be able to honour an
                erasure request — deleting the row here is that erasure.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border p-3">
          <Button variant="outline" size="sm" className="h-7 text-xs"
            onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" className="h-7 text-xs" disabled={saving || !drafts.length || !companyId}
            onClick={save}>
            {saving ? 'Saving…' : `Save ${drafts.length || ''}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
