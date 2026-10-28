import { describe, expect, it } from 'vitest';
import { contextProblem, reasoningFor, type ChatMessage } from './client';

describe('reasoningFor', () => {
  it('turns reasoning off for a lookup, tool rounds included', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: "When's the next follow-up?" },
      { role: 'assistant', content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'query', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: '1', content: '1 rows' },
    ];
    expect(reasoningFor(messages)).toBe('none');
  });

  it("leaves the model's default when the latest question carries images", () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'An earlier question' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Add these business cards.' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
        ],
      },
    ];
    expect(reasoningFor(messages)).toBeUndefined();
  });
});

describe('contextProblem', () => {
  it("says nothing when the server doesn't report a window, or it's big enough", () => {
    expect(contextProblem(null, 40_000, 'qwen')).toBeNull();
    expect(contextProblem(32_768, 40_000, 'qwen')).toBeNull();
  });

  it('explains a window too small for the prompt, with how to fix it', () => {
    const problem = contextProblem(8_192, 32_000, 'qwen/qwen3.8-27b');
    expect(problem).toContain('8,192-token context window');
    expect(problem).toContain('lms load qwen/qwen3.8-27b --context-length 32768');
  });

  it('asks for twice the prompt when that is more than the floor', () => {
    expect(contextProblem(20_000, 70_000, 'm')).toContain('at least 40,000 tokens');
  });
});
