'use client';

import { useId, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

function Command({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1 flex items-start gap-1 rounded-md border border-border bg-background px-2 py-1">
      <code className="min-w-0 flex-1 font-mono text-xs break-all">{value}</code>
      <button
        type="button"
        aria-label={label}
        title={label}
        className="text-muted-foreground hover:text-foreground"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      </button>
    </div>
  );
}

/**
 * What to change when the browser can't reach the model server: the server must allow this site's
 * origin (CORS), and Chrome asks before a site may reach the local network.
 */
export function SetupHelp({ className }: { className?: string }) {
  const id = useId();
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <section aria-labelledby={id} className={cn('space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm', className)}>
      <h3 id={id} className="font-medium">
        Setup help
      </h3>
      <ul className="space-y-2 text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">LM Studio:</span> open the Developer tab, then Server settings,
          and turn on Enable CORS. Load a model that reads images (Qwen3.5 and later, Gemma 3) for business cards.
        </li>
        <li>
          <span className="font-medium text-foreground">Ollama on macOS:</span> allow this site, then restart the Ollama
          app.
          <Command value={`launchctl setenv OLLAMA_ORIGINS "${origin}"`} label="Copy the launchctl command" />
          <span className="mt-1 block">Or start the server yourself:</span>
          <Command value={`OLLAMA_ORIGINS=${origin} ollama serve`} label="Copy the ollama serve command" />
        </li>
        <li>
          <span className="font-medium text-foreground">Chrome</span> may ask once to let this site reach devices on
          your local network. Choose Allow.
        </li>
      </ul>
    </section>
  );
}
