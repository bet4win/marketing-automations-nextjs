'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { useHorizontalDrag } from '@/lib/use-resize';

/**
 * A drag target for resizing.
 *
 * Deliberately wider than it looks: the visible line is 1px but the hit area
 * is 9px, because a 1px target is unusable with a mouse. It sits outside the
 * flow via `absolute`, so widening it cannot shift the layout it resizes.
 *
 * It is also **operable from the keyboard**, which it was not for a long time:
 * thirteen of these were on screen at once, all `role="separator"` with no
 * tabindex, so the filter rail, both detail panels and every table column
 * could only be resized with a pointer. An audit of what a keyboard can reach
 * found them; reading the code did not, because nothing about it looks wrong.
 *
 * Arrow keys move it, Shift for a fine adjustment, Home/End for the extremes —
 * the window-splitter pattern, which is why the ARIA value attributes are here
 * too. Without them a screen reader announces a separator and no state.
 */

/** One press. Coarse by default: a 1px step would need a hundred presses. */
const STEP = 16;
const FINE = 2;

export function ResizeHandle({
  start, onResize, side = 'right', invert = false, label, className,
  min, max,
}: {
  /** Read once, at pointer-down, so the drag is measured from a fixed origin. */
  start: () => number;
  /** `done` is true on pointer-up — the point at which to persist. */
  onResize: (next: number, done: boolean) => void;
  /** Which edge of the parent it clings to. The parent needs `relative`. */
  side?: 'left' | 'right';
  /** For panels that grow leftwards, where dragging left must mean bigger. */
  invert?: boolean;
  label: string;
  className?: string;
  /** Bounds, for the announced value and for Home/End. */
  min?: number;
  max?: number;
}) {
  const from = useRef(0);
  const drag = useHorizontalDrag((dx, done) =>
    onResize(from.current + (invert ? -dx : dx), done));

  const current = start();

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? FINE : STEP;
    // `invert` describes which way a *drag* means bigger. It must not apply to
    // the arrows: Right always means wider, whichever edge the handle is on,
    // because that is what the key says.
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = current + step;
    else if (e.key === 'ArrowLeft') next = current - step;
    else if (e.key === 'Home' && min !== undefined) next = min;
    else if (e.key === 'End' && max !== undefined) next = max;
    if (next === null) return;
    e.preventDefault();
    // Persist on every press: there is no key-up "drag end" to wait for, and
    // a resize you cannot keep is not a resize.
    onResize(next, true);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(current)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => { from.current = start(); drag(e); }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute inset-y-0 z-20 w-[9px] cursor-col-resize touch-none select-none',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2',
        'after:bg-transparent hover:after:bg-primary/70 active:after:bg-primary',
        // Visible focus, or a keyboard user cannot tell which of thirteen
        // handles they are on. `focus-visible`, so a pointer drag stays quiet.
        'focus:outline-none focus-visible:after:bg-primary focus-visible:after:w-[3px]',
        side === 'right' ? '-right-[4px]' : '-left-[4px]',
        className,
      )}
    />
  );
}
