'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { EventRow } from '@/lib/types';

/**
 * floorplan.live exposes no deep-link parameter — nine candidate query keys
 * were tested and all are ignored — and the iframe is cross-origin, so its
 * search box cannot be driven from here. Copying the booth code is the ceiling.
 */
export function FloorplanDialog({
  event, booth, open, onOpenChange,
}: {
  event: EventRow | null;
  booth: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  if (!event?.floorplan_url) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `sm:max-w-none` is load-bearing. DialogContent's base classes include
          `sm:max-w-lg`, and `cn` is tailwind-merge, which only merges classes
          sharing a variant prefix — an unprefixed `max-w-none` does not cancel
          an `sm:`-prefixed one. Without this the plan renders 512px wide on any
          screen above the sm breakpoint, whatever `w-` says. */}
      <DialogContent
        showCloseButton={false}
        className="flex h-[94dvh] w-[97vw] max-w-none flex-col gap-0 p-0 sm:max-w-none"
      >
        <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b border-border p-2.5 shrink-0">
          <DialogTitle className="text-sm">{event.name} — floorplan</DialogTitle>
          <p className="rounded-r border border-l-2 border-border border-l-amber-600 bg-background px-2 py-1 text-[11.5px] text-muted-foreground">
            {booth
              ? <>Paste <code className="font-semibold text-amber-500">{booth}</code> into the plan’s search box.</>
              : 'This plan has no deep-link parameter; paste a booth code into its search.'}
          </p>
          <div className="ml-auto flex gap-2">
            <Button asChild variant="outline" size="sm" className="h-7 text-xs">
              <a href={event.floorplan_url} target="_blank" rel="noopener">Open in new tab</a>
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogHeader>
        <iframe
          src={event.floorplan_url}
          title={`${event.name} floorplan`}
          referrerPolicy="no-referrer"
          className="flex-1 border-0 bg-white"
        />
      </DialogContent>
    </Dialog>
  );
}
