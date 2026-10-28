import { z } from 'zod';
import { serverLabel } from './settings';
import { createSseParser, createToolCallCollector, extractTaggedCalls, readChunk, stripThink, type ToolCall } from './stream';

/**
 * The browser talks to the user's own model server directly (docs/assistant.md): our server is
 * never in the path, no token or cookie is sent, and nothing is logged.
 */

export type AssistantErrorKind = 'unreachable' | 'timeout' | 'http' | 'bad-response';

export class AssistantError extends Error {
  readonly kind: AssistantErrorKind;
  readonly status?: number;

  constructor(kind: AssistantErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AssistantError';
    this.kind = kind;
    this.status = status;
  }
}

const named = (error: unknown, name: string) =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name;

/** A cancelled request (Stop, a closed dialog). Checked by name: jsdom and Node have their own DOMException. */
export const isAbort = (error: unknown) => named(error, 'AbortError');

/** What the setup help can fix: the server isn't reachable from this page (not running, or CORS). */
export const needsSetupHelp = (error: unknown) =>
  error instanceof AssistantError && (error.kind === 'unreachable' || error.kind === 'timeout');

const MAX_SERVER_MESSAGE = 300;

async function serverMessage(res: Response): Promise<string | null> {
  try {
    const text = (await res.text()).trim();
    if (!text) return null;
    try {
      const json = JSON.parse(text) as { error?: string | { message?: string }; message?: string };
      const message = typeof json.error === 'string' ? json.error : (json.error?.message ?? json.message);
      if (typeof message === 'string' && message.trim()) return message.trim().slice(0, MAX_SERVER_MESSAGE);
    } catch {
      // Not JSON: use the text itself.
    }
    return text.slice(0, MAX_SERVER_MESSAGE);
  } catch {
    return null;
  }
}

async function send(baseUrl: string, path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    if (named(error, 'TimeoutError')) {
      throw new AssistantError('timeout', `No answer from ${serverLabel(baseUrl)} in time. See the setup help.`);
    }
    // The browser hides why (CORS and "connection refused" look the same from a page).
    throw new AssistantError(
      'unreachable',
      `Couldn't reach ${serverLabel(baseUrl)}. The server may not be running, or it doesn't allow this site yet: see the setup help.`,
    );
  }
  if (!res.ok) {
    const detail = await serverMessage(res);
    throw new AssistantError(
      'http',
      `${serverLabel(baseUrl)} answered ${res.status}${detail ? `: ${detail}` : '.'}`,
      res.status,
    );
  }
  return res;
}

/**
 * The smallest context window the assistant runs in. Its instructions and the database schema take
 * about 9,000 tokens before the first question; at LM Studio's 8,192 default the server silently cut
 * them and each query result, and the model re-ran queries it had already answered, then made up an
 * answer. 32,768 is comfortable.
 */
export const MIN_CONTEXT = 16_384;

/**
 * The context window the model is loaded with, from LM Studio's own API (`/api/v0/models/<id>`).
 * Null where the server has no such endpoint (Ollama and others) or it can't be read: the check is
 * a help, not a gate on servers that don't say.
 */
export async function loadedContext(baseUrl: string, model: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/v1$/, '')}/api/v0/models/${encodeURIComponent(model)}`, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { loaded_context_length?: unknown };
    return typeof body.loaded_context_length === 'number' ? body.loaded_context_length : null;
  } catch (error) {
    if (isAbort(error)) throw error;
    return null;
  }
}

/** Why a loaded window is too small for a prompt of `promptChars`, in words the user can act on; null when it's fine. */
export function contextProblem(loaded: number | null, promptChars: number, model: string): string | null {
  if (loaded === null) return null;
  const promptTokens = Math.ceil(promptChars / 3.5);
  const need = Math.max(MIN_CONTEXT, promptTokens * 2);
  if (loaded >= need) return null;
  const n = (v: number) => v.toLocaleString('en-US');
  return (
    `${model} is loaded with a ${n(loaded)}-token context window, and the assistant's instructions and the ` +
    `database schema alone take about ${n(promptTokens)}. With so little room the server cuts the conversation ` +
    `and the answers can't be trusted. Reload the model with at least ${n(need)} tokens (32,768 recommended): ` +
    `in LM Studio, the model's Context Length setting, or \`lms load ${model} --context-length 32768\`.`
  );
}

const modelsSchema = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });

/** `GET {baseUrl}/models`: the model ids the server offers. */
export async function listModels(baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  const res = await send(baseUrl, '/models', { method: 'GET', signal });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const parsed = modelsSchema.safeParse(body);
  if (!parsed.success) {
    throw new AssistantError(
      'bad-response',
      `${serverLabel(baseUrl)} answered, but not with an OpenAI-compatible model list. Check the address ends in /v1.`,
    );
  }
  return parsed.data.data.map((m) => m.id);
}

/** A part of a user message: text, or an image as a `data:` URL. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | {
      role: 'assistant';
      content: string;
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

/** A tool as the OpenAI API describes one: a name, what it's for, and its arguments' JSON Schema. */
export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface StreamProgress {
  /** The visible answer so far, `<think>` blocks removed. */
  text: string;
  /** The model is reasoning (a `<think>` block or the separate reasoning channel). */
  thinking: boolean;
}

export interface ChatResult {
  text: string;
  /** `length` means the server cut the answer at its token limit. */
  finishReason: string | null;
  /** The tools the model asked to run, if any: the caller runs them and asks again. */
  toolCalls: ToolCall[];
}

/**
 * Tokens per round, reasoning included. No temperature is sent: reasoning models ship tuned sampling
 * (Qwen3.x: 1.0, top_k 20) and a low one sends them into loops that never end. Measured: at 0.2 the
 * local Qwen reasoned for over ten minutes about one upsert. The cap makes a runaway round stop with
 * finish_reason `length`, which the panel reports, instead of spinning forever.
 */
export const MAX_TOKENS = 12_000;

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

/**
 * How hard the model should think this turn, sent as `reasoning_effort` (LM Studio honours it; a
 * server that doesn't know the field ignores it). A lookup gets `none`: measured on the local
 * qwen3.8-27b, it picked the same first query with no reasoning as with full, in half the time, and
 * the reasoning between rounds is what ran simple questions out of rounds. Images keep the model's
 * own default, since reading a business card is where the thinking pays.
 */
export function reasoningFor(messages: ChatMessage[]): ReasoningEffort | undefined {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const hasImage = Array.isArray(lastUser?.content) && lastUser.content.some((p) => p.type === 'image_url');
  return hasImage ? undefined : 'none';
}

/**
 * `POST {baseUrl}/chat/completions` with `stream: true`. Calls `onProgress` as text arrives and
 * resolves with the final answer. Abort through `signal` (Stop); the AbortError propagates.
 */
export async function streamChat(options: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
  onProgress?: (progress: StreamProgress) => void;
}): Promise<ChatResult> {
  const { baseUrl, model, messages, tools, reasoningEffort, signal, onProgress } = options;
  const res = await send(baseUrl, '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: MAX_TOKENS,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    }),
    signal,
  });
  if (!res.body) throw new AssistantError('bad-response', `${serverLabel(baseUrl)} sent no answer.`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sse = createSseParser();
  const collector = createToolCallCollector();
  let raw = '';
  let finishReason: string | null = null;
  let reasoning = false;
  let done = false;
  let ended = false;

  const take = (payloads: string[]) => {
    let changed = false;
    for (const payload of payloads) {
      const chunk = readChunk(payload);
      if (chunk.error) throw new AssistantError('http', `${serverLabel(baseUrl)}: ${chunk.error}`);
      if (chunk.done) {
        done = true;
        break;
      }
      if (chunk.content) {
        raw += chunk.content;
        reasoning = false;
        changed = true;
      } else if (chunk.reasoning && !reasoning) {
        reasoning = true;
        changed = true;
      }
      if (chunk.toolCalls.length) collector.push(chunk.toolCalls);
      if (chunk.finishReason) finishReason = chunk.finishReason;
    }
    if (changed && onProgress) {
      const visible = stripThink(raw);
      onProgress({ text: visible.text.split('<tool_call>')[0] ?? '', thinking: visible.thinking || reasoning });
    }
  };

  // Stop must end the read even when the body stream doesn't error on abort by itself.
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort);
  try {
    while (!done) {
      const next = await reader.read();
      if (signal?.aborted) throw new DOMException('The answer was stopped.', 'AbortError');
      if (next.done) {
        ended = true;
        take(sse.push(decoder.decode()));
        take(sse.end());
        break;
      }
      take(sse.push(decoder.decode(next.value, { stream: true })));
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // After [DONE] or an error the server may keep the socket open: stop reading it.
    if (!ended) void reader.cancel().catch(() => undefined);
  }
  const visible = stripThink(raw).text.trimEnd();
  if (collector.size) return { text: visible, finishReason, toolCalls: collector.calls() };
  // A server without a tool parser for this model leaves the calls in the text.
  const tagged = extractTaggedCalls(visible);
  return { text: tagged.text, finishReason, toolCalls: tagged.calls };
}
