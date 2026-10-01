'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// NaN must never survive. Math.max(min, NaN) is NaN, so a single bad drag
// would otherwise poison the stored width permanently: `NaN ?? fallback` is
// NaN, not the fallback, so every later read stays NaN and the column stops
// responding. Callers pass `fallback` so there is always something sane.
const clamp = (n: number, min: number, max: number, fallback = min) =>
  (Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback);

let lastDragEnd = 0;

/**
 * True just after a resize drag finished.
 *
 * A handle sits inside a sortable `<th>`, and stopping propagation on the
 * handle's own click is not enough: the browser fires `click` on the nearest
 * common ancestor of pointer-down and pointer-up, so releasing a few pixels
 * away — still inside the header cell — dispatches the click on the `th`
 * itself and re-sorts the table. Measured: dragging Reach moved the sort off
 * Company. Header handlers must consult this before acting.
 */
export const justDragged = () => Date.now() - lastDragEnd < 300;

/**
 * Start a horizontal drag.
 *
 * Listeners go on `window`, not the handle, so the drag survives the pointer
 * leaving a 5px target — which it will, constantly. The cursor and
 * `user-select` are forced on `document.body` for the duration, otherwise
 * dragging across a table selects half the page.
 */
export function useHorizontalDrag(onDelta: (dx: number, done: boolean) => void) {
  const cb = useRef(onDelta);
  cb.current = onDelta;

  return useCallback((e: React.PointerEvent) => {
    // Ignore anything but the primary button, and never let the surrounding
    // header treat this as a sort click.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const move = (ev: PointerEvent) => cb.current(ev.clientX - startX, false);
    const up = (ev: PointerEvent) => {
      cb.current(ev.clientX - startX, true);
      lastDragEnd = Date.now();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);
}

/** A width persisted to localStorage, restored once on mount. */
export function usePersistedWidth(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(initial);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const n = Number(localStorage.getItem(key));
    if (Number.isFinite(n) && n > 0) setWidth(clamp(n, min, max));
  }, [key, min, max]);

  const set = useCallback((n: number, persist = true) => {
    const v = clamp(n, min, max);
    setWidth(v);
    if (persist) { try { localStorage.setItem(key, String(v)); } catch { /* full or blocked */ } }
  }, [key, min, max]);

  return [width, set] as const;
}

export type ColumnWidths = Record<string, number>;

/**
 * Per-column widths for one table, persisted together under a single key.
 *
 * Restoring merges over the defaults rather than replacing them, so a column
 * added or renamed later gets its default instead of vanishing — a stale
 * localStorage blob must never be able to leave a column with no width.
 */
// 28, not 44: the star column's default is 32, and a floor above a default
// silently widens that column the first time anything else is dragged and the
// whole set is persisted and re-clamped. A floor must sit below every default.
export function useColumnWidths(
  key: string, defaults: ColumnWidths, min = 28, max = 900,
) {
  const [widths, setWidths] = useState<ColumnWidths>(defaults);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as ColumnWidths;
      const merged = { ...defaults };
      for (const k of Object.keys(defaults)) {
        const n = saved[k];
        if (Number.isFinite(n)) merged[k] = clamp(n, min, max, defaults[k]);
      }
      setWidths(merged);
    } catch { /* unparseable: keep defaults */ }
  }, [key, defaults, min, max]);

  const setWidth = useCallback((col: string, px: number, persist: boolean) => {
    setWidths((prev) => {
      const keep = Number.isFinite(prev[col]) ? prev[col] : min;
      const next = { ...prev, [col]: clamp(px, min, max, keep) };
      if (persist) { try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ } }
      return next;
    });
  }, [key, min, max]);

  const reset = useCallback(() => {
    setWidths(defaults);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }, [key, defaults]);

  return { widths, setWidth, reset };
}
