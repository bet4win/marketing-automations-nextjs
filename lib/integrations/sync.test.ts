import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { ReauthError, failureFor } = await import('./sync');

describe('failureFor', () => {
  it('asks for a reconnect when the provider refused the token', () => {
    expect(failureFor(new ReauthError('invalid_grant'))).toEqual({ status: 'needs_reauth', last_error: 'invalid_grant' });
  });

  it('records anything else as an error, cut to a readable length', () => {
    const out = failureFor(new Error('x'.repeat(900)));
    expect(out.status).toBe('error');
    expect(out.last_error).toHaveLength(500);
  });

  it('copes with a thrown non-error', () => {
    expect(failureFor('boom')).toEqual({ status: 'error', last_error: 'boom' });
  });
});
