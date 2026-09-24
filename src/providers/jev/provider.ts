import { defaultFetch } from '../http.js';
import type { CheckResult } from '../../policy/types.js';
import { clamp01, settleWithin } from '../parallel.js';
import { rubric } from '../prompts.js';
import type { CheckRequest, DecisionProvider, FetchLike, ScoreOptions } from '../types.js';
import { JevResponseSchema, toJevRequest, toUnitScore } from './adapter.js';

export interface JevProviderOptions {
  /** Required. No default: we do not claim to know the real endpoint. TODO(jev-api) */
  baseUrl: string;
  /** Required. TODO(jev-api) */
  path: string;
  model: string;
  apiKey?: string;
  fetch?: FetchLike;
}

/**
 * Jev behind DecisionProvider. TODO(jev-api): the wire format is unconfirmed; see ./adapter.ts.
 * It sends one request per check in parallel, so a slow check cannot hold the others past the
 * deadline (partial results). The cost: 8 requests per answer instead of 1. Revisit once the real
 * API's latency and pricing are known.
 */
export class JevProvider implements DecisionProvider {
  readonly name = 'jev';
  readonly modelVersion: string;
  private readonly fetch: FetchLike;

  constructor(private readonly opts: JevProviderOptions) {
    this.modelVersion = `${opts.model} (unverified adapter)`;
    this.fetch = opts.fetch ?? defaultFetch;
  }

  async scoreBatch(req: CheckRequest, { timeoutMs }: ScoreOptions): Promise<CheckResult[]> {
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}/${this.opts.path.replace(/^\//, '')}`;
    const settled = await settleWithin(
      [...new Set(req.checks)],
      async (check, signal) => {
        const res = await this.fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
          },
          body: JSON.stringify(toJevRequest(this.opts.model, check, req.state)),
          signal,
        });
        if (!res.ok) throw new Error(`jev: HTTP ${res.status}`);
        const body = JevResponseSchema.parse(await res.json());
        const answer = body.answers[check];
        if (!answer) throw new Error(`jev: no answer for ${check}`);
        return {
          check,
          score: toUnitScore(answer, rubric(check).length),
          // TODO(jev-api): third-party sources say Jev confidence is calibrated. Verify it with the eval harness.
          confidence: clamp01(answer.confidence ?? 0),
        };
      },
      timeoutMs,
    );
    return settled.map((s) => s.value);
  }
}
