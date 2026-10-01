import { describe, expect, it } from 'vitest';
import { createSseParser, createToolCallCollector, extractTaggedCalls, readChunk, stripThink } from './stream';

const delta = (delta: Record<string, unknown>, finish: string | null = null) =>
  JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] });

/** Feeds `text` to a parser in pieces of `size` characters. */
function payloadsOf(text: string, size: number): string[] {
  const sse = createSseParser();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(...sse.push(text.slice(i, i + size)));
  out.push(...sse.end());
  return out;
}

/** The visible answer after each of `chunks`, as the panel would show it. */
function visibleAfter(chunks: string[]) {
  let raw = '';
  return chunks.map((chunk) => stripThink((raw += chunk)));
}

describe('SSE: data lines', () => {
  const stream = [
    ': keep-alive',
    'event: message',
    `data: ${delta({ role: 'assistant', content: '' })}`,
    '',
    `data:${delta({ content: 'Hello' })}`,
    '',
    `data: ${delta({ content: ' world' })}`,
    'id: 3',
    '',
    'data: [DONE]',
    '',
  ].join('\n');

  it('yields each data payload and skips comments and other fields', () => {
    expect(payloadsOf(stream, stream.length)).toEqual([
      delta({ role: 'assistant', content: '' }),
      delta({ content: 'Hello' }),
      delta({ content: ' world' }),
      '[DONE]',
    ]);
  });

  it.each([1, 2, 3, 7, 16, 64])('gives the same payloads when chunks split lines every %i characters', (size) => {
    expect(payloadsOf(stream, size)).toEqual(payloadsOf(stream, stream.length));
  });

  it('handles CRLF and a last line without a newline', () => {
    const crlf = `data: ${delta({ content: 'a' })}\r\n\r\ndata: [DONE]`;
    expect(payloadsOf(crlf, 5)).toEqual([delta({ content: 'a' }), '[DONE]']);
  });

  it('copes with servers that skip the blank line between events', () => {
    const tight = `data: ${delta({ content: 'a' })}\ndata: ${delta({ content: 'b' })}\n`;
    expect(payloadsOf(tight, 4)).toEqual([delta({ content: 'a' }), delta({ content: 'b' })]);
  });
});

describe('SSE: chunks', () => {
  it('takes choices[0].delta.content', () => {
    expect(readChunk(delta({ content: 'Hi' }))).toEqual({
      content: 'Hi',
      reasoning: false,
      toolCalls: [],
      finishReason: null,
      done: false,
      error: null,
    });
  });

  it('never takes reasoning as answer text, only as a sign of thinking', () => {
    expect(readChunk(delta({ reasoning_content: 'The user wants' }))).toMatchObject({ content: '', reasoning: true });
    expect(readChunk(delta({ reasoning: 'Hmm' }))).toMatchObject({ content: '', reasoning: true });
    expect(readChunk(delta({ content: 'OK', reasoning_content: 'secret plan' })).content).toBe('OK');
  });

  it('reads the finish reason, [DONE] and errors', () => {
    expect(readChunk(delta({}, 'length')).finishReason).toBe('length');
    expect(readChunk('[DONE]').done).toBe(true);
    expect(readChunk(JSON.stringify({ error: { message: 'Model unloaded' } })).error).toBe('Model unloaded');
    expect(readChunk(JSON.stringify({ error: 'boom' })).error).toBe('boom');
    expect(readChunk(JSON.stringify({ error: {} })).error).toBe('The model server reported an error.');
  });

  it('skips a payload that is not a chunk', () => {
    for (const payload of ['not json', '42', JSON.stringify({ choices: 'x' }), JSON.stringify({ choices: [] })]) {
      expect(readChunk(payload)).toMatchObject({ content: '', done: false, error: null });
    }
  });
});

describe('<think> stripping', () => {
  it('removes a whole block and the space after it', () => {
    expect(stripThink('<think>Let me see.</think>\n\n## Summary\nGGR is up.')).toEqual({
      text: '## Summary\nGGR is up.',
      thinking: false,
    });
  });

  it('hides a block that is still streaming, and says the model is thinking', () => {
    expect(stripThink('<think>The user wants')).toEqual({ text: '', thinking: true });
    expect(stripThink('Intro. <think>more')).toEqual({ text: 'Intro. ', thinking: true });
  });

  it('removes every block', () => {
    expect(stripThink('A<think>x</think>B<think>y</think>C').text).toBe('ABC');
  });

  it('drops reasoning when the template opened the block itself (only the close arrives)', () => {
    expect(stripThink('The user wants a summary.</think>\n\nGGR is up.').text).toBe('GGR is up.');
  });

  it('holds back a tag that is still arriving, and keeps a plain "<"', () => {
    expect(stripThink('Answer <thi')).toEqual({ text: 'Answer ', thinking: false });
    expect(stripThink('Reasoning </thin')).toEqual({ text: 'Reasoning ', thinking: false });
    expect(stripThink('RTP < 95%').text).toBe('RTP < 95%');
    expect(stripThink('a <b> c').text).toBe('a <b> c');
  });

  const answer = '<think>Check GGR first.\nThen RTP.</think>\n\n## Summary\nGGR rose 4.9%.';

  it.each([1, 2, 3, 5, 8, 13])('never shows reasoning when the stream splits every %i characters', (size) => {
    const chunks: string[] = [];
    for (let i = 0; i < answer.length; i += size) chunks.push(answer.slice(i, i + size));
    const views = visibleAfter(chunks);
    for (const view of views) {
      expect(view.text).not.toMatch(/Check GGR|Then RTP|<|think/);
      expect('## Summary\nGGR rose 4.9%.'.startsWith(view.text)).toBe(true);
    }
    expect(views[views.length - 1]).toEqual({ text: '## Summary\nGGR rose 4.9%.', thinking: false });
    expect(views.some((v) => v.thinking)).toBe(true);
  });

  it('splits the tags themselves across chunks', () => {
    expect(visibleAfter(['<th', 'ink>plan</thi', 'nk>Done']).map((v) => v.text)).toEqual(['', '', 'Done']);
    expect(visibleAfter(['plan</', 'think>', 'Answer']).map((v) => v.text)).toEqual(['plan', '', 'Answer']);
  });
});

describe('tool calls', () => {
  it('joins fragments streamed by index into whole calls', () => {
    const collector = createToolCallCollector();
    const pieces = [
      delta({ tool_calls: [{ index: 0, id: 'a', type: 'function', function: { name: 'query', arguments: '' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{"from":' } }] }),
      delta({ tool_calls: [{ index: 1, id: 'b', function: { name: 'query', arguments: '{}' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '"companies"}' } }] }),
    ];
    for (const p of pieces) collector.push(readChunk(p).toolCalls);
    expect(collector.calls()).toEqual([
      { id: 'a', name: 'query', arguments: '{"from":"companies"}' },
      { id: 'b', name: 'query', arguments: '{}' },
    ]);
  });

  it('gives a call without an id one, and drops a fragment that never got a name', () => {
    const collector = createToolCallCollector();
    collector.push([{ index: 0, id: null, name: 'query', arguments: '' }]);
    collector.push([{ index: 3, id: null, name: null, arguments: '{"x":1}' }]);
    expect(collector.calls()).toEqual([{ id: 'call_0', name: 'query', arguments: '{}' }]);
  });

  it('reads calls written into the text as <tool_call> blocks', () => {
    const text = 'Looking.\n<tool_call>\n{"name": "query", "arguments": {"from": "events"}}\n</tool_call>';
    expect(extractTaggedCalls(text)).toEqual({
      text: 'Looking.',
      calls: [{ id: 'call_tagged_0', name: 'query', arguments: '{"from":"events"}' }],
    });
    expect(extractTaggedCalls('<tool_call>not json</tool_call>').calls).toEqual([]);
  });
});
