'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  ImagePlus, Loader2, MessageSquare, Send, Settings, Square, Trash2, TriangleAlert, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { needsSetupHelp } from '@/lib/assistant/client';
import type { Applied } from '@/lib/assistant/changes';
import { MAX_IMAGES, toChatImage, type ChatImage } from '@/lib/assistant/images';
import type { AssistantContext } from '@/lib/assistant/prompt';
import { serverLabel, useAssistantSettings } from '@/lib/assistant/settings';
import { cn } from '@/lib/utils';
import { AnswerText } from './answer-text';
import { ChangeReview } from './change-review';
import { AssistantSettingsDialog, Warning } from './settings-dialog';
import { SetupHelp } from './setup-help';
import { useAssistantChat, type AnswerItem } from './use-assistant-chat';

export const NOTE = 'Your local model reads the data as you. Changes are only written when you apply them.';

function Answer({ item, onStop }: { item: AnswerItem; onStop: () => void }) {
  const streaming = item.status === 'streaming';
  return (
    <article aria-label="Answer" aria-busy={streaming || undefined} className="space-y-2">
      {item.text ? (
        <AnswerText text={item.text} />
      ) : (
        streaming && (
          <p className="animate-pulse text-sm text-muted-foreground">
            {item.thinking ? 'Thinking…' : 'Waiting for the model…'}
          </p>
        )
      )}
      {streaming && item.text && item.thinking && (
        <p className="animate-pulse text-xs text-muted-foreground">Thinking…</p>
      )}
      {item.status === 'done' && item.finishReason === 'length' && (
        <p className="text-xs text-muted-foreground">The model stopped at its length limit.</p>
      )}
      {item.status === 'stopped' && <p className="text-xs text-muted-foreground">Stopped.</p>}
      {item.status === 'error' && (
        <div className="space-y-2">
          <Warning title="The model didn't answer">
            {item.error instanceof Error ? item.error.message : 'Something went wrong.'}
          </Warning>
          {needsSetupHelp(item.error) && <SetupHelp />}
        </div>
      )}
      {streaming && (
        <Button type="button" variant="outline" size="sm" onClick={onStop}>
          <Square aria-hidden /> Stop
        </Button>
      )}
    </article>
  );
}

function Thumbs({ images, onRemove }: { images: ChatImage[]; onRemove?: (id: string) => void }) {
  if (!images.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {images.map((img) => (
        <li key={img.id} className="relative">
          {/* A data: URL made in this browser; next/image has nothing to optimise here. */}
          <img src={img.url} alt={img.name} className="size-14 rounded border border-border object-cover" />
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${img.name}`}
              onClick={() => onRemove(img.id)}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The assistant (docs/assistant.md): a button at the bottom right of the board and a non-modal
 * panel that stays open across the tabs. Escape from inside it closes it. The conversation lives in
 * the board's layout, so it lasts until a reload.
 */
export function AssistantPanel({
  getContext, onApplied,
}: {
  getContext: () => AssistantContext;
  onApplied: (applied: Applied[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const [reading, setReading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settings] = useAssistantSettings();
  const chat = useAssistantChat({ settings, getContext, onApplied });
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const descriptionId = useId();

  // New text keeps the log at the bottom only while the reader is there: scrolling up to read a
  // long answer stops the stream from pulling the view down. Opening the panel starts at the end.
  const atBottom = useRef(true);
  useEffect(() => {
    if (open) atBottom.current = true;
  }, [open]);
  useEffect(() => {
    const log = logRef.current;
    if (log && atBottom.current) log.scrollTop = log.scrollHeight;
  }, [open, chat.items]);

  const addFiles = async (files: File[]) => {
    const picked = files.filter((f) => f.type.startsWith('image/'));
    if (!picked.length) return;
    const room = MAX_IMAGES - images.length;
    if (picked.length > room) toast.error(`Up to ${MAX_IMAGES} images per message.`);
    const take = picked.slice(0, Math.max(0, room));
    setReading((n) => n + take.length);
    for (const file of take) {
      try {
        const img = await toChatImage(file);
        setImages((prev) => (prev.length < MAX_IMAGES ? [...prev, img] : prev));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not read ${file.name}.`);
      } finally {
        setReading((n) => n - 1);
      }
    }
  };

  const send = () => {
    if ((!draft.trim() && !images.length) || !chat.canAsk || reading) return;
    atBottom.current = true;
    chat.ask(draft, images);
    setDraft('');
    setImages([]);
  };

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
        <DialogPrimitive.Trigger asChild>
          <Button
            aria-label="Assistant"
            title="Assistant"
            size="icon-lg"
            className="fixed right-4 bottom-4 z-40 size-11 rounded-full shadow-lg"
          >
            <MessageSquare aria-hidden className="size-5" />
          </Button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={descriptionId}
          // Stays open while the user works on the board.
          onInteractOutside={(e) => e.preventDefault()}
          // Escape closes the panel only from inside it, not while the user types on the page.
          onEscapeKeyDown={(e) => {
            if (!contentRef.current?.contains(document.activeElement)) e.preventDefault();
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (inputRef.current && !inputRef.current.disabled ? inputRef.current : contentRef.current)?.focus();
          }}
          onDragOver={(e) => {
            if (!settings || !e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            if (!settings) return;
            e.preventDefault();
            setDragging(false);
            void addFiles([...e.dataTransfer.files]);
          }}
          className={cn(
            'fixed right-4 bottom-18 z-40 flex max-h-[calc(100dvh-6.5rem)] w-[min(30rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl outline-none',
            settings && 'h-[min(44rem,calc(100dvh-6.5rem))]',
            dragging && 'ring-2 ring-primary',
          )}
        >
          <header className="flex items-start gap-1 border-b border-border py-2 pr-2 pl-4">
            <div className="min-w-0 flex-1 py-1">
              <DialogPrimitive.Title className="text-sm font-semibold">Assistant</DialogPrimitive.Title>
              <DialogPrimitive.Description id={descriptionId} className="truncate text-xs text-muted-foreground">
                {settings ? `${settings.model} on ${serverLabel(settings.baseUrl)}` : 'Not set up on this device'}
              </DialogPrimitive.Description>
            </div>
            {chat.items.length > 0 && (
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear the conversation" onClick={chat.clear}>
                <Trash2 aria-hidden />
              </Button>
            )}
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Assistant settings" onClick={() => setSettingsOpen(true)}>
              <Settings aria-hidden />
            </Button>
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Close the assistant">
                <X aria-hidden />
              </Button>
            </DialogPrimitive.Close>
          </header>

          {!settings ? (
            <div className="space-y-3 p-4 text-sm">
              <p className="font-medium">Set up a local model</p>
              <p className="text-muted-foreground">
                The assistant answers from the data, proposes changes for you to review, and reads business cards, with
                a model that runs on this device, such as LM Studio or Ollama. Nothing goes anywhere else.
              </p>
              <Button type="button" onClick={() => setSettingsOpen(true)}>
                <Settings aria-hidden /> Set up the assistant…
              </Button>
            </div>
          ) : (
            <>
              <div
                ref={logRef}
                onScroll={(e) => {
                  const log = e.currentTarget;
                  atBottom.current = log.scrollHeight - log.clientHeight - log.scrollTop < 48;
                }}
                role="log"
                aria-label="Conversation"
                aria-busy={chat.busy || undefined}
                className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
              >
                {chat.items.length === 0 && (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>Ask about companies, people, stands or the pipeline. For example:</p>
                    <ul className="list-disc pl-5">
                      <li>Which aggregators at this event haven&apos;t been contacted?</li>
                      <li>Mark Kiron as contacted today, next action: send deck on Friday.</li>
                      <li>Drop in photos of business cards to add the people.</li>
                    </ul>
                  </div>
                )}
                {chat.items.map((item) => {
                  if (item.kind === 'user') {
                    return (
                      <div key={item.id} className="ml-auto w-fit max-w-[85%] space-y-1.5 rounded-lg bg-muted px-3 py-2 text-sm">
                        <Thumbs images={item.images} />
                        <p className="whitespace-pre-wrap">
                          <span className="sr-only">You: </span>
                          {item.text}
                        </p>
                      </div>
                    );
                  }
                  if (item.kind === 'tool') {
                    return (
                      <div key={item.id} className="font-mono text-[11px] text-muted-foreground">
                        <p className="flex items-center gap-1.5">
                          {item.status === 'running' ? (
                            <Loader2 aria-hidden className="size-3 animate-spin" />
                          ) : item.status === 'failed' ? (
                            <TriangleAlert aria-hidden className="size-3 text-amber-700 dark:text-amber-300" />
                          ) : (
                            <span aria-hidden>↳</span>
                          )}
                          {item.label}
                        </p>
                        {item.detail && (
                          <p className="mt-0.5 pl-4.5 break-words text-amber-700 dark:text-amber-300">{item.detail}</p>
                        )}
                      </div>
                    );
                  }
                  if (item.kind === 'review') {
                    return (
                      <ChangeReview
                        key={item.id}
                        review={item}
                        supabase={chat.supabase}
                        onUpdate={(patch) => chat.updateReview(item.id, patch)}
                        onResolve={(applied) => chat.resolveReview(item, applied)}
                      />
                    );
                  }
                  return <Answer key={item.id} item={item} onStop={chat.stop} />;
                })}
                {chat.busy && chat.items[chat.items.length - 1]?.kind !== 'answer' && (
                  <Button type="button" variant="outline" size="sm" onClick={chat.stop}>
                    <Square aria-hidden /> Stop
                  </Button>
                )}
              </div>
              <div className="space-y-2 border-t border-border p-3">
                <p className="text-xs text-muted-foreground">{NOTE}</p>
                <Thumbs images={images} onRemove={(id) => setImages((prev) => prev.filter((i) => i.id !== id))} />
                {reading > 0 && <p className="animate-pulse text-xs text-muted-foreground">Preparing images…</p>}
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      void addFiles([...(e.target.files ?? [])]);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Add images"
                    title="Add images (or paste, or drop them here)"
                    onClick={() => fileRef.current?.click()}
                  >
                    <ImagePlus aria-hidden />
                  </Button>
                  <Textarea
                    ref={inputRef}
                    rows={2}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onPaste={(e) => {
                      const files = [...e.clipboardData.files];
                      if (files.some((f) => f.type.startsWith('image/'))) {
                        e.preventDefault();
                        void addFiles(files);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    aria-label="Ask the assistant"
                    placeholder={images.length ? 'Add a note, or just send' : 'Ask, or tell it what to change'}
                    className="max-h-32 min-h-0 resize-none"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    aria-label="Send"
                    disabled={!chat.canAsk || reading > 0 || (!draft.trim() && !images.length)}
                  >
                    <Send aria-hidden />
                  </Button>
                </form>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Root>
      <AssistantSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
