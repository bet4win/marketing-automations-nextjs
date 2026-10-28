'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { displayName } from '@/lib/owners';
import type { Owner } from '@/lib/types';

/**
 * Pick who owns a lead, from the project's Supabase auth users.
 *
 * A native `<select>`, for the same reason as status-select.tsx: this sits in
 * every table row, so it is mounted and unmounted continuously while
 * scrolling, and a Radix Select there cost seconds per event switch.
 *
 * **It never discards a value it does not recognise.** `lead_states.owner` is a
 * free-text column that predates this picker, so it already holds things like
 * a team name rather than an address. Turning it into a strict list would make
 * those rows unselectable and quietly overwrite them on the next edit. An
 * unrecognised value is offered as its own option, marked, so it survives being
 * opened and closed — and switching away from it is then a deliberate act.
 */
export function OwnerSelect({
  owners, value, onChange, className, ariaLabel, disabled, placeholder = '—',
}: {
  owners: Owner[];
  /** The stored email, or any legacy free-text value. */
  value: string | null;
  onChange: (email: string | null) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const current = value?.trim() ?? '';
  const known = owners.some((o) => o.email === current);
  const orphan = current && !known ? current : null;

  return (
    <div className={cn('relative', className)}>
      <select
        aria-label={ariaLabel}
        disabled={disabled}
        value={current}
        onChange={(e) => onChange(e.target.value || null)}
        className={cn(
          'w-full cursor-pointer appearance-none rounded-md border border-transparent',
          'bg-transparent py-1 pl-1 pr-5 text-[11.5px] text-foreground',
          'hover:border-border focus:border-ring focus:outline-none',
          disabled && 'cursor-not-allowed opacity-40 hover:border-transparent',
          // The popup list is drawn by the OS and does not inherit page
          // colours, so options need an explicit background of their own.
          '[&>option]:bg-popover [&>option]:text-popover-foreground',
        )}
      >
        <option value="">{placeholder}</option>
        {orphan && (
          // Kept first so it reads as the current state rather than as one of
          // the accounts. "not an account" is the honest label: the value is
          // real and in the database, it just does not match a user.
          <option value={orphan}>{orphan} — not an account</option>
        )}
        {owners.map((o) => (
          <option key={o.id} value={o.email}>{displayName(o)}</option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60"
      />
    </div>
  );
}
