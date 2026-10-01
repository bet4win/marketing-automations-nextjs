'use client';

import { useRef } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Search field with a clear button.
 *
 * `type="search"` is deliberately avoided: Chrome and Safari draw their own
 * clear affordance for it, which is unstyleable, sits at a different offset
 * per browser, and would appear alongside this one. A plain text input with an
 * explicit button is the only way to get one consistent control.
 *
 * Clearing returns focus to the field — the next thing anyone does after
 * clearing a search is type a new one.
 */
export function SearchInput({
  value, onChange, placeholder, className, ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <Input
        ref={ref}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();      // don't let Escape close a surrounding panel
            onChange('');
          }
        }}
        placeholder={placeholder}
        className={cn(value && 'pr-7', className)}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear (Esc)"
          onClick={() => { onChange(''); ref.current?.focus(); }}
          className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
