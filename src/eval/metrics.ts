import { ACTIONS, type Action } from '../policy/types.js';

export interface Prediction {
  id: string;
  label: Action;
  predicted: Action;
  /** Confidence of the policy decision (PolicyDecision.confidence). */
  confidence: number;
  attributes: Record<string, string>;
}

export interface BinaryMetrics {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** null when undefined (no predicted positives). Never NaN. */
  precision: number | null;
  recall: number | null;
  fpr: number | null;
}

const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);

export function binaryMetrics(truth: readonly boolean[], pred: readonly boolean[]): BinaryMetrics {
  if (truth.length !== pred.length) throw new Error('binaryMetrics: length mismatch');
  let tp = 0, fp = 0, fn = 0, tn = 0;
  truth.forEach((t, i) => {
    const y = pred[i];
    if (t && y) tp++;
    else if (!t && y) fp++;
    else if (t && !y) fn++;
    else tn++;
  });
  return { tp, fp, fn, tn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), fpr: ratio(fp, fp + tn) };
}

export type ConfusionMatrix = Record<Action, Record<Action, number>>;

/** Rows are labels, columns are predictions. */
export function confusionMatrix(preds: readonly Prediction[]): ConfusionMatrix {
  const cm = Object.fromEntries(
    ACTIONS.map((l) => [l, Object.fromEntries(ACTIONS.map((p) => [p, 0]))]),
  ) as ConfusionMatrix;
  for (const p of preds) cm[p.label][p.predicted]++;
  return cm;
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  meanConfidence: number | null;
  accuracy: number | null;
}

export interface Calibration {
  bins: CalibrationBin[];
  /** Expected calibration error: Σ (n_b / N) · |accuracy_b − confidence_b|. */
  ece: number;
}

export function calibration(
  points: readonly { confidence: number; correct: boolean }[],
  nBins = 5,
): Calibration {
  const acc = Array.from({ length: nBins }, () => ({ n: 0, conf: 0, correct: 0 }));
  for (const p of points) {
    const idx = Math.min(nBins - 1, Math.max(0, Math.floor(p.confidence * nBins)));
    const b = acc[idx]!;
    b.n++;
    b.conf += p.confidence;
    if (p.correct) b.correct++;
  }
  const N = points.length;
  let ece = 0;
  const bins = acc.map((b, i) => {
    const meanConfidence = b.n ? b.conf / b.n : null;
    const accuracy = b.n ? b.correct / b.n : null;
    if (b.n && meanConfidence !== null && accuracy !== null) ece += (b.n / N) * Math.abs(accuracy - meanConfidence);
    return { lo: i / nBins, hi: (i + 1) / nBins, n: b.n, meanConfidence, accuracy };
  });
  return { bins, ece };
}

export interface SweepRow {
  /** Interventions with decision confidence below this are dropped to keep. */
  threshold: number;
  /** "Any intervention" (predicted ≠ keep) vs "label ≠ keep". */
  intervention: BinaryMetrics;
  perAction: Record<Exclude<Action, 'keep'>, BinaryMetrics>;
  /** Share of answers intervened on. */
  coverage: number;
  /** Mean confidence of retained interventions. */
  meanInterventionConfidence: number | null;
  /** meanInterventionConfidence − exact-action accuracy of retained interventions. >0 is overconfident. */
  calibrationGap: number | null;
  /** Answers labelled keep that were recommended for replace: the expensive error. */
  keepLabelledReplaced: number;
}

export function applyThreshold(p: Prediction, threshold: number): Action {
  return p.predicted !== 'keep' && p.confidence < threshold ? 'keep' : p.predicted;
}

export function sweep(preds: readonly Prediction[], thresholds: readonly number[]): SweepRow[] {
  return thresholds.map((threshold) => {
    const y = preds.map((p) => applyThreshold(p, threshold));
    const truth = preds.map((p) => p.label !== 'keep');
    const perAction = Object.fromEntries(
      (['clarify', 'flag', 'replace'] as const).map((a) => [
        a,
        binaryMetrics(preds.map((p) => p.label === a), y.map((v) => v === a)),
      ]),
    ) as SweepRow['perAction'];
    const retained = preds.filter((_, i) => y[i] !== 'keep');
    const meanConf = retained.length ? retained.reduce((s, p) => s + p.confidence, 0) / retained.length : null;
    const exact = retained.length ? retained.filter((p) => p.label === p.predicted).length / retained.length : null;
    return {
      threshold,
      intervention: binaryMetrics(truth, y.map((v) => v !== 'keep')),
      perAction,
      coverage: preds.length ? retained.length / preds.length : 0,
      meanInterventionConfidence: meanConf,
      calibrationGap: meanConf !== null && exact !== null ? meanConf - exact : null,
      keepLabelledReplaced: preds.filter((p, i) => p.label === 'keep' && y[i] === 'replace').length,
    };
  });
}

export type ActionRates = Record<Action, number>;

export interface GroupRates {
  attribute: string;
  group: string;
  n: number;
  rates: ActionRates;
}

export interface BiasWarning {
  attribute: string;
  group: string;
  n: number;
  replaceRate: number;
  overallReplaceRate: number;
  ratio: number;
}

/** From docs/PRODUCT.md: warn when a group's replace rate is more than 1.5x the overall rate. */
export const BIAS_RATIO_LIMIT = 1.5;

function rates(preds: readonly Prediction[]): ActionRates {
  const r = Object.fromEntries(ACTIONS.map((a) => [a, 0])) as ActionRates;
  for (const p of preds) r[p.predicted]++;
  for (const a of ACTIONS) r[a] = preds.length ? r[a] / preds.length : 0;
  return r;
}

export function biasReport(preds: readonly Prediction[]): {
  overall: ActionRates;
  groups: GroupRates[];
  warnings: BiasWarning[];
} {
  const overall = rates(preds);
  const buckets = new Map<string, { attribute: string; group: string; preds: Prediction[] }>();
  for (const p of preds) {
    for (const [attribute, group] of Object.entries(p.attributes)) {
      const key = `${attribute}\u0000${group}`;
      const b = buckets.get(key) ?? { attribute, group, preds: [] };
      b.preds.push(p);
      buckets.set(key, b);
    }
  }
  const groups = [...buckets.values()]
    .map((b) => ({ attribute: b.attribute, group: b.group, n: b.preds.length, rates: rates(b.preds) }))
    .sort((a, b) => a.attribute.localeCompare(b.attribute) || a.group.localeCompare(b.group));
  const warnings: BiasWarning[] = [];
  if (overall.replace > 0) {
    for (const g of groups) {
      const ratioToOverall = g.rates.replace / overall.replace;
      // Small epsilon so exactly 1.5x (with float noise) does not warn.
      if (ratioToOverall > BIAS_RATIO_LIMIT + 1e-9) {
        warnings.push({
          attribute: g.attribute,
          group: g.group,
          n: g.n,
          replaceRate: g.rates.replace,
          overallReplaceRate: overall.replace,
          ratio: ratioToOverall,
        });
      }
    }
  }
  return { overall, groups, warnings };
}
