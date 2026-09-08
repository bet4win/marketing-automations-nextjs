'use client';

import { useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizeHandle } from '@/components/resize-handle';
import { PanelChrome } from '@/components/panel-chrome';
import type { PanelChromeProps } from '@/components/drawer-stack';
import { LinkedInIcon } from '@/components/brand-icons';
import { CompanyLink } from '@/lib/entity-links';
import { GRADES } from '@/lib/domain';
import { ATTRIBUTION_CLASS, linkedinPeopleUrl } from '@/lib/people';
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
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
  person, companyLinkedIn, onOpenCompany, onDelete,
  width, onWidth, widthMin, widthMax, back, onBack, onClose,
}: PanelChromeProps & {
  person: Person;
  companyLinkedIn: string | null;
  onOpenCompany: (companyId: string) => void;
  /** Only offered for hand-entered people; scraped rows are fixed in ingestion. */
  onDelete: (person: Person) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const grade = GRADES[person.attribution ?? 'unattributed'];

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
            <button
              type="button" onClick={copyLink} title="Copy a link to this person"
              className="shrink-0 text-muted-foreground hover:text-primary"
            >
              {copied ? <Check className="size-3.5 text-primary" /> : <Link2 className="size-3.5" />}
            </button>
          </h2>
          <p className="text-[11.5px] text-muted-foreground">
            {[person.job_title, person.company_name].filter(Boolean).join(' · ')}
          </p>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 pb-8">
            <Section title="Details">
              <dl className="space-y-1">
                <Row k="Name" v={person.full_name} />
                <Row k="Job title" v={person.job_title} />
                <Row
                  k="Company"
                  v={(
                    <CompanyLink
                      id={person.company_id} name={person.company_name}
                      onOpen={onOpenCompany}
                    />
                  )}
                />
                <Row
                  k="Email"
                  v={person.email && (
                    <a href={`mailto:${person.email}`} className="text-primary hover:underline">
                      {person.email}
                    </a>
                  )}
                />
                <Row
                  k="Phone"
                  v={person.phone && (
                    <a href={`tel:${person.phone}`} className="text-primary hover:underline">
                      {person.phone}
                    </a>
                  )}
                />
                <Row
                  k="LinkedIn"
                  v={person.linkedin_url && (
                    <a href={person.linkedin_url} target="_blank" rel="noopener"
                      className="text-primary hover:underline">
                      {person.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}
                    </a>
                  )}
                />
                <Row
                  k="Name source"
                  v={<span className={cn(ATTRIBUTION_CLASS[person.attribution ?? 'unattributed'])}>
                    {grade.label}
                  </span>}
                />
              </dl>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{grade.tip}</p>
            </Section>

            {person.source_url && (
              <Section title="Where this came from">
                <LinkRow
                  label={person.source_url.replace(/^https?:\/\/(www\.)?/, '')}
                  href={person.source_url} hint="source"
                />
              </Section>
            )}

            <Section title="Look up manually">
              <div className="space-y-1">
                {!person.linkedin_url && (
                  <LinkRow
                    label={`Find ${person.full_name} on LinkedIn`}
                    href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${person.full_name} ${person.company_name}`)}`}
                    hint="search"
                  />
                )}
                <LinkRow
                  label={`Everyone at ${person.company_name}`}
                  href={linkedinPeopleUrl(companyLinkedIn, person.company_name)}
                  hint={companyLinkedIn ? 'people tab' : 'search'}
                />
              </div>
            </Section>

            {person.is_personal_data && (
              <p className="rounded-r border border-l-2 border-border border-l-amber-600 bg-secondary/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
                This record identifies a named individual and is personal data under
                GDPR. Confirm a lawful basis before outreach, and be able to honour
                an erasure request.
              </p>
            )}

            <Button
              variant="outline" size="sm" className="mt-4 h-7 w-full text-xs"
              onClick={() => onOpenCompany(person.company_id)}
            >
              Open {person.company_name}
            </Button>

            {/* Erasure. Only hand-entered rows can go: a scraped row would come
                straight back on the next ingestion run, so deleting it here
                would be a button that quietly does nothing. */}
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
                  Erase this person (GDPR)
                </Button>
              )}
            </div>
          </div>
        </ScrollArea>
    </PanelChrome>
  );
}
