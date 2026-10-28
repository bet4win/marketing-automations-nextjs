import 'server-only';
import { GOOGLE_ENV } from './google';
import { SLACK_ENV } from './slack';
import type { Provider } from './types';

/**
 * The providers this deployment can connect: those whose app credentials are
 * in the environment.
 */
const NEEDS: Partial<Record<Provider, string[]>> = {
  gmail: GOOGLE_ENV,
  slack: SLACK_ENV,
};

export function availableProviders(): Provider[] {
  return (Object.keys(NEEDS) as Provider[])
    .filter((p) => NEEDS[p]!.every((name) => Boolean(process.env[name])));
}
