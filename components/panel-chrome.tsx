'use client';

import { ChevronLeft, X } from 'lucide-react';

/**
 * The shell every detail panel sits in.
 *
 * Deliberately renders no `Sheet`: several panels can be on screen at once, and
 * two Radix Sheets would mean two overlays and two focus traps competing for
 * the same Escape key. drawer-stack.tsx owns the single Sheet; this is one
 * column inside it.
 *
 * The control bar is its own row rather than buttons tucked into each panel's
 * header. With a stack, every panel needs the same two controls in the same
 * place, and inferring "which panel does this close" from a floating icon is
 * exactly the ambiguity to avoid.
 */
export function PanelChrome({
  label, width, resize, back, onBack, onClose, children,
}: {
  /** What this panel is, for the region label and the close button. */
  label: string;
  width: number;
  resize?: React.ReactNode;
  /** Title of the entry behind this one, when that entry is *not* on screen. */
  back: string | null;
  onBack: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={label}
      style={{ width }}
      className="relative flex h-full min-w-0 shrink-0 flex-col border-l border-border bg-background"
    >
      {resize}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-card pl-1 pr-1.5">
        {back ? (
          <button
            type="button"
            onClick={onBack}
            title={`Back to ${back}`}
            className="flex min-w-0 items-center gap-0.5 rounded px-1 py-1 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{back}</span>
          </button>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${label}`}
          title={`Close ${label}`}
          className="ml-auto shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
      {children}
    </section>
  );
}
