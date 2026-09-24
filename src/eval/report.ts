import { ACTIONS } from '../policy/types.js';
import type { EvalResult } from './harness.js';
import { BIAS_RATIO_LIMIT, type BinaryMetrics } from './metrics.js';

const pct = (x: number | null): string => (x === null ? '   n/a' : `${(x * 100).toFixed(1).padStart(5)}%`);
const num = (x: number | null, d = 3): string => (x === null ? 'n/a' : x.toFixed(d));
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const lpad = (s: string | number, n: number): string => String(s).padStart(n);

function bm(m: BinaryMetrics): string {
  return `precision ${pct(m.precision)}  recall ${pct(m.recall)}  FPR ${pct(m.fpr)}  (tp ${m.tp} fp ${m.fp} fn ${m.fn} tn ${m.tn})`;
}

/** Plain-text report. Stable layout so it can be diffed between runs. */
export function renderReport(r: EvalResult): string {
  const out: string[] = [];
  const line = (s = '') => out.push(s);

  line(`Eval report: ${r.n} labelled answers`);
  line(`provider ${r.provider.name} (${r.provider.modelVersion}), config ${r.studyId}, policy in enforce mode`);
  line(`provider errors/empty: ${r.providerErrors}   latency ms p50 ${r.latency.p50} p95 ${r.latency.p95} max ${r.latency.max}`);
  line();

  line('Label distribution');
  const labelCounts = ACTIONS.map((a) => `${a} ${r.predictions.filter((p) => p.label === a).length}`);
  line(`  ${labelCounts.join('   ')}`);
  line();

  line('Confusion matrix (rows = label, cols = predicted)');
  line(`  ${pad('', 9)}${ACTIONS.map((a) => lpad(a, 9)).join('')}`);
  for (const l of ACTIONS) line(`  ${pad(l, 9)}${ACTIONS.map((p) => lpad(r.confusion[l][p], 9)).join('')}`);
  line();

  const base = r.sweep.find((s) => s.threshold === 0) ?? r.sweep[0];
  if (base) {
    line('At policy output (no extra confidence threshold)');
    line(`  any intervention  ${bm(base.intervention)}`);
    for (const a of ['clarify', 'flag', 'replace'] as const) line(`  ${pad(a, 17)} ${bm(base.perAction[a])}`);
    line(`  keep-labelled answers recommended for replace: ${base.keepLabelledReplaced}`);
    line();
  }

  line('Threshold sweep (interventions with decision confidence < t are dropped to keep)');
  line(`  ${['t', 'coverage', 'int.prec', 'int.recall', 'int.FPR', 'flag.prec', 'flag.rec', 'repl.prec', 'repl.rec', 'repl.FPR', 'meanConf', 'calib.gap', 'keep→repl'].map((h) => lpad(h, 11)).join('')}`);
  for (const s of r.sweep) {
    line(
      `  ${[
        s.threshold.toFixed(2),
        pct(s.coverage),
        pct(s.intervention.precision),
        pct(s.intervention.recall),
        pct(s.intervention.fpr),
        pct(s.perAction.flag.precision),
        pct(s.perAction.flag.recall),
        pct(s.perAction.replace.precision),
        pct(s.perAction.replace.recall),
        pct(s.perAction.replace.fpr),
        num(s.meanInterventionConfidence),
        num(s.calibrationGap),
        String(s.keepLabelledReplaced),
      ].map((v) => lpad(v, 11)).join('')}`,
    );
  }
  line('  calib.gap = mean confidence − exact-action accuracy of retained interventions (> 0 is overconfident)');
  line();

  line(`Calibration (decision confidence vs exact-action accuracy), ECE ${num(r.calibration.ece)}`);
  line(`  ${['bin', 'n', 'meanConf', 'accuracy'].map((h) => lpad(h, 12)).join('')}`);
  for (const b of r.calibration.bins) {
    line(`  ${[`${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`, String(b.n), num(b.meanConfidence), num(b.accuracy)].map((v) => lpad(v, 12)).join('')}`);
  }
  line();

  line(`Bias guardrail (predicted action rates by respondent attribute; warn if replace rate > ${BIAS_RATIO_LIMIT}x overall)`);
  const o = r.bias.overall;
  line(`  ${pad('overall', 26)} n ${lpad(r.n, 4)}  ${ACTIONS.map((a) => `${a} ${pct(o[a])}`).join('  ')}`);
  for (const g of r.bias.groups) {
    line(`  ${pad(`${g.attribute}=${g.group}`, 26)} n ${lpad(g.n, 4)}  ${ACTIONS.map((a) => `${a} ${pct(g.rates[a])}`).join('  ')}${g.n < 20 ? '  (low n)' : ''}`);
  }
  if (r.bias.warnings.length === 0) line('  no warnings');
  for (const w of r.bias.warnings) {
    line(
      `  WARNING ${w.attribute}=${w.group}: replace rate ${pct(w.replaceRate).trim()} is ${w.ratio.toFixed(2)}x overall ${pct(w.overallReplaceRate).trim()} (n ${w.n})`,
    );
  }
  return out.join('\n');
}
