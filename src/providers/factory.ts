import { JevProvider } from './jev/provider.js';
import { LlmProvider } from './llm.js';
import { StubProvider } from './stub.js';
import type { DecisionProvider } from './types.js';

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`missing environment variable ${key}`);
  return v;
}

/** Build a provider by name from environment configuration. */
export function createProvider(name: string, env: NodeJS.ProcessEnv): DecisionProvider {
  switch (name) {
    case 'stub':
      return new StubProvider();
    case 'llm':
      return new LlmProvider({
        baseUrl: required(env, 'LLM_BASE_URL'),
        model: required(env, 'LLM_MODEL'),
        ...(env.LLM_API_KEY ? { apiKey: env.LLM_API_KEY } : {}),
        jsonMode: env.LLM_JSON_MODE === '1',
      });
    case 'jev':
      // TODO(jev-api): unverified adapter. There is no default endpoint on purpose.
      return new JevProvider({
        baseUrl: required(env, 'JEV_BASE_URL'),
        path: required(env, 'JEV_PATH'),
        model: required(env, 'JEV_MODEL'),
        ...(env.JEV_API_KEY ? { apiKey: env.JEV_API_KEY } : {}),
      });
    default:
      throw new Error(`unknown provider "${name}" (available: stub, llm, jev)`);
  }
}
