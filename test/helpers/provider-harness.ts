import type { CheckName } from '../../src/policy/types.js';
import type { DecisionProvider } from '../../src/providers/types.js';
import { StubProvider } from '../../src/providers/stub.js';
import { LlmProvider } from '../../src/providers/llm.js';
import { JevProvider } from '../../src/providers/jev/provider.js';
import { fakeFetch } from './fake-fetch.js';
import llmFixture from '../fixtures/llm/chat-completion.json' with { type: 'json' };
import jevFixture from '../fixtures/jev/score-answer.json' with { type: 'json' };

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

export const llmHarness: ProviderHarness = {
  name: 'LlmProvider (fake fetch)',
  make: (b = {}) =>
    new LlmProvider({
      baseUrl: 'http://llm.invalid/v1',
      model: 'fixture-small-llm',
      fetch: fakeFetch({
        ...b,
        identify: (body) => {
          const sys = (body as { messages: { content: string }[] }).messages[0]!.content;
          return sys.match(/^Check: (\w+)$/m)![1] as CheckName;
        },
        respond: () => llmFixture,
      }),
    }),
};

export const jevHarness: ProviderHarness = {
  name: 'JevProvider (fake fetch, unverified adapter)',
  make: (b = {}) =>
    new JevProvider({
      baseUrl: 'http://jev.invalid',
      path: '/v1/decisions',
      model: 'jev-fixture',
      fetch: fakeFetch({
        ...b,
        identify: (body) => Object.keys((body as { questions: object }).questions)[0] as CheckName,
        respond: (check) => ({ ...jevFixture, answers: { [check]: jevFixture.answers.__CHECK__ } }),
      }),
    }),
};

export const ALL_HARNESSES = [stubHarness, llmHarness, jevHarness];
