import type { CheckName } from '../../src/policy/types.js';
import type { DecisionProvider } from '../../src/providers/types.js';
import { StubProvider } from '../../src/providers/stub.js';

/** How a harness should make its provider misbehave. Each provider fakes this in its own way. */
export interface Behaviour {
  /** Checks that respond after `slowMs`. */
  slow?: CheckName[];
  slowMs?: number;
  /** Checks that error. */
  fail?: CheckName[];
}

export interface ProviderHarness {
  name: string;
  make(b?: Behaviour): DecisionProvider;
}

const perCheck = (checks: CheckName[] | undefined, ms: number) =>
  Object.fromEntries((checks ?? []).map((c) => [c, ms])) as Partial<Record<CheckName, number>>;

export const stubHarness: ProviderHarness = {
  name: 'StubProvider',
  make: (b = {}) =>
    new StubProvider({ latencyMs: perCheck(b.slow, b.slowMs ?? 1000), failChecks: b.fail ?? [] }),
};
