'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { GeorgianMark, KnownMark } from '@/components/partner-mark';
import { isGeorgian } from '@/lib/georgian';
import { searchPeople } from '@/lib/people';
import { cn } from '@/lib/utils';
import type { Person } from '@/lib/types';

const LIMIT = 6;

/**
 * A name field that offers people from the directory as you type.
 *
 * Typing stays free text — at a stand a first name is often all you get — and
 * picking a suggestion links the entry to that person. Editing the name after
 * a pick drops the link, since it no longer names who was picked.
 *
 * People at `companyId` come first: you are logging a visit to that company,
 * so its own staff are the likeliest match. Anyone else is still offered —
 * the person you met may be on a partner's stand.
 *
 * Same traps as MentionTextarea: options take `onMouseDown` + `preventDefault`
 * so a click does not blur the field first, and Escape is caught on `window`
 * in the capture phase, because Radix closes the sheet from `document` before
 * any React handler runs.
 */
export function PersonPicker({
  id, value, onChange, onPick, people, companyId, placeholder, className,
}: {
  id?: string;
  value: string;
  onChange: (text: string) => void;
  onPick: (p: Person) => void;
  people: Person[];
  companyId: string | null;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);

  const options = useMemo(() => {
    const q = value.trim();
    if (q.length < 2) return [];
    return searchPeople(people, q)
      .sort((a, b) => Number(b.company_id === companyId) - Number(a.company_id === companyId))
      .slice(0, LIMIT);
  }, [people, value, companyId]);

  const exact = options.length === 1
    && options[0].full_name.trim().toLowerCase() === value.trim().toLowerCase();
  const open = focused && !dismissed && options.length > 0 && !exact;

  useEffect(() => {
    if (!open) return;
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target !== ref.current) return;
      e.stopPropagation();
      e.preventDefault();
      setDismissed(true);
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [open]);

  const pick = (p: Person) => {
    onPick(p);
    setDismissed(true);
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(options[active]);
    }
  };

  return (
    <div className="relative">
      <Input
        ref={ref} id={id} value={value} placeholder={placeholder} className={className}
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setDismissed(false); setActive(0); }}
        onKeyDown={keys}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {open && (
        <ul
          id={listId} role="listbox" aria-label="People in the directory"
          className="absolute left-0 top-full z-50 mt-1 w-[min(22rem,80vw)] overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {options.map((p, i) => (
            <li
              key={p.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setActive(i)}
              className={cn('cursor-pointer px-2.5 py-1.5',
                i === active ? 'bg-primary/15' : undefined)}
            >
              <span className="flex min-w-0 items-center gap-1 text-[12.5px] text-foreground">
                <span className="truncate">{p.full_name}</span>
                {isGeorgian(p) && <GeorgianMark names={[p.full_name]} />}
                {p.known && <KnownMark name={p.full_name} />}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {[p.job_title, p.company_name].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
