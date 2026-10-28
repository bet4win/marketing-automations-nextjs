'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AssistantError, isAbort, listModels, needsSetupHelp } from '@/lib/assistant/client';
import {
  assistantStore, checkAddress, defaultModel, serverLabel, useAssistantSettings,
} from '@/lib/assistant/settings';
import { SetupHelp } from './setup-help';

/** A server that doesn't answer the test in this long counts as unreachable (Chrome's prompt can wait). */
export const TEST_TIMEOUT_MS = 30_000;

type Test =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; baseUrl: string; models: string[] }
  | { state: 'failed'; error: unknown };

export function Warning({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-amber-600/40 bg-amber-500/10 p-3 text-sm dark:border-amber-400/40 dark:bg-amber-400/10">
      <p className="font-medium text-amber-700 dark:text-amber-300">{title}</p>
      {children && <div className="mt-1 text-muted-foreground">{children}</div>}
    </div>
  );
}

/** The per-device assistant setting: the user menu's "Assistant…" and the panel open it. */
export function AssistantSettingsDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted only while open, so every visit starts from the saved setting. */}
      {open && <SettingsForm onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function SettingsForm({ onDone }: { onDone: () => void }) {
  const [saved, setSaved] = useAssistantSettings();
  const [address, setAddress] = useState(saved?.baseUrl ?? '');
  const [touched, setTouched] = useState(false);
  const [test, setTest] = useState<Test>({ state: 'idle' });
  const [model, setModel] = useState(saved?.model ?? '');
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const addressId = useId();
  const modelId = useId();

  const check = checkAddress(address);
  const tested = test.state === 'ok' && check.ok && test.baseUrl === check.baseUrl;
  // Until a test lists the server's models, the saved model stands for an unchanged address.
  const models = tested ? test.models : saved && check.ok && saved.baseUrl === check.baseUrl ? [saved.model] : [];
  const canSave = check.ok && models.includes(model);
  const addressError = touched && !check.ok ? check.error : null;

  const runTest = async () => {
    setTouched(true);
    if (!check.ok) return;
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TEST_TIMEOUT_MS);
    setTest({ state: 'testing' });
    try {
      const list = await listModels(check.baseUrl, controller.signal);
      setTest({ state: 'ok', baseUrl: check.baseUrl, models: list });
      setModel((current) => defaultModel(list, current || saved?.model) ?? '');
    } catch (error) {
      if (isAbort(error) && !timedOut) return;
      setTest({
        state: 'failed',
        error: timedOut
          ? new AssistantError(
            'timeout',
            `No answer from ${serverLabel(check.baseUrl)} within ${TEST_TIMEOUT_MS / 1000} seconds. See the setup help.`,
          )
          : error,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const save = () => {
    if (!check.ok || !canSave) return;
    setSaved({ baseUrl: check.baseUrl, model });
    toast.success('Assistant saved for this browser');
    onDone();
  };

  const remove = () => {
    assistantStore.reset();
    toast.info('Assistant removed from this browser');
    onDone();
  };

  const failure = test.state === 'failed' ? test.error : null;

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Assistant settings</DialogTitle>
        <DialogDescription>
          Ask about the data, propose changes and read business cards with a model that runs on this device. This
          browser sends your questions, images and query results straight to your model server, nowhere else. The
          setting is kept in this browser only.
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save();
          else void runTest();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={addressId}>Server address</Label>
          <div className="flex gap-2">
            <Input
              id={addressId}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="http://localhost:1234/v1"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={addressError ? true : undefined}
            />
            <Button type="button" variant="outline" onClick={() => void runTest()} disabled={test.state === 'testing'}>
              {test.state === 'testing' ? 'Testing…' : 'Test connection'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            An OpenAI-compatible server on this device. LM Studio: http://localhost:1234/v1. Ollama:
            http://localhost:11434/v1.
          </p>
          {addressError && <p className="text-xs text-destructive">{addressError}</p>}
        </div>

        {tested && (
          <p role="status" className="flex items-center gap-1.5 text-sm">
            <Check aria-hidden className="size-4 text-emerald-700 dark:text-emerald-300" />
            Connected: {test.models.length} {test.models.length === 1 ? 'model' : 'models'} on{' '}
            {serverLabel(test.baseUrl)}.
          </p>
        )}
        {failure !== null && (
          <div className="space-y-3">
            <Warning title="Couldn't connect">
              {failure instanceof Error ? failure.message : 'The test failed.'}
            </Warning>
            {needsSetupHelp(failure) && <SetupHelp />}
          </div>
        )}

        {models.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor={modelId}>Model</Label>
            <select
              id={modelId}
              value={models.includes(model) ? model : ''}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="" disabled>Choose a model</option>
              {models.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
            {!tested && <p className="text-xs text-muted-foreground">Test the connection to choose another model.</p>}
          </div>
        )}
        {tested && models.length === 0 && (
          <Warning title="No models">
            The server lists no models. Load one in LM Studio, or pull one with Ollama, then test again.
          </Warning>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {saved ? (
            <Button type="button" variant="ghost" className="text-destructive" onClick={remove}>
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
