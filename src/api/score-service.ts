import type { FastifyBaseLogger } from 'fastify';
import { parseStudyConfig, type StudyConfig } from '../policy/config.js';
import { decide } from '../policy/engine.js';
import { CHECK_NAMES } from '../policy/types.js';
import { runChecks } from '../providers/run.js';
import type { DecisionProvider } from '../providers/types.js';
import { newDecisionId } from '../store/keys.js';
import type { CheckScores, Customer, SessionState, Store } from '../store/types.js';
import type { ScoreRequest, ScoreResponse } from './schemas.js';

/** Used when a study has no stored config: shadow mode with the PRODUCT.md example thresholds. Version 0. */
export function defaultStudyConfig(studyId: string): StudyConfig {
  return parseStudyConfig({ studyId });
}

export interface ScoreDeps {
  store: Store;
  provider: DecisionProvider;
  log: FastifyBaseLogger;
  now?: () => number;
}

export interface ScoreOptions {
  /** Total time budget for this request, including store reads and the log write. */
  budgetMs: number;
  peerSampleSize?: number;
}

/** Time reserved for the policy and the decision log write after the provider returns. */
const TAIL_RESERVE_MS = 40;
/** Time allowed for the pre-provider store reads before they are skipped. */
const PRELUDE_MAX_MS = 60;

async function within<T>(p: Promise<T>, ms: number, fallback: T, onFail: (e: unknown) => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } catch (err) {
    onFail(err);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Score one answer. It fails open at every step: a store or provider problem degrades toward keep
 * and is logged. It never throws for operational failures. Every decision is written to the log.
 */
export async function scoreAnswer(
  deps: ScoreDeps,
  customer: Customer,
  req: ScoreRequest,
  opts: ScoreOptions,
): Promise<ScoreResponse> {
  const now = deps.now ?? (() => performance.now());
  const start = now();
  const log = deps.log.child({ studyId: req.studyId, sessionId: req.sessionId, questionId: req.questionId });
  const warn = (what: string) => (err: unknown) =>
    log.warn({ err: err instanceof Error ? err.message : String(err) }, `${what} failed; failing open`);

  const [versioned, session, peers] = await Promise.all([
    within(deps.store.configs.latest(customer.id, req.studyId), PRELUDE_MAX_MS, null, warn('config read')),
    within(
      deps.store.decisions.sessionState(customer.id, req.studyId, req.sessionId, req.questionId),
      PRELUDE_MAX_MS,
      // If we cannot see the session, assume the clarify budget is spent: fail toward keep.
      { clarifiesUsedInSession: Number.MAX_SAFE_INTEGER, questionAlreadyClarified: true } satisfies SessionState,
      warn('session read'),
    ),
    within(
      deps.store.decisions.recentAnswers(customer.id, req.studyId, req.questionId, req.sessionId, opts.peerSampleSize ?? 50),
      PRELUDE_MAX_MS,
      [] as string[],
      warn('peer sample read'),
    ),
  ]);
  const config = versioned?.config ?? defaultStudyConfig(req.studyId);
  const configVersion = versioned?.version ?? 0;

  const providerBudget = Math.max(50, opts.budgetMs - (now() - start) - TAIL_RESERVE_MS);
  const outcome = await runChecks(
    deps.provider,
    {
      checks: [...CHECK_NAMES],
      state: {
        questionText: req.questionText,
        answerText: req.answerText,
        priorAnswers: req.priorAnswers.map((p) => ({ question: p.questionText ?? p.questionId, answer: p.answer })),
        peerAnswers: peers,
      },
    },
    providerBudget,
  );
  if (outcome.error !== undefined || outcome.missing.length > 0) {
    log.warn(
      { provider: deps.provider.name, error: outcome.error, missing: outcome.missing, providerLatencyMs: outcome.latencyMs },
      'provider degraded; failing open on missing checks',
    );
  }

  const decision = decide(outcome.results, config, {
    isRescore: session.questionAlreadyClarified,
    clarifiesUsedInSession: session.clarifiesUsedInSession,
  });

  const checks: CheckScores = {};
  for (const r of outcome.results) checks[r.check] = { score: r.score, confidence: r.confidence };
  const decisionId = newDecisionId();
  const latencyMs = Math.round(now() - start);

  await within(
    deps.store.decisions.append({
      decisionId,
      customerId: customer.id,
      studyId: req.studyId,
      sessionId: req.sessionId,
      questionId: req.questionId,
      answerText: req.answerText,
      provider: deps.provider.name,
      modelVersion: deps.provider.modelVersion,
      configVersion,
      checks,
      confidence: decision.confidence,
      action: decision.action,
      recommendedAction: decision.recommendedAction,
      mode: decision.mode,
      latencyMs,
      clarified: session.questionAlreadyClarified,
      providerError: outcome.error ?? null,
      missingChecks: outcome.missing,
      finalOutcome: null,
      createdAt: new Date(),
    }),
    Math.max(TAIL_RESERVE_MS, opts.budgetMs - (now() - start)),
    undefined,
    (err) => log.error({ err: err instanceof Error ? err.message : String(err), decisionId }, 'decision log write failed'),
  );

  const response: ScoreResponse = {
    decisionId,
    action: decision.action,
    checks: Object.fromEntries(outcome.results.map((r) => [r.check, r.score])),
    confidence: decision.confidence,
    mode: decision.mode,
    recommendedAction: decision.recommendedAction,
    configVersion,
    degraded: outcome.error !== undefined || outcome.missing.length > 0,
    latencyMs: Math.round(now() - start),
  };
  if (decision.clarifyPrompt !== undefined) response.clarifyPrompt = decision.clarifyPrompt;
  return response;
}
