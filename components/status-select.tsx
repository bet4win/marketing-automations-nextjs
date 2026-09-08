'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Status } from '@/lib/types';

/**
 * A native `<select>`, deliberately.
 *
 * This sits in every table row, so it is instantiated hundreds of times and is
 * mounted and unmounted continuously while scrolling. Radix Select here cost
 * 17s per event switch and blank frames on scroll: each instance builds a
 * context, a portal, a focus scope and a collection of refs, none of which a
 * three-option status picker needs. A native select renders essentially for
 * free, and gets keyboard handling, typeahead, screen-reader semantics and
 * correct mobile pickers from the platform rather than from JavaScript.
 *
 * Radix remains where it earns its cost — dialog, sheet, tooltip, checkbox.
 */
export function StatusSelect({
  statuses,
  options,
  value,
  onChange,
  className,
  ariaLabel,
  disabled,
}: {
  statuses?: Status[];
  options?: string[];
  value: string | null;
  onChange: (id: string | null, key?: string, terminal?: boolean) => void;
  className?: string;
  ariaLabel?: string;
  /** Event-scoped pickers are disabled on the all-companies roll-up. */
  disabled?: boolean;
}) {
  const items = statuses
    ? statuses.map((s) => ({ value: s.id, label: s.label, color: s.color, status: s }))
    : (options ?? []).map((o) => ({ value: o, label: o, color: null, status: undefined }));

  const current = items.find((i) => i.value === value);

  return (
    <div className={cn('relative', className)}>
      <select
        aria-label={ariaLabel}
        disabled={disabled}
        value={value ?? ''}
        style={current?.color ? { color: current.color } : undefined}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return onChange(null);
          const hit = items.find((i) => i.value === v);
          onChange(v, hit?.status?.key, hit?.status?.is_terminal);
        }}
        className={cn(
          'w-full cursor-pointer appearance-none rounded-md border border-transparent',
          'bg-transparent py-1 pl-1 pr-5 text-[11.5px] text-foreground',
          'hover:border-border focus:border-ring focus:outline-none',
          disabled && 'cursor-not-allowed opacity-40 hover:border-transparent',
          // The popup list is drawn by the OS and does not inherit page colours,
          // so options need an explicit background of their own.
          '[&>option]:bg-popover [&>option]:text-popover-foreground',
        )}
      >
        <option value="">—</option>
        {items.map((i) => (
          <option key={i.value} value={i.value}>{i.label}</option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60"
      />
    </div>
  );
}
