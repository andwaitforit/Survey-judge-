import { describe, expect, it } from 'vitest';
import {
  binaryMetrics,
  biasReport,
  calibration,
  confusionMatrix,
  sweep,
  type Prediction,
} from '../src/eval/metrics.js';

const p = (
  label: Prediction['label'],
  predicted: Prediction['predicted'],
  confidence = 0.9,
  attributes: Record<string, string> = {},
): Prediction => ({ id: `${label}-${predicted}-${confidence}`, label, predicted, confidence, attributes });

describe('binaryMetrics', () => {
  it('computes precision, recall and FPR from counts', () => {
    //            TP    FP     FN     TN    TN
    const t = [true, false, true, false, false];
    const y = [true, true, false, false, false];
    const m = binaryMetrics(t, y);
    expect(m).toMatchObject({ tp: 1, fp: 1, fn: 1, tn: 2 });
    expect(m.precision).toBeCloseTo(0.5);
    expect(m.recall).toBeCloseTo(0.5);
    expect(m.fpr).toBeCloseTo(1 / 3);
  });

  it('returns null instead of NaN when a denominator is zero', () => {
    const m = binaryMetrics([false, false], [false, false]);
    expect(m.precision).toBeNull();
    expect(m.recall).toBeNull();
    expect(m.fpr).toBe(0);
  });

  it('rejects mismatched lengths', () => {
    expect(() => binaryMetrics([true], [])).toThrow();
  });
});

describe('confusionMatrix', () => {
  it('counts label x predicted', () => {
    const cm = confusionMatrix([p('keep', 'keep'), p('keep', 'flag'), p('replace', 'flag')]);
    expect(cm.keep.keep).toBe(1);
    expect(cm.keep.flag).toBe(1);
    expect(cm.replace.flag).toBe(1);
    expect(cm.replace.replace).toBe(0);
  });
});

describe('calibration', () => {
  it('bins by confidence and computes ECE', () => {
    const pts = [
      { confidence: 0.95, correct: true },
      { confidence: 0.95, correct: true },
      { confidence: 0.95, correct: false },
      { confidence: 0.95, correct: true },
      { confidence: 0.3, correct: false },
      { confidence: 0.3, correct: true },
    ];
    const c = calibration(pts, 5);
    expect(c.bins).toHaveLength(5);
    const top = c.bins[4]!;
    expect(top.n).toBe(4);
    expect(top.accuracy).toBeCloseTo(0.75);
    expect(top.meanConfidence).toBeCloseTo(0.95);
    const low = c.bins[1]!;
    expect(low.n).toBe(2);
    expect(low.accuracy).toBeCloseTo(0.5);
    // ECE = 4/6*|0.75-0.95| + 2/6*|0.5-0.3|
    expect(c.ece).toBeCloseTo((4 / 6) * 0.2 + (2 / 6) * 0.2);
  });

  it('puts confidence 1.0 in the last bin and 0 in the first', () => {
    const c = calibration([{ confidence: 1, correct: true }, { confidence: 0, correct: false }], 4);
    expect(c.bins[3]!.n).toBe(1);
    expect(c.bins[0]!.n).toBe(1);
  });

  it('handles an empty set', () => {
    expect(calibration([], 5).ece).toBe(0);
  });
});

describe('sweep', () => {
  const preds = [
    p('flag', 'flag', 0.95),
    p('flag', 'flag', 0.65),
    p('keep', 'flag', 0.6),
    p('keep', 'keep', 0.9),
    p('replace', 'replace', 0.97),
    p('keep', 'clarify', 0.55),
  ];

  it('drops interventions below the threshold to keep', () => {
    const rows = sweep(preds, [0, 0.7]);
    const at0 = rows[0]!;
    // Interventions predicted: flag, flag, flag(FP), replace, clarify(FP). Positives (label != keep): 3.
    expect(at0.intervention).toMatchObject({ tp: 3, fp: 2, fn: 0, tn: 1 });
    const at07 = rows[1]!;
    // Only 0.95 flag and 0.97 replace survive.
    expect(at07.intervention).toMatchObject({ tp: 2, fp: 0, fn: 1, tn: 3 });
    expect(at07.coverage).toBeCloseTo(2 / 6);
  });

  it('reports per-action metrics and the calibration gap of retained interventions', () => {
    const [row] = sweep(preds, [0.7]);
    expect(row!.perAction.replace.recall).toBe(1);
    expect(row!.perAction.flag.recall).toBeCloseTo(0.5);
    // Retained interventions: conf 0.95 and 0.97, both correct → gap = 0.96 - 1.0
    expect(row!.meanInterventionConfidence).toBeCloseTo(0.96);
    expect(row!.calibrationGap).toBeCloseTo(-0.04);
  });

  it('counts real respondents recommended for replacement (the expensive error)', () => {
    const [row] = sweep([p('keep', 'replace', 0.99), p('clarify', 'replace', 0.99), p('replace', 'replace', 0.99)], [0]);
    expect(row!.keepLabelledReplaced).toBe(1);
  });
});

describe('biasReport', () => {
  it('reports action rates per attribute group', () => {
    const r = biasReport([
      p('keep', 'keep', 0.9, { languageGroup: 'en' }),
      p('keep', 'flag', 0.9, { languageGroup: 'en' }),
      p('keep', 'keep', 0.9, { languageGroup: 'es' }),
    ]);
    const en = r.groups.find((g) => g.attribute === 'languageGroup' && g.group === 'en')!;
    expect(en.n).toBe(2);
    expect(en.rates.flag).toBeCloseTo(0.5);
    expect(en.rates.keep).toBeCloseTo(0.5);
  });

  it('warns when a group replace rate exceeds 1.5x the overall rate', () => {
    const rows: Prediction[] = [
      ...Array.from({ length: 8 }, () => p('keep', 'keep', 0.9, { languageGroup: 'en' })),
      p('replace', 'replace', 0.95, { languageGroup: 'en' }),
      p('replace', 'replace', 0.95, { languageGroup: 'es' }),
      p('keep', 'keep', 0.9, { languageGroup: 'es' }),
    ];
    // overall 2/11 = 0.18; es = 1/2 = 0.5 (2.75x) → warn; en = 1/9 = 0.11 → ok
    const r = biasReport(rows);
    expect(r.overall.replace).toBeCloseTo(2 / 11);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ attribute: 'languageGroup', group: 'es' });
    expect(r.warnings[0]!.ratio).toBeCloseTo(0.5 / (2 / 11));
  });

  it('does not warn at exactly 1.5x', () => {
    // overall replace = 2/6 = 1/3; group a = 1/2 = 1.5x exactly
    const rows: Prediction[] = [
      p('replace', 'replace', 0.9, { g: 'a' }),
      p('keep', 'keep', 0.9, { g: 'a' }),
      p('replace', 'replace', 0.9, { g: 'b' }),
      p('keep', 'keep', 0.9, { g: 'b' }),
      p('keep', 'keep', 0.9, { g: 'b' }),
      p('keep', 'keep', 0.9, { g: 'b' }),
    ];
    expect(biasReport(rows).warnings).toEqual([]);
  });

  it('does not warn when nothing is replaced', () => {
    expect(biasReport([p('keep', 'keep', 0.9, { g: 'a' })]).warnings).toEqual([]);
  });
});
