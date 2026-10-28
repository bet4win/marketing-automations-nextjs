'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Building2, CalendarClock, CheckCircle2, EyeOff, Save, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { OwnerSelect } from '@/components/owner-select';
import { StatusSelect } from '@/components/status-select';
import { daysBetween, shift, today as todayYmd } from '@/lib/dates';
import type { Owner, SchedulePatch, ScheduleItem, Status } from '@/lib/types';

/**
 * Edit one dated follow-up in place.
 *
 * The schedule was read-only, and clicking an item threw you back to the
 * companies board — so changing a due date meant finding the row again, on the
 * right event, past whatever filters happened to be set. Everything a scheduled
 * item consists of is editable here instead, and the company panel is one
 * button away without leaving the view.
 *
 * The fields are the same `lead_states` row the company panel edits, so the two
 * cannot disagree. Nothing here touches scraped data.
 */

const SCOPE: Record<string, string> = {
  all: 'Ongoing', list: 'This list', event: 'This event',
};

/** Which `ScheduleItem` field a draft key came from, for the dirty check. */
const FIELDS: [keyof SchedulePatch, keyof ScheduleItem][] = [
  ['status_id', 'event_status_id'],
  ['owner', 'owner'],
  ['contacted_on', 'contacted_on'],
  ['replied_on', 'replied_on'],
  ['next_action', 'next_action'],
  ['next_action_on', 'next_action_on'],
  ['notes', 'notes'],
];

/**
 * Module scope, deliberately — declared inside the component this is a new
 * component type every render, so React remounts the input on each keystroke
 * and focus goes with it. That trap has already cost the filter rail and the
 * override editor their search focus once each.
 */
function Row({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11.5px] text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ScheduleEditor({
  item, open, onOpenChange, statuses, owners, onSave, onOpenCompany,
}: {
  item: ScheduleItem | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  statuses: Status[];
  owners: Owner[];
  /** Resolves false on failure, so the dialog stays open with the edits intact. */
  onSave: (item: ScheduleItem, patch: SchedulePatch) => Promise<boolean>;
  onOpenCompany: (eventId: string, companyId: string) => void;
}) {
  const [draft, setDraft] = useState<SchedulePatch>({
    status_id: null, owner: null, contacted_on: null, replied_on: null,
    next_action: null, next_action_on: null, notes: null,
  });
  const [saving, setSaving] = useState(false);

  const key = item ? `${item.event_id}:${item.company_id}` : null;

  // In an effect, not the render body: setState during render takes the page
  // down outright rather than failing quietly.
  useEffect(() => {
    if (!open || !item) return;
    setDraft({
      status_id: item.event_status_id,
      owner: item.owner,
      contacted_on: item.contacted_on,
      replied_on: item.replied_on,
      next_action: item.next_action,
      next_action_on: item.next_action_on,
      notes: item.notes,
    });
    // Keyed on which row this is, not on the object — reloading the schedule
    // makes a new object for the same row and would wipe an in-flight edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  const eventStatuses = useMemo(
    () => statuses.filter((s) => s.scope === 'event'), [statuses],
  );

  // Every hook runs above this line, or the hook order changes between renders
  // and React throws.
  if (!item) return null;

  const set = <K extends keyof SchedulePatch>(k: K, v: SchedulePatch[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const norm = (v: unknown) => (typeof v === 'string' ? v.trim() : v ?? '');
  const dirty = FIELDS.some(([d, s]) => norm(draft[d]) !== norm(item[s]));

  const commit = async (patch: SchedulePatch, then?: () => void) => {
    setSaving(true);
    const ok = await onSave(item, patch);
    setSaving(false);
    if (!ok) return;          // the dialog stays open with the edits intact
    onOpenChange(false);
    then?.();
  };

  const openCompany = () => {
    const go = () => onOpenCompany(item.event_id, item.company_id);
    if (dirty) return commit(draft, go);
    onOpenChange(false);
    go();
  };

  const today = todayYmd();
  const due = draft.next_action_on;
  const late = Boolean(due && due < today);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] w-[560px] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border p-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <CalendarClock aria-hidden className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 break-words">{item.company_name}</span>
          </DialogTitle>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
            <span>
              {SCOPE[item.event_kind ?? 'event'] ?? 'This event'} · {item.event_name}
            </span>
            {item.priority && <span>· {item.priority} priority</span>}
            {item.hidden && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 dark:bg-amber-400/20 px-1.5 text-[10.5px] text-amber-700 dark:text-amber-300">
                <EyeOff aria-hidden className="size-3" /> company hidden
              </span>
            )}
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
          <Row label="Next action">
            <Input
              value={draft.next_action ?? ''}
              onChange={(e) => set('next_action', e.target.value)}
              placeholder="Send deck, chase reply…" aria-label="Next action"
              className="h-8 text-[13px]"
            />
          </Row>

          <Row
            label="Due"
            hint={due
              ? (late ? `Overdue by ${daysBetween(due, today)} days` : undefined)
              : 'No date — saving now takes this off the schedule'}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Input
                type="date" value={due ?? ''}
                onChange={(e) => set('next_action_on', e.target.value || null)}
                aria-label="Due date" className="h-8 w-[150px] text-[13px]"
              />
              {([['Today', 0], ['+1 week', 7], ['+2 weeks', 14], ['+1 month', 30]] as const)
                .map(([label, days]) => (
                  <button
                    key={label} type="button"
                    // Counted from today, not from the current due date —
                    // nudging an overdue item by a week would land it in
                    // the past, which is not what "+1 week" means here.
                    onClick={() => set('next_action_on', shift(today, days))}
                    className="rounded-full border border-border bg-secondary/40 px-2.5 py-0.5 text-[11.5px] text-muted-foreground hover:text-foreground"
                  >
                    {label}
                  </button>
                ))}
            </div>
          </Row>

          <div className="grid grid-cols-2 gap-3">
            <Row label="Status">
              <StatusSelect
                statuses={eventStatuses} value={draft.status_id}
                ariaLabel="Status" className="rounded-md border border-border px-1 py-0.5"
                onChange={(id) => set('status_id', id)}
              />
            </Row>
            <Row label="Owner">
              <OwnerSelect
                owners={owners} value={draft.owner} ariaLabel="Owner"
                className="rounded-md border border-border px-1 py-0.5"
                onChange={(v) => set('owner', v)}
              />
            </Row>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Row label="Contacted on">
              <div className="flex gap-1.5">
                <Input
                  type="date" value={draft.contacted_on ?? ''}
                  onChange={(e) => set('contacted_on', e.target.value || null)}
                  aria-label="Date contacted" className="h-8 text-[13px]"
                />
                <Button
                  variant="outline" size="sm" className="h-8 shrink-0 px-2 text-xs"
                  onClick={() => set('contacted_on', today)}
                >
                  Today
                </Button>
              </div>
            </Row>
            <Row label="Replied on">
              <div className="flex gap-1.5">
                <Input
                  type="date" value={draft.replied_on ?? ''}
                  onChange={(e) => set('replied_on', e.target.value || null)}
                  aria-label="Date replied" className="h-8 text-[13px]"
                />
                <Button
                  variant="outline" size="sm" className="h-8 shrink-0 px-2 text-xs"
                  onClick={() => set('replied_on', today)}
                >
                  Today
                </Button>
              </div>
            </Row>
          </div>

          <Row label="Notes">
            <Textarea
              value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)}
              aria-label="Notes" className="min-h-20 text-[13px]"
            />
          </Row>

          {/* Both clear the due date, which is what takes an item off the
              calendar. Kept as buttons rather than leaving it to be inferred
              from an empty date field. */}
          <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
            <Button
              variant="outline" size="sm" className="h-8 text-xs" disabled={saving}
              title="Records the reply date and clears the due date"
              onClick={() => commit({
                ...draft,
                replied_on: draft.replied_on ?? today,
                next_action_on: null,
              })}
            >
              <CheckCircle2 className="mr-1 size-3.5" /> Done — replied
            </Button>
            <Button
              variant="outline" size="sm" className="h-8 text-xs" disabled={saving}
              title="Keeps the action text, takes it off the calendar"
              onClick={() => commit({ ...draft, next_action_on: null })}
            >
              <Trash2 className="mr-1 size-3.5" /> Remove from schedule
            </Button>
          </div>
        </div>

        <DialogFooter className="flex-row items-center gap-2 border-t border-border p-3">
          <Button
            variant="outline" size="sm" className="h-8 text-xs" disabled={saving}
            onClick={openCompany}
            title={dirty
              ? 'Saves these changes, then opens the company here'
              : 'Opens the company panel without leaving the schedule'}
          >
            <Building2 className="mr-1 size-3.5" />
            {dirty ? 'Save & open company' : 'Open company details'}
          </Button>
          <Button
            variant="outline" size="sm" className="ml-auto h-8 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button size="sm" className="h-8 text-xs" disabled={saving || !dirty}
            onClick={() => commit(draft)}>
            <Save className="mr-1 size-3.5" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
