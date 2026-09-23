import { decide } from '../policy/engine.js';
import type { StudyConfig } from '../policy/config.js';
import { CHECK_NAMES } from '../policy/types.js';
import { runChecks } from '../providers/run.js';
import type { DecisionProvider } from '../providers/types.js';
import type { EvalRow } from './dataset.js';
import {
  biasReport,
  calibration,
  confusionMatrix,
  sweep,
  type Calibration,
  type ConfusionMatrix,
  type Prediction,
  type SweepRow,
} from './metrics.js';

export const DEFAULT_SWEEP = [0, 0.5, 0.6, 0.7, 0.8, 0.9] as const;
const MAX_PEERS = 50;

export interface EvalOptions {
  timeoutMs?: number;
  thresholds?: readonly number[];
  /** Rows scored concurrently. The stub is CPU-bound; real providers benefit from more. */
  concurrency?: number;
}

export interface EvalResult {
  provider: { name: string; modelVersion: string };
  studyId: string;
  n: number;
  predictions: Prediction[];
  confusion: ConfusionMatrix;
  sweep: SweepRow[];
  calibration: Calibration;
  bias: ReturnType<typeof biasReport>;
  providerErrors: number;
  latency: { p50: number; p95: number; max: number };
}

function percentile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
}

/**
 * Replay labelled answers through provider → policy and score the recommended action.
 * The policy runs in enforce mode (a shadow config would make every prediction keep). Each row is
 * a fresh answer: not a re-score, with no clarify budget used.
 */
export async function runEval(
  rows: readonly EvalRow[],
  provider: DecisionProvider,
  config: StudyConfig,
  opts: EvalOptions = {},
): Promise<EvalResult> {
  const timeoutMs = opts.timeoutMs ?? 450;
  const enforced: StudyConfig = { ...config, mode: 'enforce' };
  const byQuestion = new Map<string, EvalRow[]>();
  for (const r of rows) byQuestion.set(r.questionText, [...(byQuestion.get(r.questionText) ?? []), r]);

  const predictions: Prediction[] = new Array(rows.length);
  const latencies: number[] = [];
  let providerErrors = 0;
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const i = next++;
      const row = rows[i]!;
      const peers =
        row.peerAnswers ??
        (byQuestion.get(row.questionText) ?? [])
          .filter((o) => o.id !== row.id)
          .slice(0, MAX_PEERS)
          .map((o) => o.answerText);
      const outcome = await runChecks(
        provider,
        {
          checks: [...CHECK_NAMES],
          state: {
            questionText: row.questionText,
            answerText: row.answerText,
            priorAnswers: row.priorAnswers,
            peerAnswers: peers,
            ...(row.studyContext !== undefined ? { studyContext: row.studyContext } : {}),
          },
        },
        timeoutMs,
      );
      if (outcome.error !== undefined || outcome.results.length === 0) providerErrors++;
      latencies.push(outcome.latencyMs);
      const d = decide(outcome.results, enforced, { isRescore: false, clarifiesUsedInSession: 0 });
      predictions[i] = {
        id: row.id,
        label: row.label,
        predicted: d.recommendedAction,
        confidence: d.confidence,
        attributes: row.attributes,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 8) }, worker));

  return {
    provider: { name: provider.name, modelVersion: provider.modelVersion },
    studyId: config.studyId,
    n: rows.length,
    predictions,
    confusion: confusionMatrix(predictions),
    sweep: sweep(predictions, opts.thresholds ?? DEFAULT_SWEEP),
    calibration: calibration(predictions.map((p) => ({ confidence: p.confidence, correct: p.label === p.predicted }))),
    bias: biasReport(predictions),
    providerErrors,
    latency: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), max: Math.max(0, ...latencies) },
  };
}
