import { describe, expect, it } from 'vitest';
import { answerOpenCalls } from './history';

describe('history', () => {
  it('answers tool calls left without a result, so the next request is valid', () => {
    const call = (id: string) => ({ id, type: 'function' as const, function: { name: 'query', arguments: '{}' } });
    const out = answerOpenCalls(
      [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', tool_calls: [call('a'), call('b')] },
        { role: 'tool', tool_call_id: 'a', content: 'rows' },
      ],
      'Stopped by the user.',
    );
    expect(out.slice(3)).toEqual([{ role: 'tool', tool_call_id: 'b', content: 'Stopped by the user.' }]);
  });
});
