import type { StudyConfig } from './config.js';
import {
  CHECK_FAMILY,
  CHECK_POLARITY,
  type Action,
  type CheckName,
  type CheckResult,
  type Mode,
} from './types.js';

/** Per-answer state the engine needs beyond the scores. Supplied by the caller, never by a model. */
export interface PolicyContext {
  /** True when this is the re-score after a clarify. A re-score can only land on keep or flag. */
  isRescore: boolean;
  /** Clarify prompts already issued in this respondent session. */
  clarifiesUsedInSession: number;
}

export type TriggerLevel = 'clarify' | 'flag' | 'replace';

export interface Trigger {
  check: CheckName;
  level: TriggerLevel;
  score: number;
  confidence: number;
  threshold: number;
  /** How far past the threshold the score is, 0..1. Used to pick the clarify prompt. */
  margin: number;
}

export interface PolicyDecision {
  /** What the caller should act on. Always `keep` in shadow mode. */
  action: Action;
  /** What the policy would do under enforcement. Always logged. */
  recommendedAction: Action;
  mode: Mode;
  clarifyPrompt?: string;
  /** Mean confidence of the checks behind the recommended action (all checks for keep). 0 if none. */
  confidence: number;
  /** Every threshold crossing considered, including those that did not decide the outcome. */
  triggers: Trigger[];
}

function trips(check: CheckName, score: number, threshold: number): boolean {
  return CHECK_POLARITY[check] === 'quality' ? score < threshold : score > threshold;
}

function margin(check: CheckName, score: number, threshold: number): number {
  return CHECK_POLARITY[check] === 'quality' ? threshold - score : score - threshold;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/**
 * The policy engine. Pure and deterministic: scores + study config + context → action.
 * Rule order (docs/PRODUCT.md): replace → flag → clarify → keep.
 */
export function decide(
  results: readonly CheckResult[],
  config: StudyConfig,
  ctx: PolicyContext,
): PolicyDecision {
  const { thresholds, confidenceFloors } = config;
  // De-duplicate by check (first wins) so a misbehaving provider cannot double-count agreement.
  const byCheck = new Map<CheckName, CheckResult>();
  for (const r of results) if (!byCheck.has(r.check)) byCheck.set(r.check, r);

  const replaceTriggers: Trigger[] = [];
  const flagTriggers: Trigger[] = [];
  const clarifyTriggers: Trigger[] = [];

  for (const r of byCheck.values()) {
    const mk = (level: TriggerLevel, threshold: number): Trigger => ({
      check: r.check,
      level,
      score: r.score,
      confidence: r.confidence,
      threshold,
      margin: round(margin(r.check, r.score, threshold)),
    });

    const replaceT = (thresholds.replace.checks ?? thresholds.flag)[r.check];
    if (
      replaceT !== undefined &&
      trips(r.check, r.score, replaceT) &&
      r.confidence > thresholds.replace.minConfidence
    ) {
      replaceTriggers.push(mk('replace', replaceT));
    }

    const flagT = thresholds.flag[r.check];
    if (flagT !== undefined && trips(r.check, r.score, flagT)) {
      if (r.confidence >= confidenceFloors.flag) flagTriggers.push(mk('flag', flagT));
      // Low-confidence flag: resolve one step down.
      else if (r.confidence >= confidenceFloors.clarify) clarifyTriggers.push(mk('clarify', flagT));
    }

    const clarifyT = thresholds.clarify[r.check];
    if (
      clarifyT !== undefined &&
      trips(r.check, r.score, clarifyT) &&
      r.confidence >= confidenceFloors.clarify &&
      !clarifyTriggers.some((t) => t.check === r.check)
    ) {
      clarifyTriggers.push(mk('clarify', clarifyT));
    }
  }

  const clarifyAllowed = !ctx.isRescore && ctx.clarifiesUsedInSession < config.maxClarifyPerSession;

  let recommendedAction: Action;
  let deciding: Trigger[];
  const replaceFamilies = new Set(replaceTriggers.map((t) => CHECK_FAMILY[t.check]));
  if (replaceFamilies.size >= thresholds.replace.requireChecks) {
    // A re-scored answer is capped at flag.
    recommendedAction = ctx.isRescore ? 'flag' : 'replace';
    deciding = replaceTriggers;
  } else if (flagTriggers.length > 0) {
    recommendedAction = 'flag';
    deciding = flagTriggers;
  } else if (clarifyTriggers.length > 0 && clarifyAllowed) {
    recommendedAction = 'clarify';
    deciding = clarifyTriggers;
  } else {
    recommendedAction = 'keep';
    deciding = [];
  }

  const confidence = round(
    deciding.length > 0
      ? mean(deciding.map((t) => t.confidence))
      : mean([...byCheck.values()].map((r) => r.confidence)),
  );

  let clarifyPrompt: string | undefined;
  if (recommendedAction === 'clarify') {
    const ranked = [...clarifyTriggers].sort(
      (a, b) => b.margin - a.margin || a.check.localeCompare(b.check),
    );
    const withPrompt = ranked.find((t) => config.clarifyPrompts[t.check] !== undefined);
    clarifyPrompt =
      (withPrompt && config.clarifyPrompts[withPrompt.check]) ?? config.defaultClarifyPrompt;
  }

  const enforce = config.mode === 'enforce';
  const decision: PolicyDecision = {
    action: enforce ? recommendedAction : 'keep',
    recommendedAction,
    mode: config.mode,
    confidence,
    triggers: [...replaceTriggers, ...flagTriggers, ...clarifyTriggers],
  };
  if (enforce && clarifyPrompt !== undefined) decision.clarifyPrompt = clarifyPrompt;
  return decision;
}
