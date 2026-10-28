import { describe, expect, it } from 'vitest';
import { buildPeople, searchPeople } from './people';
import type { CompanyIndex } from './entity-links';
import type { ManualContact } from './types';

const index = {
  byId: new Map([['p', { id: 'p', name: 'Parallax Gaming' }], ['b', { id: 'b', name: 'Betlive' }]]),
  ordered: [], mentions: [],
} as unknown as CompanyIndex;

const desk = (id: string, company_id: string, full_name: string, job_title: string): ManualContact => ({
  id, company_id, full_name, job_title, email: null, phone: null, linkedin_url: null,
  note: null, source: 'manual', is_personal_data: true,
});

describe('people with many roles', () => {
  const manual = [desk('m1', 'p', 'Nikoloz Nadaraia', 'CEO'), desk('m2', 'b', 'Nikoloz Nadaraia', 'Head of Partnerships')];

  it('lists unlinked rows as one person each, as before', () => {
    const people = buildPeople([], manual, index);
    expect(people).toHaveLength(2);
    expect(people.every((p) => p.roles.length === 1 && p.person_id === null)).toBe(true);
  });

  it('groups linked rows into one person with every role', () => {
    const links = [
      { person_id: 'P', contact_id: null, manual_contact_id: 'm1' },
      { person_id: 'P', contact_id: null, manual_contact_id: 'm2' },
    ];
    const people = buildPeople([], manual, index, links, new Map([['P', 'Nikoloz Nadaraia']]));
    expect(people).toHaveLength(1);
    expect(people[0].person_id).toBe('P');
    expect(people[0].roles.map((r) => r.company_name)).toEqual(['Betlive', 'Parallax Gaming']);
  });

  it('finds a person by any of their companies', () => {
    const links = [
      { person_id: 'P', contact_id: null, manual_contact_id: 'm1' },
      { person_id: 'P', contact_id: null, manual_contact_id: 'm2' },
    ];
    const people = buildPeople([], manual, index, links, new Map([['P', 'Nikoloz Nadaraia']]));
    expect(searchPeople(people, 'parallax')).toHaveLength(1);
    expect(searchPeople(people, 'partnerships')).toHaveLength(1);
  });
});
