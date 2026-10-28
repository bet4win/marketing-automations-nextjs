import { describe, expect, it } from 'vitest';
import { canMerge, defaultKeeper, defaultRowKeeper, MERGE_MAX, nameChoices } from './merge';
import type { PersonRole } from './types';

describe('merge rules', () => {
  it('needs two to ten rows', () => {
    expect(canMerge(1)).toBe(false);
    expect(canMerge(2)).toBe(true);
    expect(canMerge(MERGE_MAX)).toBe(true);
    expect(canMerge(MERGE_MAX + 1)).toBe(false);
  });

  it('keeps the company holding the most, and the first on a tie', () => {
    const w = (id: string, people: number, stands = 0) =>
      ({ id, name: id, people, stands, events: 0, hasState: false });
    expect(defaultKeeper([w('a', 1), w('b', 5), w('c', 2)])).toBe('b');
    expect(defaultKeeper([w('a', 1, 1), w('b', 2)])).toBe('a');
  });

  it('offers each distinct name once, in order', () => {
    expect(nameChoices(['Upgaming', ' Upgaming ', null, 'UpGaming'])).toEqual(['Upgaming', 'UpGaming']);
  });

  it('keeps the fullest row', () => {
    const r = (id: string, extra: Partial<PersonRole>) => ({
      id, company_id: 'c', company_name: 'C', kind: 'person', full_name: 'X', job_title: null,
      email: null, phone: null, linkedin_url: null, attribution: null, source_url: null,
      is_personal_data: true, origin: 'entered', ...extra,
    }) as PersonRole;
    expect(defaultRowKeeper([r('a', {}), r('b', { email: 'x@y.z', job_title: 'CEO' })])).toBe('b');
  });
});
