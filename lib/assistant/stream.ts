import { z } from 'zod';

/**
 * Reading an OpenAI-compatible streamed chat completion (`stream: true`): server-sent events whose
 * `data:` lines carry JSON chunks, then `data: [DONE]`.
 */

/**
 * Splits a text stream into `data:` payloads. OpenAI-compatible servers (LM Studio, Ollama,
 * llama.cpp, vLLM) put each JSON chunk on one line, so each `data:` line is one payload; that also
 * copes with servers that skip the blank line between events. Other fields and comments are dropped.
 */
export function createSseParser() {
  let buffer = '';
  const payload = (line: string): string[] => {
    if (!line.startsWith('data:')) return [];
    const value = line.slice(5);
    return [value.startsWith(' ') ? value.slice(1) : value];
  };
  return {
    push(text: string): string[] {
      buffer += text;
      const lines = buffer.split(/\r\n|\n|\r/);
      buffer = lines.pop() ?? '';
      return lines.flatMap(payload);
    },
    /** The last line, when the stream ends without a newline. */
    end(): string[] {
      const rest = buffer;
      buffer = '';
      return payload(rest);
    },
  };
}

const chunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            // LM Studio's name for the reasoning channel; Ollama and others use `reasoning`.
            reasoning_content: z.string().nullish(),
            reasoning: z.string().nullish(),
            tool_calls: z
              .array(
                z.object({
                  index: z.number().int().nonnegative().nullish(),
                  id: z.string().nullish(),
                  function: z
                    .object({ name: z.string().nullish(), arguments: z.string().nullish() })
                    .nullish(),
                }),
              )
              .nullish(),
          })
          .nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .nullish(),
  error: z.union([z.string(), z.object({ message: z.string().nullish() })]).nullish(),
});

export interface StreamChunk {
  /** Answer text in this chunk (reasoning never lands here). */
  content: string;
  /** The model is reasoning on its separate channel: shown as "Thinking…", never as text. */
  reasoning: boolean;
  /** Pieces of tool calls: a call's name and id come once, its arguments in fragments by `index`. */
  toolCalls: ToolCallDelta[];
  finishReason: string | null;
  done: boolean;
  /** The server reported an error mid-stream. */
  error: string | null;
}

export interface ToolCallDelta {
  index: number;
  id: string | null;
  name: string | null;
  arguments: string;
}

const EMPTY: StreamChunk = {
  content: '',
  reasoning: false,
  toolCalls: [],
  finishReason: null,
  done: false,
  error: null,
};

/** One `data:` payload. A line that isn't JSON is skipped rather than failing the answer. */
export function readChunk(payload: string): StreamChunk {
  if (payload.trim() === '[DONE]') return { ...EMPTY, done: true };
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return EMPTY;
  }
  const parsed = chunkSchema.safeParse(json);
  if (!parsed.success) return EMPTY;
  const { choices, error } = parsed.data;
  if (error) {
    const message = typeof error === 'string' ? error : error.message;
    return { ...EMPTY, error: message?.trim() || 'The model server reported an error.' };
  }
  const choice = choices?.[0];
  const delta = choice?.delta;
  return {
    content: delta?.content ?? '',
    reasoning: Boolean(delta?.reasoning_content || delta?.reasoning),
    toolCalls: (delta?.tool_calls ?? []).map((call, i) => ({
      index: call.index ?? i,
      id: call.id ?? null,
      name: call.function?.name ?? null,
      arguments: call.function?.arguments ?? '',
    })),
    finishReason: choice?.finish_reason ?? null,
    done: false,
    error: null,
  };
}

const OPEN = '<think>';
const CLOSE = '</think>';

/** A trailing `<`, `<th`, `</thin`… that may become a tag with the next chunk. */
function partialTagAt(text: string): number {
  const lt = text.lastIndexOf('<');
  if (lt === -1) return -1;
  const tail = text.slice(lt);
  return tail.length < CLOSE.length && (OPEN.startsWith(tail) || CLOSE.startsWith(tail)) ? lt : -1;
}

/**
 * The visible answer in the raw streamed text: `<think>…</think>` blocks removed, including one
 * still streaming. Some chat templates open the block themselves, so the stream starts with the
 * reasoning and only its `</think>` arrives: everything before a close without an open is dropped.
 * Pure over the accumulated text, so it doesn't matter where the chunks split.
 */
export function stripThink(raw: string): { text: string; thinking: boolean } {
  let rest = raw;
  const firstClose = rest.indexOf(CLOSE);
  const firstOpen = rest.indexOf(OPEN);
  if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
    rest = rest.slice(firstClose + CLOSE.length);
  }
  let text = '';
  let thinking = false;
  for (;;) {
    const open = rest.indexOf(OPEN);
    if (open === -1) {
      text += rest;
      break;
    }
    text += rest.slice(0, open);
    const close = rest.indexOf(CLOSE, open + OPEN.length);
    if (close === -1) {
      thinking = true;
      break;
    }
    rest = rest.slice(close + CLOSE.length);
  }
  if (!thinking) {
    const partial = partialTagAt(text);
    if (partial !== -1) text = text.slice(0, partial);
  }
  return { text: text.replace(/^\s+/, ''), thinking };
}

export interface ToolCall {
  id: string;
  name: string;
  /** The raw JSON text the model wrote: parsed and checked by the tool, not here. */
  arguments: string;
}

/** Joins streamed tool-call fragments into whole calls, in the order the model made them. */
export function createToolCallCollector() {
  const calls = new Map<number, { id: string | null; name: string; arguments: string }>();
  return {
    push(deltas: ToolCallDelta[]) {
      for (const d of deltas) {
        const call = calls.get(d.index) ?? { id: null, name: '', arguments: '' };
        if (d.id) call.id = d.id;
        if (d.name) call.name += d.name;
        call.arguments += d.arguments;
        calls.set(d.index, call);
      }
    },
    get size() {
      return calls.size;
    },
    calls(): ToolCall[] {
      return [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .filter(([, c]) => c.name)
        .map(([index, c]) => ({ id: c.id ?? `call_${index}`, name: c.name, arguments: c.arguments || '{}' }));
    },
  };
}

const TAGGED_CALL = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

/**
 * Tool calls a model wrote into its answer as `<tool_call>{"name": …, "arguments": …}</tool_call>`
 * (Qwen's own format) when the server didn't turn them into `tool_calls`. Returns the text without
 * them. A block that isn't a call is left in the text.
 */
export function extractTaggedCalls(text: string): { text: string; calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  const rest = text.replace(TAGGED_CALL, (whole, body: string) => {
    try {
      const json = JSON.parse(body) as { name?: unknown; arguments?: unknown };
      if (typeof json.name !== 'string' || !json.name) return whole;
      const args = typeof json.arguments === 'string' ? json.arguments : JSON.stringify(json.arguments ?? {});
      calls.push({ id: `call_tagged_${calls.length}`, name: json.name, arguments: args });
      return '';
    } catch {
      return whole;
    }
  });
  return { text: calls.length ? rest.trim() : text, calls };
}
