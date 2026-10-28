'use client';

import { useState } from 'react';
import { Check, Link2, Pencil, Undo2 } from 'lucide-react';
import { tip } from '@/components/hover-tip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizeHandle } from '@/components/resize-handle';
import { PanelChrome } from '@/components/panel-chrome';
import { DRAFT_FIELDS, type ContactDraft } from '@/components/lead-drawer';
import type { PanelChromeProps } from '@/components/drawer-stack';
import { LinkedInIcon } from '@/components/brand-icons';
import { CompanyLink } from '@/lib/entity-links';
import { GRADES } from '@/lib/domain';
import { GeorgianMark, KnownMark } from '@/components/partner-mark';
import { Checkbox } from '@/components/ui/checkbox';
import type { PersonMark } from '@/lib/person-marks';
import { isGeorgianName } from '@/lib/georgian';
import { ATTRIBUTION_CLASS, linkedinPeopleUrl, linkedinPersonSearchUrl } from '@/lib/people';
import { cn } from '@/lib/utils';
import type { Person } from '@/lib/types';

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[86px_1fr] gap-2 text-xs">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="min-w-0 break-words">{v || '—'}</dd>
    </div>
  );
}

function Section({ title, action, children }: {
  title: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h4>
        {action}
      </div>
      {children}
    </section>
  );
}

function LinkRow({ label, href, hint }: { label: string; href: string; hint?: string }) {
  return (
    <a
      href={href}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel="noopener"
      className="flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
    >
      <span className="truncate">{label}</span>
      {hint && <span className="shrink-0 text-[10px] opacity-70">{hint}</span>}
    </a>
  );
}

/** One person, as a column in the drawer stack. See panel-chrome.tsx. */
export function PersonPanel({
  person, mark, onMark, companyLinkedIn, onOpenCompany, onUpdate, onRevert, onDelete,
  width, onWidth, widthMin, widthMax, back, onBack, onClose,
}: PanelChromeProps & {
  person: Person;
  /** What a human has said about them, from person_marks. */
  mark: PersonMark | undefined;
  onMark: (person: Person, patch: Partial<PersonMark>) => void;
  companyLinkedIn: string | null;
  onOpenCompany: (companyId: string) => void;
  /** Desk-held people are updated; scraped ones get an override. */
  onUpdate: (person: Person, draft: ContactDraft) => Promise<boolean>;
  /** Clears a scraped person's override. */
  onRevert: (person: Person) => void;
  onDelete: (person: Person) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const [saving, setSaving] = useState(false);
  // Which role the details, edit and revert apply to; the name is the person's.
  const [roleId, setRoleId] = useState(person.id);
  const current = person.roles.find((r) => r.id === roleId) ?? person.roles[0];
  const role: Person = { ...person, ...current, full_name: person.full_name };
  const corrected = role.origin === 'scraped' && (role.overridden?.length ?? 0) > 0;

  const startEdit = () => setDraft({
    full_name: person.full_name,
    job_title: role.job_title ?? '',
    email: role.email ?? '',
    phone: role.phone ?? '',
    linkedin_url: role.linkedin_url ?? '',
  });

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    const ok = await onUpdate(role, draft);
    setSaving(false);
    if (ok) setDraft(null);
  };

  const grade = GRADES[role.attribution ?? 'unattributed'];
  const byRule = isGeorgianName(person.full_name);
  const georgianMark = mark?.georgian ?? null;
  const georgian = georgianMark ?? byRule;
  const known = mark?.known ?? false;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?person=${person.id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  };

  return (
    <PanelChrome
      label={person.full_name} width={width} back={back} onBack={onBack} onClose={onClose}
      resize={(
        <ResizeHandle
          side="left"
          invert
          label="Resize person panel"
          start={() => width}
          onResize={onWidth}
          min={widthMin}
          max={widthMax}
        />
      )}
    >
        <div className="flex shrink-0 flex-col gap-1 border-b border-border bg-card px-4 pb-2 pt-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <span className="truncate">{person.full_name}</span>
            {georgian && <GeorgianMark names={[person.full_name]} />}
            {known && <KnownMark name={person.full_name} />}
            <button
              type="button" onClick={copyLink} {...tip('Copy a link to this person')}
              className="shrink-0 text-muted-foreground hover:text-primary"
            >
              {copied ? <Check className="size-3.5 text-primary" /> : <Link2 className="size-3.5" />}
            </button>
          </h2>
          <p className="text-[11.5px] text-muted-foreground">
            {[role.job_title, role.company_name].filter(Boolean).join(' · ')}
          </p>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 pb-8">
            {person.roles.length > 1 && (
              <Section title="Roles">
                <ul className="space-y-1">
                  {person.roles.map((r) => (
                    <li key={r.id}
                      className={cn('flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                        r.id === current.id ? 'border-primary bg-primary/10' : 'border-border bg-secondary/40')}>
                      <span className="min-w-0 truncate">
                        {r.job_title ? `${r.job_title}, ` : ''}
                        <CompanyLink id={r.company_id} name={r.company_name} onOpen={onOpenCompany} />
                      </span>
                      {r.id !== current.id && (
                        <button type="button" onClick={() => { setRoleId(r.id); setDraft(null); }}
                          className="shrink-0 text-[11px] text-muted-foreground hover:text-primary">
                          Show
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {draft && (
              <Section title="Edit">
                <div className="space-y-2 rounded-md border border-border bg-secondary/40 p-2.5">
                  {DRAFT_FIELDS.map((f) => (
                    <div key={f.key} className="grid gap-1">
                      <Label className="text-[11px] text-muted-foreground">{f.label}</Label>
                      <Input
                        type={f.type} value={draft[f.key]}
                        onChange={(e) => setDraft((d) => d && ({ ...d, [f.key]: e.target.value }))}
                        aria-label={`${f.label} — ${person.full_name}`}
                        className="h-8 text-[13px]"
                      />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button size="sm" className="h-8 flex-1 text-xs"
                      disabled={saving || !draft.full_name.trim()} onClick={save}>
                      {saving ? 'Saving…' : 'Save'}
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 text-xs"
                      disabled={saving} onClick={() => setDraft(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </Section>
            )}

            <Section
              title="Details"
              action={!draft && (
                <div className="flex items-center gap-1">
                  {corrected && (
                    <button
                      type="button" onClick={() => onRevert(role)}
                      {...tip('Revert', 'Drop the corrections and show what the crawl found')}
                      className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-primary"
                    >
                      <Undo2 aria-hidden className="size-3" /> Revert
                    </button>
                  )}
                  <button
                    type="button" onClick={startEdit}
                    className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-primary"
                  >
                    <Pencil aria-hidden className="size-3" /> Edit
                  </button>
                </div>
              )}
            >
              <dl className="space-y-1">
                <Row k="Name" v={person.full_name} />
                <Row k="Job title" v={role.job_title} />
                <Row
                  k="Georgian"
                  v={(
                    <select
                      aria-label="Georgian tag"
                      value={georgianMark === null ? 'auto' : georgianMark ? 'yes' : 'no'}
                      onChange={(e) => onMark(person, {
                        georgian: e.target.value === 'auto' ? null : e.target.value === 'yes',
                      })}
                      className={cn(
                        'cursor-pointer appearance-none rounded-md border border-border',
                        'bg-transparent px-1.5 py-0.5 text-xs text-foreground',
                        'hover:border-primary focus:border-ring focus:outline-none',
                        '[&>option]:bg-popover [&>option]:text-popover-foreground',
                      )}
                    >
                      {/* Auto says what the rule decides, so choosing it is
                          not a guess about what happens next. */}
                      <option value="auto">Automatic — {byRule ? 'Georgian' : 'not Georgian'} by surname</option>
                      <option value="yes">Georgian</option>
                      <option value="no">Not Georgian</option>
                    </select>
                  )}
                />
                <Row
                  k="Known"
                  v={(
                    <label className="inline-flex cursor-pointer items-center gap-1.5">
                      <Checkbox
                        checked={known}
                        onCheckedChange={(v) => onMark(person, { known: v === true })}
                        aria-label="Know personally"
                      />
                      Know personally
                    </label>
                  )}
                />
                <Row
                  k="Company"
                  v={(
                    <CompanyLink
                      id={role.company_id} name={role.company_name}
                      onOpen={onOpenCompany}
                    />
                  )}
                />
                <Row
                  k="Email"
                  v={role.email && (
                    <a href={`mailto:${role.email}`} className="text-primary hover:underline">
                      {role.email}
                    </a>
                  )}
                />
                <Row
                  k="Phone"
                  v={role.phone && (
                    <a href={`tel:${role.phone}`} className="text-primary hover:underline">
                      {role.phone}
                    </a>
                  )}
                />
                <Row
                  k="LinkedIn"
                  v={role.linkedin_url && (
                    <a href={role.linkedin_url} target="_blank" rel="noopener"
                      className="text-primary hover:underline">
                      {role.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}
                    </a>
                  )}
                />
                <Row
                  k="Name source"
                  v={<span className={cn(ATTRIBUTION_CLASS[role.attribution ?? 'unattributed'])}>
                    {grade.label}
                  </span>}
                />
              </dl>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {grade.tip}
                {corrected && ' Corrected by hand; the scraped record is kept underneath.'}
              </p>
            </Section>

            {role.source_url && (
              <Section title="Where this came from">
                <LinkRow
                  label={role.source_url.replace(/^https?:\/\/(www\.)?/, '')}
                  href={role.source_url} hint="source"
                />
              </Section>
            )}

            <Section title="Look up manually">
              <div className="space-y-1">
                {!role.linkedin_url && (
                  <LinkRow
                    label={`Find ${person.full_name} on LinkedIn`}
                    href={linkedinPersonSearchUrl(person.full_name, role.company_name)}
                    hint="search"
                  />
                )}
                <LinkRow
                  label={`Everyone at ${role.company_name}`}
                  href={linkedinPeopleUrl(companyLinkedIn, role.company_name)}
                  hint={companyLinkedIn ? 'people tab' : 'search'}
                />
              </div>
            </Section>


            <Button
              variant="outline" size="sm" className="mt-4 h-7 w-full text-xs"
              onClick={() => onOpenCompany(role.company_id)}
            >
              Open {role.company_name}
            </Button>

            {/* Offered for scraped people too, which it was not.
                A scraped individual is still a named person with a right to
                erasure, and "we only found you on the internet" is not an
                exemption. Deleting the row alone would not have worked: the
                next ingest run puts them back, which is why erasure goes
                through `erase_contact` and leaves a hashed tombstone. */}
            <div className="mt-2">
              {confirming ? (
                <div className="space-y-2 rounded-md border border-l-[3px] border-border border-l-destructive bg-secondary/60 p-2.5">
                  <p className="text-[11.5px] leading-relaxed text-foreground">
                    {person.email
                      ? <>Erase every record of <b>{person.email}</b>, in both contact
                          tables, and stop ingestion restoring it. A hash of the
                          address is kept — only enough to recognise it on the way
                          back in, never enough to re-identify anyone.</>
                      : <>This person has no address on file, so there is nothing
                          to tombstone. The row will be deleted, and a future
                          crawl may find them again.</>}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive" size="sm" className="h-7 flex-1 text-xs"
                      onClick={() => { onDelete(person); setConfirming(false); }}
                    >
                      Erase permanently
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline" size="sm"
                  className="h-7 w-full text-xs text-destructive hover:text-destructive"
                  onClick={() => setConfirming(true)}
                >
                  Erase this person
                </Button>
              )}
            </div>
          </div>
        </ScrollArea>
    </PanelChrome>
  );
}
