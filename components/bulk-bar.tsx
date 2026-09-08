'use client';

import { useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OwnerSelect } from '@/components/owner-select';
import { StatusSelect } from '@/components/status-select';
import type { Lead, Owner, Priority, Status } from '@/lib/types';

export type BulkPatch = {
  event?: Partial<Lead>;
  company?: Partial<Lead>;
};

/**
 * Acts on the current selection.
 *
 * Scope is not a detail the user should have to hold in their head, so the bar
 * routes each field itself: status, owner and the dates are per-event, while
 * priority and relationship apply to the company everywhere. Every field is
 * always available now that the catch-all is a real event — on "All companies
 * (ongoing)" the per-event fields simply write against that list.
 */
export function BulkBar({
  count, statuses, owners, onApply, onClear, busy,
}: {
  count: number;
  statuses: Status[];
  owners: Owner[];
  onApply: (patch: BulkPatch) => void;
  onClear: () => void;
  busy: boolean;
}) {
  const [date, setDate] = useState('');
  const [action, setAction] = useState('');

  if (count === 0) return null;

  const eventStatuses = statuses.filter((s) => s.scope === 'event');
  const companyStatuses = statuses.filter((s) => s.scope === 'company');

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-primary/10 px-3 py-1.5">
      <span className="text-[12px] font-medium text-foreground">
        {count} selected
      </span>

      <StatusSelect
        statuses={eventStatuses} value={null} ariaLabel="Set status for selection"
        className="w-[136px]"
        onChange={(id, key) => id && onApply({ event: { event_status_id: id, event_status: key ?? null } })}
      />

      <StatusSelect
        options={['High', 'Med', 'Low']} value={null} ariaLabel="Set priority for selection"
        className="w-[92px]"
        onChange={(v) => v && onApply({ company: { priority: v as Priority } })}
      />

      <StatusSelect
        statuses={companyStatuses} value={null} ariaLabel="Set relationship for selection"
        className="w-[150px]"
        onChange={(id, key, terminal) => id && onApply({
          company: {
            company_status_id: id,
            company_status: key ?? null,
            company_status_terminal: terminal ?? null,
          },
        })}
      />

      {/* Applies on selection, like the pickers beside it. The free-text
          version needed Enter to commit, which was not discoverable and left
          people thinking they had assigned an owner when they had not. */}
      <OwnerSelect
        owners={owners} value={null} ariaLabel="Set owner for selection"
        placeholder="Owner…" className="w-[150px]"
        onChange={(v) => v && onApply({ event: { owner: v } })}
      />
      <span className="flex items-center gap-1">
        <CalendarClock aria-hidden className="size-3.5 text-muted-foreground" />
        <Input
          value={action} onChange={(e) => setAction(e.target.value)}
          placeholder="Next action…" aria-label="Next action for selection"
          className="h-7 w-[150px] text-xs"
        />
        <Input
          type="date" value={date} onChange={(e) => setDate(e.target.value)}
          aria-label="Next action date for selection"
          className="h-7 w-[132px] text-xs"
        />
        <Button
          size="sm" className="h-7 text-xs" disabled={!date || busy}
          onClick={() => {
            onApply({ event: { next_action: action.trim() || null, next_action_on: date } });
            setAction(''); setDate('');
          }}
        >
          Schedule
        </Button>
      </span>

      <Button
        variant="outline" size="sm" className="h-7 text-xs" disabled={busy}
        onClick={() => onApply({ event: { contacted_on: new Date().toISOString().slice(0, 10) } })}
      >
        Mark contacted today
      </Button>

      <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={onClear}>
        <X className="mr-1 size-3.5" /> Clear selection
      </Button>
      {busy && <span className="text-[11.5px] text-muted-foreground">Saving…</span>}
    </div>
  );
}
