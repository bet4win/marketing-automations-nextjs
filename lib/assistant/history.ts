import type { ChatMessage } from './client';

/** Every tool call must have an answer before the next request, or the server rejects the history. */
export function answerOpenCalls(history: ChatMessage[], content: string): ChatMessage[] {
  const answered = new Set(history.flatMap((m) => (m.role === 'tool' ? [m.tool_call_id] : [])));
  const open = history.flatMap((m) =>
    m.role === 'assistant' ? (m.tool_calls ?? []).filter((c) => !answered.has(c.id)) : [],
  );
  return [...history, ...open.map((c): ChatMessage => ({ role: 'tool', tool_call_id: c.id, content }))];
}
