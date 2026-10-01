import { describe, expect, it } from 'vitest';
import { fitWithin } from './images';

describe('images: the size sent to the model', () => {
  it('caps the long side and keeps the aspect', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1000, 3000)).toEqual({ width: 533, height: 1600 });
  });

  it('never enlarges a small image', () => {
    expect(fitWithin(800, 500)).toEqual({ width: 800, height: 500 });
  });
});
