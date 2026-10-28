import { z } from 'zod';
import { createLocalStore, useLocalStore } from '@/lib/local-store';
import { STORAGE_PREFIX } from '@/lib/storage';

/**
 * The assistant's per-device setting (docs/assistant.md): an OpenAI-compatible server on this
 * machine and the model to use. Kept in this browser only; off until saved.
 */

// Loopback only: `http(s)://localhost[:port][/path]` or `http(s)://127.0.0.1[:port][/path]`. No
// user info, query or fragment, so nothing can smuggle another host in.
const LOCAL_ADDRESS = /^(https?):\/\/(localhost|127\.0\.0\.1)(?::(\d{1,5}))?((?:\/[A-Za-z0-9._~%-]*)*)$/i;

export type AddressCheck = { ok: true; baseUrl: string } | { ok: false; error: string };

/** Validates a server address and normalises it: lower-case scheme and host, no trailing slash. */
export function checkAddress(input: string): AddressCheck {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Enter the address of your model server.' };
  const match = LOCAL_ADDRESS.exec(text);
  if (!match) {
    return {
      ok: false,
      error: 'Use an address on this device, such as http://localhost:1234/v1 or http://127.0.0.1:11434/v1.',
    };
  }
  const [, scheme = '', host = '', port, path = ''] = match;
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65_535)) {
    return { ok: false, error: 'The port must be between 1 and 65535.' };
  }
  const portPart = port === undefined ? '' : `:${Number(port)}`;
  return {
    ok: true,
    baseUrl: `${scheme.toLowerCase()}://${host.toLowerCase()}${portPart}${path.replace(/\/+$/, '')}`,
  };
}

/** `localhost:1234`: how the panel names the server. */
export function serverLabel(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

export const assistantSettingsSchema = z.object({
  // A hand-edited entry that isn't a normalised local address falls back to "not set up".
  baseUrl: z.string().refine((value) => {
    const check = checkAddress(value);
    return check.ok && check.baseUrl === value;
  }),
  model: z.string().trim().min(1).max(200),
});

export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;

export const ASSISTANT_STORAGE_KEY = `${STORAGE_PREFIX}assistant`;

export const assistantStore = createLocalStore<AssistantSettings | null>(
  ASSISTANT_STORAGE_KEY,
  assistantSettingsSchema.nullable(),
  null,
);

export const useAssistantSettings = () => useLocalStore(assistantStore);

/** The first chat model in a server's list: embedding models can't answer. */
export function defaultModel(models: string[], saved?: string): string | undefined {
  if (saved && models.includes(saved)) return saved;
  return models.find((id) => !/embed/i.test(id)) ?? models[0];
}
