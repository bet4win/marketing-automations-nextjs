'use client';

import { useEffect, useState } from 'react';
import {
  CalendarClock, Handshake, Mail, MessageSquare, Phone, Save, UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusSelect } from '@/components/status-select';
import { shift, today as todayYmd } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { ActivityDraft, Lead, Status } from '@/lib/types';

/**
 * Record what just happened, in about twenty seconds, standing up.
 *
 * Everything here is shaped by where it gets used: at a stand, on a phone, one
 * hand, mid-conversation or just after. So it is one screen with no scrolling
 * on a 390px viewport, controls are at least 44px, and every field is optional
 * except the one that matters — what happened.
 *
 * It writes two things at once, because they are one act:
 *
 *   an activity row      the permanent record of the conversation
 *   the lead's pipeline  status, contacted-on, and the next thing to do
 *
 * The alternative was a note that overwrites the last one and two scalar
 * dates, which is what was there before and which loses the history it
 * pretends to keep.
 */

/**
 * What a person can log. `stage` is absent on purpose: those rows are written
 * by a trigger when a status moves, and a hand-typed one would be a claim
 * about a transition that never happened.
 */
const KINDS: { key: ActivityDraft['kind']; label: string; icon: typeof Handshake }[] = [
  { key: 'met', label: 'Met', icon: Handshake },
  { key: 'call', label: 'Call', icon: Phone },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'note', label: 'Note', icon: MessageSquare },
];

/** The follow-up offsets that come up at a show. */
const WHEN = [
  { label: 'No follow-up', days: null },
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
] as const;

export function CaptureSheet({
  lead, open, onOpenChange, statuses, onSave, busy,
}: {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  statuses: Status[];
  onSave: (
    lead: Lead,
    activity: ActivityDraft,
    pipeline: { status_id: string | null; next_action: string | null; next_action_on: string | null },
    alsoAddPerson: boolean,
  ) => Promise<boolean>;
  busy: boolean;
}) {
  const [kind, setKind] = useState<ActivityDraft['kind']>('met');
  const [body, setBody] = useState('');
  const [metName, setMetName] = useState('');
  const [metRole, setMetRole] = useState('');
  const [statusId, setStatusId] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<number | null>(3);
  const [nextAction, setNextAction] = useState('');
  const [addPerson, setAddPerson] = useState(true);

  const companyId = lead?.company_id ?? null;

  // Reset per company, in an effect rather than the render body.
  useEffect(() => {
    if (!open || !companyId) return;
    setKind('met');
    setBody('');
    setMetName('');
    setMetRole('');
    // Default to the status the pipeline is already at, so saving a note does
    // not quietly move a lead backwards.
    setStatusId(lead?.event_status_id ?? null);
    setFollowUp(3);
    setNextAction('');
    setAddPerson(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyId]);

  if (!lead) return null;

  const eventStatuses = statuses.filter((s) => s.scope === 'event');
  const today = todayYmd();
  const dueOn = followUp === null ? null : shift(today, followUp);

  const save = async () => {
    const ok = await onSave(
      lead,
      {
        kind,
        body: body.trim() || null,
        met_name: metName.trim() || null,
        met_role: metRole.trim() || null,
      },
      {
        status_id: statusId,
        next_action: nextAction.trim() || null,
        next_action_on: dueOn,
      },
      addPerson && Boolean(metName.trim()),
    );
    if (ok) onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Bottom sheet on a phone, right-hand panel on a desk. A bottom sheet
          puts the controls under the thumb, which is where the hand already
          is. */}
      <SheetContent
        side="bottom"
        className="max-h-[92dvh] gap-0 rounded-t-xl p-0 sm:max-w-none"
      >
        <SheetHeader className="border-b border-border px-3 py-2.5">
          <SheetTitle className="flex items-baseline gap-2 text-sm">
            Log a visit
            <span className="min-w-0 truncate text-[12.5px] font-normal text-muted-foreground">
              {lead.name}
              {(lead.booths ?? []).length > 0 && ` · stand ${(lead.booths ?? []).join(', ')}`}
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
          <div className="grid grid-cols-4 gap-1.5">
            {KINDS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setKind(key)}
                aria-pressed={kind === key}
                className={cn(
                  'flex h-11 flex-col items-center justify-center gap-0.5 rounded-md border text-[11px]',
                  kind === key
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border bg-secondary/40 text-muted-foreground',
                )}
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="capture-body" className="text-[11.5px] text-muted-foreground">
              What happened
            </Label>
            <Textarea
              id="capture-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Interested in originals, wants a demo of the crash game…"
              className="min-h-20 text-[13px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="capture-who" className="text-[11.5px] text-muted-foreground">
                Who you met
              </Label>
              <Input
                id="capture-who" value={metName} onChange={(e) => setMetName(e.target.value)}
                placeholder="First name is enough" className="h-11 text-[13px]"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="capture-role" className="text-[11.5px] text-muted-foreground">
                Their role
              </Label>
              <Input
                id="capture-role" value={metRole} onChange={(e) => setMetRole(e.target.value)}
                placeholder="Head of content" className="h-11 text-[13px]"
              />
            </div>
          </div>

          {metName.trim() && (
            <label className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 p-2.5 text-[12.5px] text-foreground">
              <input
                type="checkbox" checked={addPerson}
                onChange={(e) => setAddPerson(e.target.checked)}
                className="size-4 accent-[oklch(0.78_0.11_184)]"
              />
              <UserPlus aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              Add {metName.trim()} to the people directory
            </label>
          )}

          <div className="grid gap-1.5">
            <Label className="text-[11.5px] text-muted-foreground">Move the status to</Label>
            <StatusSelect
              statuses={eventStatuses} value={statusId} ariaLabel="Status after this visit"
              // The select's own padding is fixed, so the height goes on the
              // element itself — 27px was well under the 44px this is used at.
              className="rounded-md border border-border px-1 [&>select]:h-[42px]"
              onChange={(id) => setStatusId(id)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <CalendarClock aria-hidden className="size-3.5" />
              Follow up {dueOn ? `on ${dueOn}` : '— not scheduled'}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {WHEN.map((w) => (
                <button
                  key={w.label}
                  type="button"
                  onClick={() => setFollowUp(w.days)}
                  aria-pressed={followUp === w.days}
                  className={cn(
                    'h-11 rounded-full border px-3.5 text-[12.5px]',
                    followUp === w.days
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-secondary/40 text-muted-foreground',
                  )}
                >
                  {w.label}
                </button>
              ))}
            </div>
            {followUp !== null && (
              <Input
                value={nextAction} onChange={(e) => setNextAction(e.target.value)}
                placeholder="Next action — send the deck, chase the demo…"
                aria-label="Next action" className="mt-1 h-11 text-[13px]"
              />
            )}
          </div>
        </div>

        <div className="flex gap-2 border-t border-border p-3">
          <Button variant="outline" className="h-11 flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {/* Enabled with nothing typed: "spoke to them, nothing to report"
              is a real outcome, and it still moves contacted-on. */}
          <Button className="h-11 flex-[2]" disabled={busy} onClick={save}>
            <Save className="mr-1.5 size-4" />
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
