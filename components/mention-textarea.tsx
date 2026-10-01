'use client';

import { useCallback, useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { searchCompanies, type CompanyIndex, type CompanyRef } from '@/lib/entity-links';
import { cn } from '@/lib/utils';

// The `@` has to start a word, the same rule `linkifyMentions` reads with, or
// typing an email address would open the picker on every keystroke after it.
const TRIGGER = /(?:^|[^A-Za-z0-9._%+-])@([^@\n]{0,40})$/;

/**
 * A textarea where `@` opens a company picker.
 *
 * Choosing a company writes `@Name ` into the text and nothing else — no
 * hidden markup — so the note reads the same in the field, the CSV and a
 * copy-paste, and `linkifyMentions` finds it again by name.
 *
 * The value is written through the native setter plus an `input` event,
 * which is what makes one component serve both kinds of field here: the
 * capture sheet's controlled `value`/`onChange`, and the panel's uncontrolled
 * `defaultValue`/`onBlur`. Assigning `el.value` alone would update the screen
 * and leave a controlled parent holding the old string.
 *
 * Options take `onMouseDown` + `preventDefault`, so clicking one keeps focus
 * in the field. Otherwise the click blurs it first, and an `onBlur` save
 * would write the half-typed `@Flu` before the pick lands.
 */
export function MentionTextarea({
  index, className, onKeyDown, ...props
}: ComponentProps<typeof Textarea> & { index: CompanyIndex }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Set while `pick` dispatches its own input event, so `sync` does not read
  // the just-written `@Name ` back as a new query and reopen the picker.
  const picking = useRef(false);
  const listId = useId();
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [active, setActive] = useState(0);

  const options: CompanyRef[] = query ? searchCompanies(index, query.text) : [];
  const open = options.length > 0;

  // Escape closes the picker and nothing else. Radix dismisses its sheets from
  // a capture-phase listener on `document`, which runs before any React
  // handler, so stopping it in `onKeyDown` is too late — the panel the field
  // sits in would close too. A capture listener on `window` runs first.
  useEffect(() => {
    if (!open) return;
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target !== ref.current) return;
      e.stopPropagation();
      e.preventDefault();
      setQuery(null);
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [open]);

  const sync = useCallback(() => {
    const el = ref.current;
    if (picking.current) return;
    if (!el || el.selectionStart !== el.selectionEnd) return setQuery(null);
    const before = el.value.slice(0, el.selectionStart);
    const m = TRIGGER.exec(before);
    setQuery(m ? { text: m[1], start: before.length - m[1].length - 1 } : null);
    setActive(0);
  }, []);

  const pick = (c: CompanyRef) => {
    const el = ref.current;
    if (!el || !query) return;
    const caret = el.selectionStart;
    const next = `${el.value.slice(0, query.start)}@${c.name} ${el.value.slice(caret)}`;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, next);
    picking.current = true;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    picking.current = false;
    const at = query.start + c.name.length + 2;
    el.setSelectionRange(at, at);
    setQuery(null);
  };

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + step + options.length) % options.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(options[active]);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative">
      <Textarea
        {...props}
        ref={ref}
        className={className}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onKeyDown={keys}
        onInput={sync}
        onClick={sync}
        onKeyUp={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') sync(); }}
        onBlur={(e) => { setQuery(null); props.onBlur?.(e); }}
      />
      {open && (
        <ul
          id={listId} role="listbox" aria-label="Mention a company"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {options.map((c, i) => (
            <li
              key={c.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setActive(i)}
              className={cn('cursor-pointer truncate px-2.5 py-1.5 text-[12.5px]',
                i === active ? 'bg-primary/15 text-foreground' : 'text-muted-foreground')}
            >
              @{c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
