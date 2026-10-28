'use client';

import { useSyncExternalStore } from 'react';

/**
 * Is the viewport at least this wide?
 *
 * `useSyncExternalStore` rather than `useState` + an effect, because this
 * decides *which component tree renders* — a table or a card list. An effect
 * would mean one render at the wrong shape and a virtualiser measuring a box
 * it is about to be thrown out of.
 *
 * The server snapshot is `true`. There is no viewport on the server, so
 * something has to be assumed, and assuming a desk is the honest default for a
 * tool whose other three views are desktop-first. On a phone that costs one
 * frame of the wrong layout before it corrects.
 */
export function useIsWide(minPx = 1024) {
  const query = `(min-width: ${minPx}px)`;
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}
