'use client';

import { ChevronDown } from 'lucide-react';
import type { EventRow } from '@/lib/types';

/**
 * Native select, matching the row pickers. One instance, but consistency wins.
 *
 * Full width rather than a fixed 230px: its only consumer is the filter rail,
 * which is user-resizable from 180px up, so a fixed width either overflowed a
 * narrow rail or left a gap in a wide one.
 */
export function EventSwitcher({
  events, value, onChange,
}: {
  events: EventRow[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="relative">
      <select
        aria-label="Event"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer appearance-none rounded-md border border-primary/60 bg-secondary/40 py-1.5 pl-2.5 pr-7 text-[12.5px] font-medium text-primary hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring [&>option]:bg-popover [&>option]:text-popover-foreground"
      >
        {events.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-primary/70"
      />
    </div>
  );
}
