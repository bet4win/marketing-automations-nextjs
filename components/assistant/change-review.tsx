'use client';

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Check, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { applyChanges, diff, isNoop, type ReviewItem, type Value } from '@/lib/assistant/changes';
import { TABLE_LABELS } from '@/lib/assistant/schema';
import { cn } from '@/lib/utils';
import type { ReviewState } from './use-assistant-chat';

/**
 * Review Changes (docs/assistant.md): every change the model proposed, against the row as it is
 * now, to keep, edit or leave out. Apply is the only thing in the assistant that writes.
 */

const shown = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v);

/** An edited cell back to the type the model gave it: a checkbox stays boolean, a count a number. */
function coerce(original: unknown, text: string): Value {
  const t = text.trim();
  if (!t) return null;
  if (typeof original === 'boolean') return /^(true|yes|1)$/i.test(t);
  if (typeof original === 'number' && !Number.isNaN(Number(t))) return Number(t);
  if (Array.isArray(original)) return t.split(',').map((x) => x.trim()).filter(Boolean);
  return t;
}

const ACTION_LABELS = { insert: 'add', upsert: 'add or update', update: 'update' } as const;

function title(item: ReviewItem) {
  const v = item.change.values;
  const who = v.full_name ?? v.met_name ?? v.name_key ?? v.title ?? v.name;
  const where = item.names.company_id;
  return [who ? String(who) : null, where].filter(Boolean).join(' · ') || item.change.table;
}

function Change({
  item, kept, onKeep, onEdit, result, locked,
}: {
  item: ReviewItem;
  kept: boolean;
  onKeep: (keep: boolean) => void;
  onEdit: (values: Record<string, Value>) => void;
  result?: { ok: boolean; error?: string };
  locked: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const cells = diff(item.before, item.change.values);
  const noop = isNoop(item);

  const startEdit = () => {
    setDraft(Object.fromEntries(cells.map((c) => [c.column, c.after == null ? '' : shown(c.after).replace(/^—$/, '')])));
    setEditing(true);
  };
  const finishEdit = () => {
    onEdit(Object.fromEntries(cells.map((c) => [c.column, coerce(c.after, draft[c.column] ?? '')])));
    setEditing(false);
  };

  return (
    <li className={cn('rounded-md border border-border p-2', !kept && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <Checkbox
          checked={kept}
          onCheckedChange={(c) => onKeep(c === true)}
          disabled={locked}
          aria-label={`Keep: ${title(item)}`}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium">
            <span className="text-muted-foreground">
              {TABLE_LABELS[item.change.table] ?? item.change.table} · {ACTION_LABELS[item.change.action]}
            </span>{' '}
            {title(item)}
          </p>
          {item.change.reason && <p className="text-xs text-muted-foreground">{item.change.reason}</p>}
        </div>
        {!locked && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={editing ? 'Done editing' : 'Edit values'}
            onClick={editing ? finishEdit : startEdit}
          >
            {editing ? <Check aria-hidden /> : <Pencil aria-hidden />}
          </Button>
        )}
        {result && (result.ok
          ? <Check aria-label="Applied" className="size-4 text-emerald-700 dark:text-emerald-300" />
          : <X aria-label="Failed" className="size-4 text-destructive" />)}
      </div>

      {item.blocked && <p className="mt-1 text-xs text-destructive">{item.blocked}</p>}
      {item.warnings.map((w) => (
        <p key={w} className="mt-1 text-xs text-amber-700 dark:text-amber-300">{w}</p>
      ))}
      {noop && <p className="mt-1 text-xs text-muted-foreground">Already like this: nothing would change.</p>}
      {result && !result.ok && <p className="mt-1 text-xs text-destructive">{result.error}</p>}

      <table className="mt-1.5 w-full text-xs">
        <tbody>
          {cells.map((c) => (
            <tr key={c.column} className={cn(!c.changed && 'text-muted-foreground')}>
              <th scope="row" className="w-[34%] py-0.5 pr-2 text-left align-top font-normal text-muted-foreground">
                {c.column}
              </th>
              <td className="py-0.5 align-top break-words">
                {editing ? (
                  <input
                    value={draft[c.column] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [c.column]: e.target.value }))}
                    className="w-full rounded border border-input bg-transparent px-1 py-0.5"
                    aria-label={c.column}
                  />
                ) : (
                  <>
                    {item.before && c.changed && (
                      <span className="mr-1 text-muted-foreground line-through">{shown(c.before)}</span>
                    )}
                    <span className={cn(c.changed && 'font-medium')}>
                      {item.names[c.column] ?? shown(c.after)}
                    </span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </li>
  );
}

export function ChangeReview({
  review, supabase, onUpdate, onResolve,
}: {
  review: ReviewState;
  supabase: SupabaseClient;
  onUpdate: (patch: Partial<ReviewState>) => void;
  onResolve: (applied: Awaited<ReturnType<typeof applyChanges>> | null) => void;
}) {
  const kept = new Set(review.kept);
  const locked = review.status !== 'ready';
  const results = new Map(review.applied?.map((a) => [a.key, a]) ?? []);
  const keptCount = review.items.filter((i) => kept.has(i.key)).length;

  const apply = async () => {
    onUpdate({ status: 'applying' });
    const applied = await applyChanges(supabase, review.items.filter((i) => kept.has(i.key)));
    onResolve(applied);
  };

  const done = review.applied?.filter((a) => a.ok).length ?? 0;

  return (
    <section aria-label="Review changes" className="space-y-2 rounded-lg border border-primary/40 bg-card p-3">
      <header>
        <h3 className="text-sm font-semibold">Review changes</h3>
        <p className="text-xs text-muted-foreground">{review.proposal.summary}</p>
      </header>

      {review.status === 'loading' && (
        <p className="animate-pulse text-xs text-muted-foreground">Reading the rows these would change…</p>
      )}
      {review.status === 'error' && <p className="text-xs text-destructive">{review.error}</p>}

      {review.items.length > 0 && (
        <ul className="space-y-2">
          {review.items.map((item) => (
            <Change
              key={item.key}
              item={item}
              kept={kept.has(item.key)}
              locked={locked}
              result={results.get(item.key)}
              onKeep={(keep) =>
                onUpdate({ kept: keep ? [...review.kept, item.key] : review.kept.filter((k) => k !== item.key) })}
              onEdit={(values) =>
                onUpdate({
                  items: review.items.map((i) =>
                    i.key === item.key ? { ...i, change: { ...i.change, values }, blocked: null } : i),
                })}
            />
          ))}
        </ul>
      )}

      {review.status === 'ready' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={!keptCount} onClick={() => void apply()}>
            Apply {keptCount} {keptCount === 1 ? 'change' : 'changes'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onResolve(null)}>
            Discard
          </Button>
        </div>
      )}
      {review.status === 'applying' && <p className="animate-pulse text-xs text-muted-foreground">Applying…</p>}
      {review.status === 'applied' && (
        <p role="status" className="text-xs">
          {done} of {review.applied?.length ?? 0} applied
          {done < (review.applied?.length ?? 0) ? ': the failed ones are marked above.' : '.'}
        </p>
      )}
      {review.status === 'discarded' && <p className="text-xs text-muted-foreground">Discarded. Nothing was written.</p>}
    </section>
  );
}
