import { StubProvider } from './stub.js';
import type { DecisionProvider } from './types.js';

/** Build a provider by name from environment configuration. */
export function createProvider(name: string, _env: NodeJS.ProcessEnv): DecisionProvider {
  switch (name) {
    case 'stub':
      return new StubProvider();
    default:
      throw new Error(`unknown provider "${name}" (available: stub)`);
  }
}
