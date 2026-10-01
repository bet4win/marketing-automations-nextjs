'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isAbort, streamChat, type ChatMessage, type ContentPart } from '@/lib/assistant/client';
import { outcomeText, prepareReview, type Applied, type ReviewItem } from '@/lib/assistant/changes';
import { answerOpenCalls } from '@/lib/assistant/history';
import type { ChatImage } from '@/lib/assistant/images';
import { contextText, SYSTEM_PROMPT, type AssistantContext } from '@/lib/assistant/prompt';
import type { AssistantSettings } from '@/lib/assistant/settings';
import { checkProposal, runQuery, TOOLS, type Proposal } from '@/lib/assistant/tools';

/**
 * The assistant's conversation and its tool loop (docs/assistant.md), kept while the board is
 * mounted. Each round streams one answer; reads it asks for run at once and go back to it; a
 * proposal ends the round and waits for the review card.
 */

/** Rounds of tool use per question. A model that is still querying after this is going in circles. */
export const MAX_ROUNDS = 8;

const AWAITING_REVIEW =
  'Shown to the user as a Review Changes card. Nothing is written until they apply it; the outcome arrives in ' +
  'their next message. Stop here.';

export interface UserItem {
  kind: 'user';
  id: number;
  text: string;
  images: ChatImage[];
}

export interface AnswerItem {
  kind: 'answer';
  id: number;
  status: 'streaming' | 'done' | 'stopped' | 'error';
  text: string;
  thinking: boolean;
  finishReason: string | null;
  error: unknown;
}

export interface ToolItem {
  kind: 'tool';
  id: number;
  label: string;
  status: 'running' | 'done' | 'failed';
  /** Why it failed, as the model was told: the database's message, or what was wrong with the call. */
  detail?: string;
}

export interface ReviewState {
  kind: 'review';
  id: number;
  proposal: Proposal;
  status: 'loading' | 'ready' | 'applying' | 'applied' | 'discarded' | 'error';
  items: ReviewItem[];
  /** Keys of the changes still ticked. */
  kept: string[];
  applied: Applied[] | null;
  error: string | null;
}

export type Item = UserItem | AnswerItem | ToolItem | ReviewState;

export function useAssistantChat({
  settings,
  getContext,
  onApplied,
}: {
  settings: AssistantSettings | null;
  /** Read at the start of each round, so it follows the event and panel the user is on. */
  getContext: () => AssistantContext;
  onApplied: (applied: Applied[]) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Item[]>([]);
  const history = useRef<ChatMessage[]>([]);
  const ids = useRef(0);
  const nextId = useCallback(() => (ids.current += 1), []);
  const running = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => running.current?.abort(), []);

  const add = useCallback((item: Item) => setItems((prev) => [...prev, item]), []);
  const patch = useCallback(<T extends Item>(id: number, change: Partial<T>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? ({ ...i, ...change } as Item) : i)));
  }, []);
  const drop = useCallback((id: number) => setItems((prev) => prev.filter((i) => i.id !== id)), []);

  const openReview = useCallback(
    async (proposal: Proposal) => {
      const id = nextId();
      add({ kind: 'review', id, proposal, status: 'loading', items: [], kept: [], applied: null, error: null });
      try {
        const reviewItems = await prepareReview(supabase, proposal);
        patch<ReviewState>(id, {
          status: 'ready',
          items: reviewItems,
          kept: reviewItems.filter((i) => !i.blocked).map((i) => i.key),
        });
      } catch (e) {
        patch<ReviewState>(id, { status: 'error', error: e instanceof Error ? e.message : 'Could not load the rows.' });
      }
    },
    [supabase, add, patch, nextId],
  );

  const run = useCallback(async () => {
    if (!settings) return;
    const controller = new AbortController();
    running.current?.abort();
    running.current = controller;
    setBusy(true);
    let answerId = 0;
    try {
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        answerId = nextId();
        add({ kind: 'answer', id: answerId, status: 'streaming', text: '', thinking: false, finishReason: null, error: null });
        const system = `${SYSTEM_PROMPT}\n\n## Now\n\n${contextText(getContext())}`;
        const result = await streamChat({
          baseUrl: settings.baseUrl,
          model: settings.model,
          messages: [{ role: 'system', content: system }, ...history.current],
          tools: TOOLS,
          signal: controller.signal,
          onProgress: ({ text, thinking }) => patch<AnswerItem>(answerId, { text, thinking }),
        });
        history.current = [
          ...history.current,
          {
            role: 'assistant',
            content: result.text,
            ...(result.toolCalls.length
              ? {
                  tool_calls: result.toolCalls.map((c) => ({
                    id: c.id,
                    type: 'function' as const,
                    function: { name: c.name, arguments: c.arguments },
                  })),
                }
              : {}),
          },
        ];
        // A round that only calls tools has nothing to read: the tool lines say what it did.
        if (!result.text && result.toolCalls.length) drop(answerId);
        else patch<AnswerItem>(answerId, { status: 'done', text: result.text, thinking: false, finishReason: result.finishReason });
        if (!result.toolCalls.length) return;

        let proposed = false;
        for (const call of result.toolCalls) {
          let content: string;
          if (call.name === 'query') {
            const toolId = nextId();
            add({ kind: 'tool', id: toolId, label: 'Reading…', status: 'running' });
            const outcome = await runQuery(supabase, call.arguments);
            if (controller.signal.aborted) throw new DOMException('Stopped.', 'AbortError');
            patch<ToolItem>(toolId, {
              label: outcome.label,
              status: outcome.ok ? 'done' : 'failed',
              detail: outcome.ok ? undefined : outcome.result.replace(/^Error( from the database)?: /, ''),
            });
            content = outcome.result;
          } else if (call.name === 'propose_changes' && !proposed) {
            const check = checkProposal(call.arguments);
            if (check.ok) {
              proposed = true;
              void openReview(check.proposal);
              content = AWAITING_REVIEW;
            } else {
              add({ kind: 'tool', id: nextId(), label: 'Proposal rejected: fixing it', status: 'failed', detail: check.error });
              content = `Error: ${check.error}. Fix it and call propose_changes again.`;
            }
          } else if (call.name === 'propose_changes') {
            content = 'Error: one proposal per turn. Put every change in the first call.';
          } else {
            content = `Error: there is no tool called ${call.name}. Use query or propose_changes.`;
          }
          history.current = [...history.current, { role: 'tool', tool_call_id: call.id, content }];
        }
        if (proposed) return;
      }
      add({
        kind: 'answer',
        id: nextId(),
        status: 'error',
        text: '',
        thinking: false,
        finishReason: null,
        error: new Error(`Stopped after ${MAX_ROUNDS} rounds of lookups. Try a narrower question.`),
      });
    } catch (error) {
      history.current = answerOpenCalls(history.current, 'Stopped by the user.');
      const end: Partial<AnswerItem> = isAbort(error)
        ? { status: 'stopped', thinking: false }
        : { status: 'error', error, thinking: false };
      // The round's answer may already be gone (a round of tool calls only): say so on a new line.
      setItems((prev) =>
        prev.some((i) => i.id === answerId && i.kind === 'answer')
          ? prev.map((i) => (i.id === answerId ? ({ ...i, ...end } as Item) : i))
          : [...prev, { kind: 'answer', id: nextId(), text: '', finishReason: null, error: null, ...end } as AnswerItem],
      );
    } finally {
      if (running.current === controller) running.current = null;
      setBusy(false);
    }
  }, [settings, getContext, supabase, add, patch, drop, nextId, openReview]);

  const ask = useCallback(
    (text: string, images: ChatImage[]) => {
      const question = text.trim() || (images.length ? 'Add these business cards.' : '');
      if (!question || busy || !settings) return;
      add({ kind: 'user', id: nextId(), text: question, images });
      const content: string | ContentPart[] = images.length
        ? [
            { type: 'text', text: question },
            ...images.map((img): ContentPart => ({ type: 'image_url', image_url: { url: img.url } })),
          ]
        : question;
      history.current = [...answerOpenCalls(history.current, 'No result.'), { role: 'user', content }];
      void run();
    },
    [busy, settings, add, nextId, run],
  );

  /** Tells the model how the review went, so a follow-up knows what is in the database now. */
  const resolveReview = useCallback(
    (review: ReviewState, applied: Applied[] | null) => {
      history.current = [
        ...history.current,
        { role: 'user', content: outcomeText(review.items, applied, new Set(review.kept)) },
      ];
      patch<ReviewState>(review.id, { status: applied ? 'applied' : 'discarded', applied });
      if (applied?.some((a) => a.ok)) onApplied(applied);
    },
    [patch, onApplied],
  );

  const updateReview = useCallback(
    (id: number, change: Partial<ReviewState>) => patch<ReviewState>(id, change),
    [patch],
  );

  const stop = useCallback(() => running.current?.abort(), []);

  const clear = useCallback(() => {
    running.current?.abort();
    history.current = [];
    setItems([]);
  }, []);

  return { items, busy, canAsk: Boolean(settings) && !busy, ask, stop, clear, resolveReview, updateReview, supabase };
}
