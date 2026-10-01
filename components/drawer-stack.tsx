'use client';

import { Fragment, useEffect, useState } from 'react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { usePersistedWidth } from '@/lib/use-resize';
import { entryKey, entryTitle, visibleCount, type StackEntry } from '@/lib/drawer-stack';
import { cn } from '@/lib/utils';

/**
 * The detail panels, as a stack laid out right to left.
 *
 * Composed from the Radix Dialog primitives rather than `SheetContent`, for two
 * reasons: `SheetContent` is `flex-col` with a `sm:max-w-sm` cap and renders its
 * own close button in the corner, all three of which fight a row of panels —
 * and editing `components/ui/*` is off-limits, since it is generated.
 *
 * One Root, one Overlay, one Content. So there is one focus trap, one Escape
 * handler and one backdrop no matter how many panels are open.
 *
 * How many are shown is a measurement, not a breakpoint: panel widths are
 * user-resizable and persisted, so whether two fit depends on what the user
 * dragged them to. When only one fits, it gets a Back button naming the entry
 * behind it — which is the "overlay with a way back" case.
 */

export type PanelChromeProps = {
  width: number;
  onWidth: (px: number, done?: boolean) => void;
  /** Resize bounds, so the handle can announce its value and honour Home/End. */
  widthMin: number;
  widthMax: number;
  back: string | null;
  onBack: () => void;
  onClose: () => void;
};

export function DrawerStack({
  stack, onCloseAll, onPop, onTruncate, render,
}: {
  stack: StackEntry[];
  onCloseAll: () => void;
  /** Drop the newest entry, revealing the one behind it. */
  onPop: () => void;
  /** Close this panel and everything opened from it. */
  onTruncate: (index: number) => void;
  render: (entry: StackEntry, chrome: PanelChromeProps) => React.ReactNode;
}) {
  const [companyWidth, setCompanyWidth] = usePersistedWidth('lanyard.drawer.company', 420, 320, 900);
  const [personWidth, setPersonWidth] = usePersistedWidth('lanyard.drawer.person', 380, 300, 900);

  const [viewport, setViewport] = useState(0);
  useEffect(() => {
    const measure = () => setViewport(window.innerWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const open = stack.length > 0;
  /**
   * Never wider than the screen.
   *
   * The persisted widths are whatever someone dragged them to on a desktop —
   * up to 900px — and a 900px panel on a 390px phone is a panel you cannot
   * read or close. The stored preference is left alone; it is only clamped for
   * display, so going back to a laptop restores the width you chose.
   */
  const cap = viewport ? Math.min(viewport, 900) : 900;
  const widthOf = (e: StackEntry) =>
    Math.min(e.kind === 'company' ? companyWidth : personWidth, cap);
  const setWidthOf = (e: StackEntry) =>
    (e.kind === 'company' ? setCompanyWidth : setPersonWidth);

  // Before the first measurement, show one panel — the same as the narrow case,
  // and the honest answer when the viewport is not yet known.
  const shown = viewport
    ? visibleCount(stack.map(widthOf), viewport)
    : 1;
  const first = Math.max(0, stack.length - shown);
  const visible = stack.slice(first);

  if (!open) return null;

  return (
    <SheetPrimitive.Root open onOpenChange={(o) => !o && onCloseAll()}>
      <SheetPrimitive.Portal>
        <SheetPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/50',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        />
        <SheetPrimitive.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex h-full flex-row shadow-lg outline-none',
            'transition ease-in-out',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-300',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-200',
          )}
        >
          {/* Radix requires a title in the content for the dialog to be
              labelled. Each panel renders its own heading, so this is the
              accessible name for the group and is not shown. */}
          <SheetPrimitive.Title className="sr-only">
            {entryTitle(stack[stack.length - 1])} — details
          </SheetPrimitive.Title>

          {visible.map((entry, i) => {
            const index = first + i;
            const previous = index > 0 ? stack[index - 1] : null;
            // Only offer Back when the entry behind is not itself on screen;
            // pointing at a panel the user can already see is noise.
            const hidden = previous && index === first;
            return (
              // A Fragment, not a wrapper element: the panels are flex
              // children of the Content, and an extra box between them — even
              // `display: contents` — is a node that does not need to exist.
              <Fragment key={entryKey(entry)}>
                {render(entry, {
                  width: widthOf(entry),
                  onWidth: setWidthOf(entry),
                  widthMin: entry.kind === 'company' ? 320 : 300,
                  widthMax: 900,
                  back: hidden ? entryTitle(previous) : null,
                  onBack: onPop,
                  onClose: () => onTruncate(index),
                })}
              </Fragment>
            );
          })}
        </SheetPrimitive.Content>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  );
}
