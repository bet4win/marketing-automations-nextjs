'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AtSign, Building2, CalendarDays, Check, Copy, ExternalLink, FileText, Globe,
  Handshake, Landmark, Link2, MapPin, Megaphone, Phone, ShieldAlert, Sparkles,
  Tag, Ticket, TrendingUp, UserPlus, Users, History, MessageSquarePlus, Briefcase,
  Network,
} from 'lucide-react';
import {
  FacebookIcon, InstagramIcon, LinkedInIcon, TelegramIcon, XIcon, YouTubeIcon,
} from '@/components/brand-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizeHandle } from '@/components/resize-handle';
import { PanelChrome } from '@/components/panel-chrome';
import { PartnerMark, ReachMark } from '@/components/partner-mark';
import type { PanelChromeProps } from '@/components/drawer-stack';
import { Textarea } from '@/components/ui/textarea';
import { OwnerSelect } from '@/components/owner-select';
import { StatusSelect } from '@/components/status-select';
import { Field, IconLink, LinkTile, Note, Panel, type IconType } from '@/components/drawer-ui';
import { Pencil } from 'lucide-react';
import { linkifyCompanies, type CompanyIndex } from '@/lib/entity-links';
import {
  GRADES, REACH_CLASS, categoryClass, emailsOf, formatRevenue, phonesOf, researchLinks,
} from '@/lib/domain';
import { isLinkedInUrl, linkedinPeopleUrl, profileHost } from '@/lib/people';
import { cn } from '@/lib/utils';
import type {
  Activity, CompanyLogo, Contact, DistributionEdge, EventRow, Lead, Opportunity,
  Owner, ReachRoute, Status,
} from '@/lib/types';
import { DealPanel } from '@/components/deal-panel';
import { ReachPanel } from '@/components/reach-panel';

/**
 * The native selects carry no chrome of their own — they are bare in the table,
 * where a border per row would be noise. In this form they sit between bordered
 * inputs, so they get a matching box. One constant rather than four copies.
 */
/** Short, because the row already shows the date and the company. */
const ACTIVITY_LABEL: Record<Activity['kind'], string> = {
  met: 'Met', call: 'Call', email: 'Email', note: 'Note',
  // Written by a trigger, not typed, so it is worth marking as such.
  stage: 'Stage',
};

const FIELD_BOX = 'rounded-md border border-border px-1 py-1';

const SOCIALS = [
  { key: 'linkedin_url', icon: LinkedInIcon, label: 'LinkedIn' },
  { key: 'x_url', icon: XIcon, label: 'X / Twitter' },
  { key: 'facebook_url', icon: FacebookIcon, label: 'Facebook' },
  { key: 'instagram_url', icon: InstagramIcon, label: 'Instagram' },
  { key: 'youtube_url', icon: YouTubeIcon, label: 'YouTube' },
  { key: 'telegram_url', icon: TelegramIcon, label: 'Telegram' },
] as const;

/** What the add form collects. Everything else about the row is derived. */
export type ContactDraft = {
  full_name: string;
  job_title: string;
  email: string;
  phone: string;
  linkedin_url: string;
};

const EMPTY_DRAFT: ContactDraft = {
  full_name: '', job_title: '', email: '', phone: '', linkedin_url: '',
};

const DRAFT_FIELDS: { key: keyof ContactDraft; label: string; type?: string }[] = [
  { key: 'full_name', label: 'Name' },
  { key: 'job_title', label: 'Role' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  // The field the paste importer has always had. Leaving it off here made the
  // two ways of entering a person disagree about what a person has. Named for
  // both, because the column takes any profile URL and routinely holds one.
  { key: 'linkedin_url', label: 'LinkedIn / profile', type: 'url' },
];

/** One destination on a contact row. Module scope, like everything else here. */
function ContactAction({ icon: Icon, label, href, onClick }: {
  // `IconType`, not `LucideIcon`: the LinkedIn mark is one of the hand-rolled
  // brand icons, and that is the type the panel's other icon props already use.
  icon: IconType;
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  const className = 'shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-primary';
  // No `aria-hidden` here: the anchor or button carries the label, and the
  // brand marks set it on their own svg already.
  const inner = <Icon className="size-3.5" />;
  return href ? (
    <a
      href={href}
      {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}
      title={label} aria-label={label} className={className}
    >
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} title={label} aria-label={label} className={className}>
      {inner}
    </button>
  );
}

/**
 * A contact, and every way of reaching them offered as its own control.
 *
 * The row used to be one `mailto:` wrapped round the name, so clicking a
 * person opened a mail composer — the single most likely thing to click, and
 * an irreversible-feeling one, chosen for you. Writing to someone is now one
 * button among several and nothing happens by default.
 *
 * Clicking the person opens their panel instead, pushed onto the stack, which
 * is where the attribution grade, the source page and erasure live.
 *
 * **Only a named contact opens a panel.** `lib/people.ts` draws the line
 * already — a row with no name is an address, not a person — and a panel
 * headed by an email address would be a profile of nobody. Those rows keep
 * their buttons and stay unclickable, which is honest about what we hold.
 *
 * Not a `LinkTile`, and not one big button: there are now up to five
 * destinations on this row, and nesting them inside a single anchor or button
 * is invalid markup the browser is free to flatten.
 */
function ContactRow({ contact: c, hint, title, onOpen }: {
  contact: Contact;
  hint: string;
  title?: string;
  onOpen?: (c: Contact) => void;
}) {
  const [copied, setCopied] = useState(false);
  const Icon = c.email ? AtSign : c.phone ? Phone : Users;
  const label = c.full_name ?? c.email ?? c.phone ?? '—';
  const sub = c.full_name
    ? [c.job_title, c.email ?? c.phone].filter(Boolean).join(' · ')
    : c.job_title ?? '';
  const onLinkedIn = isLinkedInUrl(c.linkedin_url);
  const profileLabel = `Open ${label} on ${onLinkedIn ? 'LinkedIn' : profileHost(c.linkedin_url ?? '')}`;
  const openable = Boolean(c.full_name && onOpen);

  const copy = async () => {
    const what = c.email ?? c.phone;
    if (!what) return;
    try {
      await navigator.clipboard.writeText(what);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — the address is on screen either way */ }
  };

  const text = (
    <>
      <span className="block truncate text-[12.5px] text-foreground">{label}</span>
      {sub && <span className="block truncate text-[11.5px] text-muted-foreground">{sub}</span>}
    </>
  );

  return (
    <div
      title={title}
      className="flex w-full items-center gap-1 rounded-md border border-border bg-secondary/40 px-2.5 py-2 hover:border-primary hover:bg-secondary"
    >
      <Icon aria-hidden className="mr-1 size-3.5 shrink-0 text-muted-foreground" />
      {openable ? (
        <button
          type="button" onClick={() => onOpen!(c)}
          title={`Open ${label}`}
          className="min-w-0 flex-1 text-left hover:underline"
        >
          {text}
        </button>
      ) : (
        <span className="min-w-0 flex-1">{text}</span>
      )}

      {c.email && (
        <ContactAction icon={AtSign} label={`Email ${label}`} href={`mailto:${c.email}`} />
      )}
      {c.phone && (
        <ContactAction icon={Phone} label={`Call ${label}`} href={`tel:${c.phone}`} />
      )}
      {/* The column is called `linkedin_url` and holds whatever profile was
          found — every person from the onlyigaming directory carries one of
          theirs. LinkedIn's mark is what people scan for, so it only appears
          when the link really goes there. */}
      {c.linkedin_url && (
        <ContactAction
          icon={onLinkedIn ? LinkedInIcon : ExternalLink}
          label={profileLabel} href={c.linkedin_url}
        />
      )}
      {(c.email || c.phone) && (
        <ContactAction
          icon={copied ? Check : Copy}
          label={copied ? 'Copied' : `Copy ${c.email ?? c.phone}`}
          onClick={copy}
        />
      )}

      <span className="ml-1 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
        {hint}
      </span>
    </div>
  );
}

/**
 * Everyone we hold for this company, however we came by them.
 *
 * This replaced a pair of free-text boxes headed "Contact you confirmed" that
 * wrote to `lead_states`. The problem was not the fields but where they went:
 * a name typed there was invisible to the people directory, the has-email
 * filter, the Contact column, the CSV export and erasure, and it was scoped to
 * one event, so the same person had to be retyped per show. A contact someone
 * types in is a contact — it goes to `manual_contacts` with the rest.
 *
 * Module scope, not declared inside `CompanyPanel`: a component defined in
 * another's body is a new type on every render, and the inputs below would
 * lose focus on every keystroke.
 */
function ContactsPanel({
  contacts, companyName, onAdd, onOpenPerson,
}: {
  contacts: Contact[];
  companyName: string;
  onAdd: (draft: ContactDraft) => Promise<boolean>;
  onOpenPerson: (c: Contact) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_DRAFT);

  const emails = emailsOf(contacts);
  const phones = phonesOf(contacts);
  // Someone typed in from a business card may have neither an address nor a
  // number yet. They are still who to ask for at the stand, so a row cannot be
  // dropped for having nothing to click.
  const nameOnly = contacts.filter((c) => c.full_name && !c.email && !c.phone);
  const entered = contacts.some((c) => c.origin === 'entered');

  const hintFor = (c: Contact) => (c.origin === 'entered'
    ? 'entered' : GRADES[c.attribution ?? 'unattributed'].label);
  const tipFor = (c: Contact) => (c.origin === 'entered'
    ? 'Typed in here, not found by a crawl.'
    : `${GRADES[c.attribution ?? 'unattributed'].tip}${c.source_url ? `\nFound on ${c.source_url}` : ''}`);

  const save = async () => {
    setSaving(true);
    const ok = await onAdd(draft);
    setSaving(false);
    if (!ok) return;
    setDraft(EMPTY_DRAFT);
    setAdding(false);
  };

  return (
    <Panel
      icon={AtSign} title="Contacts"
      action={!adding && (
        <button
          type="button" onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-primary"
        >
          <UserPlus aria-hidden className="size-3.5" /> Add
        </button>
      )}
    >
      {emails.length + phones.length + nameOnly.length === 0 && !adding && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Nobody yet. Add one you have met or found, or paste a list under People
          below.
        </p>
      )}

      <div className="space-y-1.5">
        {emails.map((c) => (
          <ContactRow key={c.id} contact={c} hint={hintFor(c)} title={tipFor(c)}
            onOpen={onOpenPerson} />
        ))}
        {phones.map((c) => (
          <ContactRow
            key={c.id} contact={c}
            hint={c.origin === 'entered' ? 'entered' : 'switchboard'}
            onOpen={onOpenPerson}
          />
        ))}
        {nameOnly.map((c) => (
          <ContactRow key={c.id} contact={c} hint={hintFor(c)} title={tipFor(c)}
            onOpen={onOpenPerson} />
        ))}
      </div>

      {adding && (
        <div className="mt-2 space-y-2 rounded-md border border-border bg-secondary/40 p-2.5">
          {DRAFT_FIELDS.map((f) => (
            <div key={f.key} className="grid gap-1">
              <Label className="text-[11px] text-muted-foreground">{f.label}</Label>
              <Input
                type={f.type} value={draft[f.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                aria-label={`${f.label} — new contact at ${companyName}`}
                className="h-8 text-[13px]"
              />
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" className="h-8 flex-1 text-xs"
              disabled={saving || !draft.full_name.trim()} onClick={save}>
              {saving ? 'Saving…' : 'Add contact'}
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs"
              onClick={() => { setAdding(false); setDraft(EMPTY_DRAFT); }}>
              Cancel
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Saved against the company, not this event — you are recording who
            they are, which does not change per show.
          </p>
        </div>
      )}

      <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
        Scraped addresses are retrieved from source, never generated, and the tag
        says how firmly a name is attached to one.
        {entered && ' Rows marked entered were typed in here.'}
      </p>

      {[...emails, ...phones, ...nameOnly].some((c) => c.is_personal_data) && (
        <div className="mt-2">
          <Note tone="warn" icon={ShieldAlert}>
            Contacts marked personal identify a named individual and are personal
            data under GDPR. Confirm a lawful basis and be able to honour
            erasure — which is the delete in the person&apos;s own panel.
          </Note>
        </div>
      )}
    </Panel>
  );
}

/**
 * One company, as a column in the drawer stack.
 *
 * Renders no `Sheet` — see panel-chrome.tsx. It also no longer owns its width:
 * the stack does, because whether the next panel fits depends on this one.
 */
export function CompanyPanel({
  lead, contacts, statuses, owners, event, onPatch, onBooth,
  companyIndex, onOpenCompany, onOpenCompanyAt, allEvents, onAddPeople, onAddContact,
  onOpenPerson,
  onEdit,
  activity, onLoadActivity, onCapture, onDeleteActivity,
  logo, onLoadLogo,
  deals, edges, routes, onLoadCommerce, onCreateDeal, onPatchDeal, onDeleteDeal,
  onAddEdge, onRemoveEdge, onRateEdge,
  width, onWidth, widthMin, widthMax, back, onBack, onClose,
}: PanelChromeProps & {
  lead: Lead;
  contacts: Contact[];
  statuses: Status[];
  owners: Owner[];
  event: EventRow | null;
  onPatch: (lead: Lead, patch: Partial<Lead>, scope: 'event' | 'company') => void;
  /** The event is passed explicitly — this drawer's lead is not always on the
      board, so the caller's idea of "current event" can be the wrong show. */
  onBooth: (booth: string, at?: EventRow | null) => void;
  companyIndex: CompanyIndex;
  onOpenCompany: (companyId: string) => void;
  onOpenCompanyAt: (eventId: string, companyId: string) => void;
  allEvents: EventRow[];
  onAddPeople: (companyId: string) => void;
  /** Pushes a contact's own panel onto the stack. Named contacts only — see
   *  ContactRow for why an address does not get a profile. */
  onOpenPerson: (c: Contact) => void;
  /** Resolves false when the insert failed, so the form keeps what was typed. */
  onAddContact: (companyId: string, draft: ContactDraft) => Promise<boolean>;
  onEdit: (lead: Lead) => void;
  /** Undefined until loaded; empty array means genuinely nothing recorded. */
  activity: Activity[] | undefined;
  onLoadActivity: (companyId: string) => void;
  onCapture: (lead: Lead) => void;
  /** A visit logged against the wrong company has to be removable. */
  onDeleteActivity: (a: Activity) => void;
  /** `undefined` until fetched, `null` when the company has none. */
  logo: CompanyLogo | null | undefined;
  onLoadLogo: (companyId: string) => void;
  deals: Opportunity[] | undefined;
  edges: DistributionEdge[] | undefined;
  routes: ReachRoute[] | undefined;
  onLoadCommerce: (companyId: string) => void;
  onCreateDeal: (companyId: string, draft: Partial<Opportunity>) => void;
  onPatchDeal: (companyId: string, id: string, patch: Partial<Opportunity>) => void;
  onDeleteDeal: (companyId: string, deal: Opportunity) => void;
  onAddEdge: (
    forCompany: string, upstreamId: string, downstreamId: string,
    basis?: DistributionEdge['rate_basis'],
  ) => void;
  onRateEdge: (
    forCompany: string, edge: DistributionEdge,
    patch: {
      rate_pct?: number | null;
      rate_basis?: DistributionEdge['rate_basis'];
      confidence?: DistributionEdge['confidence'];
    },
  ) => void;
  onRemoveEdge: (forCompany: string, edge: DistributionEdge) => void;
}) {
  const [copied, setCopied] = useState(false);

  // Fetched when the panel opens rather than with the board: 2,351 companies
  // of timeline is a lot of rows nobody asked for.
  //
  // `edges === undefined` is a dependency, not just a condition. Dropping the
  // edge cache is how a new connection reaches every panel that is showing
  // one — and a panel that is already mounted when that happens sees no
  // dependency change, so it would sit on an empty Reach section until it was
  // closed and reopened. The desk drops duplicate requests, so a panel asking
  // again costs nothing.
  useEffect(() => {
    if (activity === undefined) onLoadActivity(lead.company_id);
    if (deals === undefined || edges === undefined) onLoadCommerce(lead.company_id);
    if (logo === undefined) onLoadLogo(lead.company_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.company_id, activity === undefined, deals === undefined,
      edges === undefined, logo === undefined]);

  const link = (text: string | null) =>
    linkifyCompanies(text, companyIndex, { selfId: lead.company_id, onOpen: onOpenCompany });

  /**
   * A note typed at a stand names other companies as readily as an ingested
   * one does — "they take Hub88's feed" has to be followable from the history
   * too, not only from the Apollo note above it.
   *
   * Memoised, unlike the three single notes, because linkifying is one regex
   * per known company name per string: over a timeline it is the whole index
   * again for every entry, on every render of a panel that also holds
   * textareas.
   */
  const activityBodies = useMemo(
    () => new Map((activity ?? [])
      .filter((a) => a.body)
      .map((a) => [a.id, link(a.body)] as const)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activity, companyIndex, lead.company_id, onOpenCompany],
  );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/?company=${lead.company_id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  };

  const emails = emailsOf(contacts);
  const socials = SOCIALS
    .map((s) => ({ ...s, url: lead[s.key] as string | null }))
    .filter((s) => s.url);
  // Booth, zone and floorplan only mean something at a trade show. Test for
  // that positively rather than listing the kinds that are not one, so a new
  // kind added later does not silently start rendering empty booth fields.
  const isShow = event?.kind === 'event';
  const scopeLabel = event?.kind === 'all' ? 'Ongoing'
    : event?.kind === 'list' ? 'This list' : 'This event';
  // The events this company is actually on, minus the one on screen. Derived
  // from the company's own event_ids rather than "every event except this one".
  const elsewhere = (lead.event_ids ?? [])
    .filter((id) => id !== event?.id)
    .map((id) => allEvents.find((e) => e.id === id))
    .filter((e): e is EventRow => Boolean(e));
  const hasFirmographics = Boolean(lead.apollo_employees || lead.apollo_revenue
    || lead.apollo_industry || lead.apollo_founded);

  return (
    <PanelChrome
      label={lead.name} width={width} back={back} onBack={onBack} onClose={onClose}
      resize={(
        <ResizeHandle
          side="left" invert label="Resize company panel"
          start={() => width} onResize={onWidth}
          min={widthMin} max={widthMax}
        />
      )}
    >
        {/* Identity block: who they are, what they do, where they are — the
            three things you need before reading anything else. */}
        <div className="flex shrink-0 gap-3 border-b border-border bg-card px-4 pb-3 pt-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="flex items-start gap-2 text-[17px] font-semibold leading-tight">
            <Building2 aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="min-w-0 break-words">{lead.name}</span>
            <PartnerMark lead={lead} className="mt-1 size-4" />
            <ReachMark lead={lead} className="mt-1 size-4" />
            {/* Directly after the name rather than pushed to the right edge:
                the panel's own close and back controls live in the chrome bar
                above, so nothing competes for that corner any more. */}
            <button
              type="button" onClick={copyLink} title="Copy a link to this company"
              aria-label="Copy a link to this company"
              className="mt-[3px] shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary"
            >
              {copied ? <Check className="size-3.5 text-primary" /> : <Link2 className="size-3.5" />}
            </button>
            <button
              type="button" onClick={() => onEdit(lead)}
              title="Correct the ingested data"
              aria-label="Correct the ingested data"
              className="mt-[3px] shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary"
            >
              <Pencil className="size-3.5" />
            </button>
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
              {(lead.category_labels?.length
                ? lead.category_labels
                : [lead.category_label].filter(Boolean) as string[]
              ).map((label, i) => (
                <Badge key={label} variant="outline"
                  className={cn('text-[11.5px] font-normal',
                    // Coloured by its own key, not the primary's group — the
                    // views order both arrays identically so index i pairs up.
                    categoryClass(lead.category_keys?.[i] ?? lead.category_key,
                                  lead.category_group))}>
                  {i === 0 && <Tag aria-hidden className="mr-1 size-3" />}
                  {label}
                </Badge>
              ))}
              {lead.reach && lead.reach !== 'Unknown' && (
                <Badge variant="outline"
                  className={cn('text-[11.5px] font-normal', REACH_CLASS[lead.reach])}>
                  <TrendingUp aria-hidden className="mr-1 size-3" />
                  {lead.reach}
                </Badge>
              )}
              {(lead.hq_city || lead.hq_country) && (
                <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                  <MapPin aria-hidden className="size-3" />
                  {[lead.hq_city, lead.hq_country].filter(Boolean).join(', ')}
                </span>
              )}
          </div>
          </div>

          {/* Right of the header, at the mark's own proportions and on nothing.
              `alt=""` because the name is right beside it.

              Twice this was caged. A 28px square with `object-contain` rendered
              Relax Gaming's 300x94 wordmark 9px tall — technically present,
              reported as "a white square box". Widening it to a 56px tile with
              `min-w` and `max-h` was no better: the tile sized itself first and
              then squeezed the image into what was left, giving 38x12. So
              height is the only thing set and width follows the aspect.

              No tile in the general case: these are brand marks in brand
              colours and a chip behind every one of them is a frame around a
              frame.

              The exception is not decoration. A white wordmark — 525 of the
              1,854 we hold, measured — is the original invisible-logo bug
              again the moment the surface goes white, so those and only those
              get a dark ground, and only in the light theme. `dark:bg-transparent`
              is what keeps it off them on the dark one. */}
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo.uri} alt=""
              className={cn('h-12 w-auto max-w-[200px] shrink-0 object-contain',
                logo.ink === 'light'
                  && 'bg-neutral-800 px-2 py-1 dark:bg-transparent dark:p-0')} />
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 pb-10">
            {lead.hidden && (
              <div className="pt-3">
                <Note tone="warn" icon={ShieldAlert}>
                  Hidden from the listings by a correction
                  {lead.hidden_reason ? ` — ${lead.hidden_reason}` : ''}. The row
                  is not deleted; clear the override to bring it back.
                </Note>
              </div>
            )}
            {(lead.overridden ?? []).length > 0 && (
              <div className="pt-3">
                <Note tone="info" icon={Pencil}>
                  Corrected by hand: {(lead.overridden ?? []).join(', ')}. The
                  scraped values are still stored and ingestion cannot overwrite
                  these.
                </Note>
              </div>
            )}

            {/* First thing in the panel, and full width: at a stand this is
                the only action that matters, and it must not need a scroll. */}
            <div className="pt-3">
              <Button className="h-11 w-full" onClick={() => onCapture(lead)}>
                <MessageSquarePlus className="mr-1.5 size-4" />
                Log a visit or call
              </Button>
            </div>

            <Panel icon={Briefcase} title="Deals">
              <DealPanel
                deals={deals}
                companyId={lead.company_id}
                companyName={lead.name}
                companyIndex={companyIndex}
                onOpenCompany={onOpenCompany}
                onCreate={(d) => onCreateDeal(lead.company_id, d)}
                onPatch={(id, patch) => onPatchDeal(lead.company_id, id, patch)}
                onDelete={(d) => onDeleteDeal(lead.company_id, d)}
              />
            </Panel>

            <Panel icon={Network} title="Distribution">
              <ReachPanel
                companyId={lead.company_id}
                carriedBy={edges?.filter((e) => e.downstream_id === lead.company_id)}
                carries={edges?.filter((e) => e.upstream_id === lead.company_id)}
                routes={routes}
                companyIndex={companyIndex}
                onOpenCompany={onOpenCompany}
                onAdd={(up, down, basis) => onAddEdge(lead.company_id, up, down, basis)}
                onRemove={(e) => onRemoveEdge(lead.company_id, e)}
                onRate={(e, patch) => onRateEdge(lead.company_id, e, patch)}
              />
            </Panel>

            <Panel icon={History} title="History">
              {activity === undefined ? (
                <p className="text-[12.5px] text-muted-foreground">Loading…</p>
              ) : activity.length === 0 ? (
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  Nothing recorded yet. Anything logged here stays — it is the
                  one part of an account that cannot be reconstructed later.
                </p>
              ) : (
                <ol className="space-y-2">
                  {activity.map((a) => (
                    <li key={a.id} className="rounded-md border border-border bg-secondary/40 p-2.5">
                      <div className="mb-0.5 flex items-baseline gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                          {ACTIVITY_LABEL[a.kind]}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {a.occurred_at.slice(0, 10)}
                        </span>
                        {a.event_name && (
                          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                            {a.event_name}
                          </span>
                        )}
                      </div>
                      {(a.met_name || a.met_role) && (
                        <p className="text-[12px] text-foreground">
                          {[a.met_name, a.met_role].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {a.body && (
                        <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                          {activityBodies.get(a.id) ?? a.body}
                        </p>
                      )}
                      {/* Mis-logging a visit against the wrong company is the
                          likeliest mistake at a show, so it has to be
                          reversible. Confirmed, because history is the thing
                          you cannot rebuild. */}
                      <button
                        type="button"
                        onClick={() => onDeleteActivity(a)}
                        className="mt-1 text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-destructive"
                      >
                        Remove this entry
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>

            <Panel icon={Ticket} title={isShow ? 'Presence' : 'Listing'}>
              <dl>
                <Field icon={CalendarDays} label="Event">{event?.name}</Field>
                {isShow && (
                  <>
                    <Field icon={MapPin} label="Zone">{(lead.zones ?? []).join(', ')}</Field>
                    <Field icon={Landmark} label="Booth">
                      {(lead.booths ?? []).length
                        ? (lead.booths ?? []).map((b) => (
                            <button
                              key={b} type="button" onClick={() => onBooth(b, event)}
                              className="mr-1 rounded border border-border bg-secondary/60 px-1.5 py-0.5 font-mono text-[12px] text-foreground hover:border-primary hover:text-primary"
                            >
                              {b}
                            </button>
                          ))
                        : null}
                    </Field>
                  </>
                )}
                <Field icon={Globe} label="Website">
                  {lead.domain ? (
                    <a href={`https://${lead.domain}`} target="_blank" rel="noopener"
                      className="text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid">
                      {lead.domain}
                    </a>
                  ) : null}
                </Field>
                <Field icon={Sparkles} label="Confidence">
                  <span className={lead.category_confidence === 'verified'
                    ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>
                    {lead.category_confidence ?? 'unknown'}
                  </span>
                </Field>
              </dl>
              {event?.floorplan_url && (lead.booths ?? []).length > 0 && (
                <Button variant="outline" size="sm" className="mt-2.5 h-8 w-full text-xs"
                  onClick={() => onBooth(lead.booths![0], event)}>
                  <MapPin className="mr-1.5 size-3.5" /> Show on floorplan
                </Button>
              )}
            </Panel>

            {(lead.data_note || lead.apollo_note) && (
              <Panel icon={FileText} title="What we know">
                <div className="space-y-2">
                  {lead.data_note && (
                    <Note tone="warn" icon={ShieldAlert}>{link(lead.data_note)}</Note>
                  )}
                  {lead.apollo_note && (
                    <Note tone="data" icon={FileText}>{link(lead.apollo_note)}</Note>
                  )}
                </div>
              </Panel>
            )}

            {elsewhere.length > 0 && (
              <Panel icon={CalendarDays} title="Also appears at">
                <div className="space-y-1.5">
                  {elsewhere.map((e) => (
                    <LinkTile
                      key={e.id} icon={CalendarDays} label={e.name}
                      hint={e.kind === 'list' ? 'open list' : 'open event'}
                      onClick={() => onOpenCompanyAt(e.id, lead.company_id)}
                    />
                  ))}
                </div>
              </Panel>
            )}

            <ContactsPanel
              contacts={contacts} companyName={lead.name}
              onAdd={(draft) => onAddContact(lead.company_id, draft)}
              onOpenPerson={onOpenPerson}
            />

            {socials.length > 0 && (
              <Panel icon={Megaphone} title="Social">
                <div className="flex flex-wrap gap-1.5">
                  {socials.map((s) => (
                    <IconLink key={s.key} icon={s.icon} href={s.url!} label={s.label} />
                  ))}
                </div>
              </Panel>
            )}

            <Panel icon={Users} title="People">
              <div className="space-y-1.5">
                <LinkTile
                  icon={LinkedInIcon}
                  label={`Everyone at ${lead.name}`}
                  href={linkedinPeopleUrl(lead.linkedin_url, lead.name)}
                  hint={lead.linkedin_url ? 'people tab' : 'search'}
                />
                <LinkTile icon={UserPlus} label="Add people at this company"
                  onClick={() => onAddPeople(lead.company_id)} />
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                Open the link, select the people you want, copy, then paste into
                Add people. Their own team page works just as well.
              </p>
            </Panel>

            {hasFirmographics && (
              <Panel icon={TrendingUp} title="Firmographics">
                <dl>
                  <Field icon={Tag} label="Industry">{lead.apollo_industry}</Field>
                  <Field icon={Users} label="Employees">
                    {lead.apollo_employees?.toLocaleString()}
                  </Field>
                  <Field icon={TrendingUp} label="Revenue">
                    {formatRevenue(lead.apollo_revenue)}
                  </Field>
                  <Field icon={CalendarDays} label="Founded">{lead.apollo_founded}</Field>
                  <Field icon={Handshake} label="BD team">{lead.apollo_bd_headcount}</Field>
                  <Field icon={Handshake} label="Sales team">{lead.apollo_sales_headcount}</Field>
                </dl>
              </Panel>
            )}

            <Panel icon={ExternalLink} title="Research">
              <div className="space-y-1.5">
                {researchLinks(lead, emails.length > 0).map((l) => (
                  <LinkTile key={l.label} icon={ExternalLink} label={l.label}
                    href={l.href} hint={l.hint} />
                ))}
              </div>
            </Panel>

            <Panel icon={Ticket} title={scopeLabel}>
              <div className="space-y-2.5">
                <div className="grid gap-1">
                  <Label className="text-[11.5px] text-muted-foreground">Status</Label>
                  <StatusSelect
                    statuses={statuses.filter((s) => s.scope === 'event')}
                    value={lead.event_status_id}
                    ariaLabel="Event status"
                    className={FIELD_BOX}
                    onChange={(id, key) =>
                      onPatch(lead, { event_status_id: id, event_status: key ?? null }, 'event')}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11.5px] text-muted-foreground">Owner</Label>
                  <OwnerSelect
                    owners={owners} value={lead.owner} ariaLabel="Owner"
                    className={FIELD_BOX}
                    onChange={(v) => onPatch(lead, { owner: v }, 'event')}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label className="text-[11.5px] text-muted-foreground">Contacted on</Label>
                    <Input
                      type="date" key={`contacted_on:${lead.contacted_on ?? ''}`}
                      defaultValue={lead.contacted_on ?? ''}
                      aria-label="Date contacted" className="h-8 text-[13px]"
                      onBlur={(e) => onPatch(lead, { contacted_on: e.target.value || null }, 'event')}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-[11.5px] text-muted-foreground">Replied on</Label>
                    <Input
                      type="date" key={`replied_on:${lead.replied_on ?? ''}`}
                      defaultValue={lead.replied_on ?? ''}
                      aria-label="Date replied" className="h-8 text-[13px]"
                      onBlur={(e) => onPatch(lead, { replied_on: e.target.value || null }, 'event')}
                    />
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11.5px] text-muted-foreground">Next action</Label>
                  <Input
                    key={`next_action:${lead.next_action ?? ''}`}
                      defaultValue={lead.next_action ?? ''} placeholder="Send deck, chase reply…"
                    aria-label="Next action" className="h-8 text-[13px]"
                    onBlur={(e) => onPatch(lead, { next_action: e.target.value.trim() || null }, 'event')}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11.5px] text-muted-foreground">
                    Due — shows in the schedule
                  </Label>
                  <Input
                    type="date" key={`next_action_on:${lead.next_action_on ?? ''}`}
                      defaultValue={lead.next_action_on ?? ''}
                    aria-label="Next action due date" className="h-8 text-[13px]"
                    onBlur={(e) => onPatch(lead, { next_action_on: e.target.value || null }, 'event')}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11.5px] text-muted-foreground">Notes</Label>
                  <Textarea
                    key={`notes:${lead.notes ?? ''}`}
                      defaultValue={lead.notes ?? ''} aria-label="Notes"
                    className="min-h-20 text-[13px]"
                    onBlur={(e) => onPatch(lead, { notes: e.target.value.trim() || null }, 'event')}
                  />
                </div>
              </div>
            </Panel>

            <Panel icon={Handshake} title="Relationship — applies everywhere">
              <div className="space-y-2.5">
                <div className="grid gap-1">
                  <Label className="text-[11.5px] text-muted-foreground">Status</Label>
                  <StatusSelect
                    statuses={statuses.filter((s) => s.scope === 'company')}
                    value={lead.company_status_id}
                    ariaLabel="Relationship status"
                    className={FIELD_BOX}
                    onChange={(id, key, terminal) =>
                      onPatch(lead, {
                        company_status_id: id,
                        company_status: key ?? null,
                        company_status_terminal: terminal ?? null,
                      }, 'company')}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11.5px] text-muted-foreground">Priority</Label>
                  <StatusSelect
                    options={['High', 'Med', 'Low']}
                    value={lead.priority}
                    ariaLabel="Priority"
                    className={FIELD_BOX}
                    onChange={(v) => onPatch(lead, { priority: v as Lead['priority'] }, 'company')}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11.5px] text-muted-foreground">Note</Label>
                  <Textarea
                    defaultValue={lead.company_note ?? ''} placeholder="Note"
                    aria-label="Relationship note" className="min-h-16 text-[13px]"
                    onBlur={(e) =>
                      onPatch(lead, { company_note: e.target.value.trim() || null }, 'company')}
                  />
                </div>
                {lead.company_note && (
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    {link(lead.company_note)}
                  </p>
                )}
              </div>
            </Panel>

          </div>
        </ScrollArea>
    </PanelChrome>
  );
}
