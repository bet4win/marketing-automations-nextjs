'use client';

import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

/**
 * Asking before something that cannot be taken back, in the app's own dialog.
 *
 * Never the browser's confirm(): it cannot be styled, blocks the page, reads as
 * a system warning rather than a question from the app, and an automated
 * browser accepts it by default. `confirmAction` is a plain function returning
 * a promise, so a handler reads the same as it did with confirm():
 *
 *   if (!(await confirmAction({ title: 'Delete this deal?', action: 'Delete' }))) return;
 *
 * The one `ConfirmHost`, mounted in the root layout, shows whichever is asked.
 */

export interface ConfirmOptions {
  title: string;
  /** What happens, and what does not. */
  body?: string;
  /** The button that goes ahead, named for what it does: "Delete", "Disconnect". */
  action: string;
  /** Red, for what destroys something. */
  destructive?: boolean;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  // A second question while one is open answers the first with no.
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { ...options, resolve };
    emit();
  });
}

function answer(ok: boolean) {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(ok);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function ConfirmHost() {
  const asked = useSyncExternalStore(subscribe, () => pending, () => null);
  return (
    <Dialog open={Boolean(asked)} onOpenChange={(open) => { if (!open) answer(false); }}>
      <DialogContent showCloseButton={false} className="w-[420px] gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="text-sm">{asked?.title}</DialogTitle>
          {asked?.body && (
            <DialogDescription className="text-[12.5px] leading-relaxed">{asked.body}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => answer(false)}>Cancel</Button>
          <Button size="sm" variant={asked?.destructive ? 'destructive' : 'default'} autoFocus
            onClick={() => answer(true)}>
            {asked?.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
