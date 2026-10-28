import { describe, expect, it } from 'vitest';
import { furthestStage } from './domain';

describe('furthestStage', () => {
  it('is null without deals', () => {
    expect(furthestStage([])).toBeNull();
  });

  it('takes the furthest open stage', () => {
    expect(furthestStage([{ stage: 'exploring' }, { stage: 'integrating' }, { stage: 'negotiating' }])).toBe('integrating');
  });

  it('ranks lost below every open stage', () => {
    expect(furthestStage([{ stage: 'lost' }, { stage: 'exploring' }])).toBe('exploring');
    expect(furthestStage([{ stage: 'lost' }])).toBe('lost');
  });
});
