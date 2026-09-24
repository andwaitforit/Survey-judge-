import { readEnv } from '../env.js';
import { JevProvider } from './jev/provider.js';
import { LlmProvider } from './llm.js';
import { StubProvider } from './stub.js';
import type { DecisionProvider } from './types.js';

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = readEnv(env, key);
  if (!v) throw new Error(`missing environment variable ${key}`);
  return v;
}

/** Build a provider by name from environment configuration. An empty name means the stub. */
export function createProvider(name: string | undefined, env: NodeJS.ProcessEnv): DecisionProvider {
  switch (name?.trim() || 'stub') {
    case 'stub':
      return new StubProvider();
    case 'llm':
      return new LlmProvider({
        baseUrl: required(env, 'LLM_BASE_URL'),
        model: required(env, 'LLM_MODEL'),
        ...(readEnv(env, 'LLM_API_KEY') ? { apiKey: readEnv(env, 'LLM_API_KEY')! } : {}),
        jsonMode: readEnv(env, 'LLM_JSON_MODE') === '1',
      });
    case 'jev':
      // TODO(jev-api): unverified adapter. There is no default endpoint on purpose.
      return new JevProvider({
        baseUrl: required(env, 'JEV_BASE_URL'),
        path: required(env, 'JEV_PATH'),
        model: required(env, 'JEV_MODEL'),
        ...(readEnv(env, 'JEV_API_KEY') ? { apiKey: readEnv(env, 'JEV_API_KEY')! } : {}),
      });
    default:
      throw new Error(`unknown provider "${name}" (available: stub, llm, jev)`);
  }
}
