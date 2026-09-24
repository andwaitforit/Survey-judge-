import { z } from 'zod';
import { CHECK_NAMES, type CheckName, type CheckResult } from '../policy/types.js';
import type { CheckRequest, DecisionProvider } from './types.js';

const CheckResultSchema = z.object({
  check: z.enum(CHECK_NAMES),
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

export interface RunOutcome {
  results: CheckResult[];
  /** Requested checks with no valid result (timeout, error, or malformed output). */
  missing: CheckName[];
  /** Set when the provider threw, timed out as a whole, or returned malformed entries. */
  error?: string;
  latencyMs: number;
}

/** Extra time allowed past the provider deadline before the hard cut-off. */
export const HARD_TIMEOUT_GRACE_MS = 25;

/**
 * The only way the rest of the system calls a provider. It never throws and never runs past
 * `timeoutMs + grace`. It validates every result and drops anything malformed, duplicated or
 * unrequested. On total failure it returns zero results, and the policy engine resolves that to
 * keep. Failing open is the point: a model problem must never block a survey.
 */
export async function runChecks(
  provider: DecisionProvider,
  req: CheckRequest,
  timeoutMs: number,
  now: () => number = () => performance.now(),
): Promise<RunOutcome> {
  const start = now();
  const requested = new Set(req.checks);
  let raw: unknown;
  let error: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    raw = await Promise.race([
      provider.scoreBatch(req, { timeoutMs }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`provider ${provider.name} exceeded hard timeout ${timeoutMs}ms`)),
          timeoutMs + HARD_TIMEOUT_GRACE_MS,
        );
      }),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    raw = [];
  } finally {
    if (timer) clearTimeout(timer);
  }

  const results: CheckResult[] = [];
  const seen = new Set<CheckName>();
  let malformed = 0;
  for (const item of Array.isArray(raw) ? raw : []) {
    const parsed = CheckResultSchema.safeParse(item);
    if (!parsed.success || !requested.has(parsed.data.check) || seen.has(parsed.data.check)) {
      malformed++;
      continue;
    }
    seen.add(parsed.data.check);
    results.push(parsed.data);
  }
  if (!Array.isArray(raw) && error === undefined) error = 'provider returned a non-array';
  if (malformed > 0 && error === undefined) error = `dropped ${malformed} malformed result(s)`;

  const outcome: RunOutcome = {
    results,
    missing: [...requested].filter((c) => !seen.has(c)),
    latencyMs: Math.round(now() - start),
  };
  if (error !== undefined) outcome.error = error;
  return outcome;
}
