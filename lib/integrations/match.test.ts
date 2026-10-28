import { describe, expect, it } from 'vitest';
import { buildEmailIndex, matchEmail, normaliseDomain } from './match';

const index = buildEmailIndex(
  [
    { email: 'Natalya@Softswiss.com', company_id: 'softswiss' },
    { email: 'founder@gmail.com', company_id: 'tiny-studio' },
  ],
  [
    { domain: 'https://www.softswiss.com/', company_id: 'softswiss' },
    { domain: 'revolver.games', company_id: 'revolver' },
    { domain: 'shared.io', company_id: 'a' },
    { domain: 'shared.io', company_id: 'b' },
    { domain: 'gmail.com', company_id: 'listed-gmail' },
  ],
);

describe('normaliseDomain', () => {
  it('strips scheme, www, path and case', () => {
    expect(normaliseDomain('https://www.Example.com/about?x=1')).toBe('example.com');
  });

  it('is null without a dotted host', () => {
    expect(normaliseDomain('')).toBeNull();
    expect(normaliseDomain('localhost')).toBeNull();
    expect(normaliseDomain(null)).toBeNull();
  });
});

describe('matchEmail', () => {
  it('prefers an exact address, case-insensitively', () => {
    expect(matchEmail(' natalya@SOFTSWISS.com', index)).toEqual({ companyId: 'softswiss', by: 'address' });
  });

  it('matches a known free-mail address exactly, but never its domain', () => {
    expect(matchEmail('founder@gmail.com', index)).toEqual({ companyId: 'tiny-studio', by: 'address' });
    expect(matchEmail('someone@gmail.com', index)).toBeNull();
  });

  it('matches by domain, walking up subdomains', () => {
    expect(matchEmail('bd@revolver.games', index)).toEqual({ companyId: 'revolver', by: 'domain' });
    expect(matchEmail('bd@mail.eu.revolver.games', index)).toEqual({ companyId: 'revolver', by: 'domain' });
  });

  it('refuses a domain two companies claim', () => {
    expect(matchEmail('x@shared.io', index)).toBeNull();
  });

  it('does not match an unknown domain or a bare suffix', () => {
    expect(matchEmail('x@unknown.games', index)).toBeNull();
    expect(matchEmail('x@games', index)).toBeNull();
  });
});
