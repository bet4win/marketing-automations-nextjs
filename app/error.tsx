'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * What a crash looks like.
 *
 * Without this, a client-side throw gives Next's bare "This page couldn't
 * load" — no message, no way back except a manual reload. That happened twice
 * while building the override editor, and both times the first minute went on
 * working out *what* had failed rather than why.
 *
 * `reset()` re-renders the segment without a full page load, which is usually
 * enough when the cause was transient. The message is shown deliberately: this
 * is an internal tool for a handful of colleagues, and a stack-shaped hint is
 * worth more to them than a reassuring blank.
 */
export default function Error({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side digests are all the production build gives; log both so the
    // browser console has something to match against.
    console.error('Board crashed:', error);
  }, [error]);

  return (
    <main className="grid h-dvh place-items-center p-6">
      <div className="max-w-lg rounded-lg border border-border bg-card p-4">
        <h1 className="mb-1 text-sm font-semibold">Something broke</h1>
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
          Nothing was lost — the board reads from the database on every load, and
          edits are saved as you make them.
        </p>
        <pre className="mb-3 max-h-40 overflow-auto rounded border border-border bg-secondary/60 p-2 text-[11.5px] text-foreground">
          {error.message}{error.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
        <div className="flex gap-2">
          <Button size="sm" onClick={reset}>Try again</Button>
          <Button size="sm" variant="outline" onClick={() => window.location.assign('/companies')}>
            Back to the board
          </Button>
        </div>
      </div>
    </main>
  );
}
