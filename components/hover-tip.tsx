'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Props that give an element an instant tooltip: a short label, and
 * optionally a second line saying why.
 *
 * Attributes rather than a component, because the marks sit in every row of a
 * board that renders ~1,400 of them. A tooltip component per icon is the same
 * per-row cost that made Radix Select take 17s per event switch; attributes
 * cost nothing, and the one `HoverTip` reads them.
 */
export function tip(label: string, detail?: string | null) {
  return detail
    ? { 'data-tip': label, 'data-tip-detail': detail }
    : { 'data-tip': label };
}

type Shown = { label: string; detail: string | null; rect: DOMRect };

const GAP = 6;
const EDGE = 8;

/**
 * The one tooltip, mounted once in the root layout.
 *
 * Shows on hover and on keyboard focus with no delay: the native `title`
 * waits about a second and cannot be styled. Positioned `fixed` in a portal,
 * so a table cell's `overflow-hidden` cannot clip it. Not on touch: a tap is
 * already the click, and a tooltip left behind by one has nothing to dismiss it.
 */
export function HoverTip() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const current = useRef<Element | null>(null);

  const show = useCallback((el: Element | null) => {
    const target = el?.closest('[data-tip]') ?? null;
    if (target === current.current) return;
    current.current = target;
    if (!target) { setShown(null); return; }
    setPos(null);
    setShown({
      label: target.getAttribute('data-tip') ?? '',
      detail: target.getAttribute('data-tip-detail'),
      rect: target.getBoundingClientRect(),
    });
  }, []);

  useEffect(() => {
    const over = (e: PointerEvent) => { if (e.pointerType !== 'touch') show(e.target as Element); };
    const focus = (e: FocusEvent) => show(e.target as Element);
    const hide = () => show(null);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', key);
    // Capture, so a scroll inside any panel or table moves nothing under a
    // tooltip that would then point at the wrong row.
    window.addEventListener('scroll', hide, true);
    document.documentElement.addEventListener('pointerleave', hide);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', hide, true);
      document.documentElement.removeEventListener('pointerleave', hide);
    };
  }, [show]);

  // Measured before paint, so the bubble never flashes at an unclamped spot.
  useLayoutEffect(() => {
    if (!shown || !bubble.current) return;
    const { width, height } = bubble.current.getBoundingClientRect();
    const { rect } = shown;
    const above = rect.top - GAP - height;
    const top = above >= EDGE ? above : rect.bottom + GAP;
    const centre = rect.left + rect.width / 2 - width / 2;
    const left = Math.min(Math.max(centre, EDGE), window.innerWidth - width - EDGE);
    setPos({ left, top });
  }, [shown]);

  if (!shown?.label) return null;
  return createPortal(
    <div
      ref={bubble}
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      className="pointer-events-none fixed z-[100] max-w-[280px] rounded-md border border-border bg-popover px-2 py-1 text-popover-foreground shadow-md"
    >
      <div className="text-[11.5px] font-medium leading-snug">{shown.label}</div>
      {shown.detail && (
        <div className="whitespace-pre-line text-[11px] leading-snug text-muted-foreground">{shown.detail}</div>
      )}
    </div>,
    document.body,
  );
}

/** A multi-line `title` string as a tip: the first line labels, the rest explain. */
export function tipText(text: string | null | undefined) {
  if (!text) return {};
  const [label, ...rest] = text.split('\n');
  return tip(label, rest.join('\n') || null);
}
