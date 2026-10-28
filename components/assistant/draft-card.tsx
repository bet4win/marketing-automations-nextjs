'use client';

import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { DraftArgs } from '@/lib/assistant/tools';
import type { DraftState } from './use-assistant-chat';

/**
 * A draft the assistant wrote, to edit and then save to the user's Gmail Drafts (docs/assistant.md).
 * Like Review Changes, the button is the only thing that acts: the model's call only shows this.
 * Saving creates a draft and sends nothing.
 */

const list = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

export function DraftCard({ item, onUpdate, onResolve }: {
  item: DraftState;
  onUpdate: (change: Partial<DraftState>) => void;
  onResolve: (outcome: { savedFrom: string } | null) => void;
}) {
  const d = item.draft;
  const locked = item.status !== 'ready' && item.status !== 'error';
  const set = (change: Partial<DraftArgs>) => onUpdate({ draft: { ...d, ...change } });

  const save = async () => {
    onUpdate({ status: 'saving', error: null });
    const res = await fetch('/api/integrations/gmail/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(d),
    });
    const body = (await res.json().catch(() => ({}))) as { from?: string; error?: string };
    if (!res.ok || !body.from) {
      onUpdate({ status: 'error', error: body.error ?? res.statusText });
      return;
    }
    onResolve({ savedFrom: body.from });
  };

  const field = 'h-8 text-[12.5px]';
  return (
    <section aria-label="Draft email" className="space-y-2 rounded-lg border border-primary/40 bg-card p-3">
      <header className="flex items-center gap-1.5">
        <Mail aria-hidden className="size-3.5 text-primary" />
        <h3 className="text-sm font-semibold">Draft email</h3>
        {d.reply_to && <span className="text-xs text-muted-foreground">· a reply, in the same thread</span>}
      </header>

      <div className="grid grid-cols-[2.5rem_1fr] items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
        <label htmlFor={`to-${item.id}`}>To</label>
        <Input id={`to-${item.id}`} className={field} disabled={locked}
          value={d.to.join(', ')} onChange={(e) => set({ to: list(e.target.value) })} />
        <label htmlFor={`cc-${item.id}`}>Cc</label>
        <Input id={`cc-${item.id}`} className={field} disabled={locked}
          value={d.cc.join(', ')} onChange={(e) => set({ cc: list(e.target.value) })} />
        <label htmlFor={`subject-${item.id}`}>Subject</label>
        <Input id={`subject-${item.id}`} className={field} disabled={locked}
          value={d.subject} onChange={(e) => set({ subject: e.target.value })} />
      </div>
      <Textarea
        aria-label="Body" disabled={locked} value={d.body} onChange={(e) => set({ body: e.target.value })}
        className="min-h-48 text-[12.5px] leading-relaxed"
      />
      <p className="text-[11px] text-muted-foreground">
        **bold** and [text](link) are kept. Your Gmail signature is added when it is saved.
      </p>

      {(item.status === 'ready' || item.status === 'error') && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={!d.to.length || !d.subject.trim() || !d.body.trim()}
            onClick={() => void save()}>
            Create draft in Gmail
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onResolve(null)}>Discard</Button>
        </div>
      )}
      {item.status === 'error' && <p className="text-xs text-destructive">Could not save it: {item.error}</p>}
      {item.status === 'saving' && <p className="animate-pulse text-xs text-muted-foreground">Saving to Gmail…</p>}
      {item.status === 'saved' && (
        <p role="status" className="text-xs">Saved in Drafts ({item.from}). Nothing was sent.</p>
      )}
      {item.status === 'discarded' && <p className="text-xs text-muted-foreground">Discarded. Nothing was saved.</p>}
    </section>
  );
}
