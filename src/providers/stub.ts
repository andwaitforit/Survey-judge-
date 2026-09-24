import type { CheckName, CheckResult } from '../policy/types.js';
import { clamp01, settleWithin, sleep } from './parallel.js';
import { SCORERS, signals } from './stub-heuristics.js';
import { fnv1a, prng } from './text.js';
import type { CheckRequest, DecisionProvider, ScoreOptions } from './types.js';

export interface StubOptions {
  /** Simulated latency per check (ms). Default 0. */
  latencyMs?: number | Partial<Record<CheckName, number>>;
  /** Checks that reject, for failure-path tests. */
  failChecks?: CheckName[];
}

/**
 * Deterministic provider: scores come from text heuristics, and confidence jitter is seeded from a
 * hash of the answer text, so the same input always gives the same output. Offline; no model.
 */
export class StubProvider implements DecisionProvider {
  readonly name = 'stub';
  readonly modelVersion = 'stub-heuristics-1';

  constructor(private readonly opts: StubOptions = {}) {}

  async scoreBatch(req: CheckRequest, { timeoutMs }: ScoreOptions): Promise<CheckResult[]> {
    const sig = signals(req.state.answerText);
    const checks = [...new Set(req.checks)];
    const settled = await settleWithin(
      checks,
      async (check, signal) => {
        const delay = this.latencyFor(check);
        if (delay > 0) await sleep(delay, signal);
        if (this.opts.failChecks?.includes(check)) throw new Error(`stub: injected failure for ${check}`);
        const rand = prng(fnv1a(`${check}\u0000${req.state.answerText}`));
        const { score, certainty = 1 } = SCORERS[check](req.state, sig);
        // Confidence grows with distance from 0.5, scaled by how much the heuristic trusts itself.
        const jitter = (rand() - 0.5) * 0.06;
        const confidence = clamp01((0.6 + 0.38 * Math.abs(score - 0.5) * 2) * certainty + jitter);
        return { check, score: round(clamp01(score)), confidence: round(confidence) };
      },
      timeoutMs,
    );
    return settled.map((s) => s.value);
  }

  private latencyFor(check: CheckName): number {
    const l = this.opts.latencyMs;
    if (l === undefined) return 0;
    return typeof l === 'number' ? l : (l[check] ?? 0);
  }
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
