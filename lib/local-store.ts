import { useCallback, useSyncExternalStore } from 'react';
import type { ZodType } from 'zod';

/**
 * Small typed localStorage values shared across components and tabs: table views, saved
 * views, later pins. Values are parsed with a Zod schema so a stale or hand-edited entry
 * falls back instead of crashing a screen.
 */
export interface LocalStore<T> {
  key: string;
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  reset: () => void;
  subscribe: (onChange: () => void) => () => void;
}

export function createLocalStore<T>(key: string, schema: ZodType<T>, fallback: T): LocalStore<T> {
  const listeners = new Set<() => void>();
  let lastRaw: string | null | undefined;
  let lastValue: T = fallback;

  const readRaw = (): string | null => {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };

  // useSyncExternalStore needs a stable snapshot: re-parse only when the stored text changes.
  const get = (): T => {
    const raw = readRaw();
    if (raw === lastRaw) return lastValue;
    lastRaw = raw;
    if (raw === null) {
      lastValue = fallback;
    } else {
      try {
        const parsed = schema.safeParse(JSON.parse(raw));
        lastValue = parsed.success ? parsed.data : fallback;
      } catch {
        lastValue = fallback;
      }
    }
    return lastValue;
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    key,
    get,
    set: (next) => {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(get()) : next;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Blocked storage: keep the value for this page only.
        lastRaw = undefined;
        lastValue = value;
      }
      notify();
    },
    reset: () => {
      try {
        localStorage.removeItem(key);
      } catch {
        lastRaw = undefined;
        lastValue = fallback;
      }
      notify();
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      const onStorage = (e: StorageEvent) => {
        if (e.key === key || e.key === null) onChange();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener('storage', onStorage);
      };
    },
  };
}

export function useLocalStore<T>(store: LocalStore<T>): [T, LocalStore<T>['set']] {
  const value = useSyncExternalStore(store.subscribe, store.get, store.get);
  const set = useCallback<LocalStore<T>['set']>((next) => store.set(next), [store]);
  return [value, set];
}
