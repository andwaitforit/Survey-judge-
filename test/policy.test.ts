import { describe, expect, it } from 'vitest';
import { decide, type PolicyContext } from '../src/policy/engine.js';
import { parseStudyConfig, type StudyConfig } from '../src/policy/config.js';
import { CHECK_FAMILY, CHECK_NAMES, type CheckResult } from '../src/policy/types.js';

const baseConfig = (overrides: Record<string, unknown> = {}): StudyConfig =>
  parseStudyConfig({
    studyId: 'acme-q4-tracker',
    mode: 'enforce',
    thresholds: {
      clarify: { relevance: 0.55, specificity: 0.45 },
      flag: { relevance: 0.3, gibberish: 0.7, duplicate: 0.85 },
      replace: { requireChecks: 2, minConfidence: 0.9 },
    },
    clarifyPrompts: { relevance: 'Could you say a bit more about why?' },
    maxClarifyPerSession: 2,
    ...overrides,
  });

const fresh: PolicyContext = { isRescore: false, clarifiesUsedInSession: 0 };

/** A result set where every check looks healthy. */
function healthy(): CheckResult[] {
  return [
    { check: 'relevance', score: 0.9, confidence: 0.95 },
    { check: 'specificity', score: 0.8, confidence: 0.95 },
    { check: 'coherence', score: 0.9, confidence: 0.95 },
    { check: 'contradiction', score: 0.05, confidence: 0.95 },
    { check: 'gibberish', score: 0.02, confidence: 0.95 },
    { check: 'boilerplate', score: 0.05, confidence: 0.95 },
    { check: 'duplicate', score: 0.1, confidence: 0.95 },
    { check: 'effort', score: 0.9, confidence: 0.95 },
  ];
}

function withResult(results: CheckResult[], patch: CheckResult): CheckResult[] {
  return results.map((r) => (r.check === patch.check ? patch : r));
}

describe('parseStudyConfig', () => {
  it('defaults mode to shadow', () => {
    const cfg = parseStudyConfig({ studyId: 's1', thresholds: {} });
    expect(cfg.mode).toBe('shadow');
  });

  it('fills sensible defaults', () => {
    const cfg = parseStudyConfig({ studyId: 's1' });
    expect(cfg.thresholds.replace.requireChecks).toBeGreaterThanOrEqual(2);
    expect(cfg.thresholds.replace.minConfidence).toBe(0.9);
    expect(cfg.maxClarifyPerSession).toBe(2);
  });

  it('parses the PRODUCT.md example verbatim', () => {
    const cfg = baseConfig({ mode: 'shadow' });
    expect(cfg.thresholds.flag.gibberish).toBe(0.7);
  });

  it('rejects unknown check names so an AI-authorship signal can never be a deciding check', () => {
    expect(() =>
      parseStudyConfig({ studyId: 's1', thresholds: { flag: { aiWritten: 0.5 } } }),
    ).toThrow();
  });

  it('rejects unknown top-level fields', () => {
    expect(() => parseStudyConfig({ studyId: 's1', surprise: true })).toThrow();
  });

  it('rejects thresholds outside 0..1', () => {
    expect(() => parseStudyConfig({ studyId: 's1', thresholds: { clarify: { relevance: 1.2 } } })).toThrow();
  });

  it('refuses requireChecks < 2 so a single check can never replace', () => {
    expect(() =>
      parseStudyConfig({ studyId: 's1', thresholds: { replace: { requireChecks: 1 } } }),
    ).toThrow();
  });
});

describe('decide — rule order', () => {
  it('keeps a healthy answer', () => {
    const d = decide(healthy(), baseConfig(), fresh);
    expect(d.action).toBe('keep');
    expect(d.recommendedAction).toBe('keep');
    expect(d.triggers).toEqual([]);
  });

  it('clarifies when relevance is below the clarify threshold', () => {
    const r = withResult(healthy(), { check: 'relevance', score: 0.45, confidence: 0.9 });
    const d = decide(r, baseConfig(), fresh);
    expect(d.action).toBe('clarify');
    expect(d.clarifyPrompt).toBe('Could you say a bit more about why?');
  });

  it('falls back to the default clarify prompt for checks without a configured prompt', () => {
    const r = withResult(healthy(), { check: 'specificity', score: 0.2, confidence: 0.9 });
    const d = decide(r, baseConfig(), fresh);
    expect(d.action).toBe('clarify');
    expect(d.clarifyPrompt).toBeTruthy();
  });

  it('flags when gibberish exceeds the flag threshold (risk checks trip upward)', () => {
    const r = withResult(healthy(), { check: 'gibberish', score: 0.8, confidence: 0.9 });
    const d = decide(r, baseConfig(), fresh);
    expect(d.action).toBe('flag');
    expect(d.clarifyPrompt).toBeUndefined();
  });

  it('flags when relevance is below the flag threshold (quality checks trip downward)', () => {
    const r = withResult(healthy(), { check: 'relevance', score: 0.2, confidence: 0.9 });
    expect(decide(r, baseConfig(), fresh).action).toBe('flag');
  });

  it('flag beats clarify', () => {
    let r = withResult(healthy(), { check: 'specificity', score: 0.1, confidence: 0.9 });
    r = withResult(r, { check: 'duplicate', score: 0.95, confidence: 0.9 });
    expect(decide(r, baseConfig(), fresh).action).toBe('flag');
  });

  it('replaces when two independent checks trip with confidence above minConfidence', () => {
    let r = withResult(healthy(), { check: 'gibberish', score: 0.95, confidence: 0.97 });
    r = withResult(r, { check: 'duplicate', score: 0.95, confidence: 0.95 });
    const d = decide(r, baseConfig(), fresh);
    expect(d.action).toBe('replace');
    expect(d.triggers.filter((t) => t.level === 'replace')).toHaveLength(2);
  });

  it('does not count correlated checks from the same evidence family as independent', () => {
    // Keyboard mash trips gibberish and relevance together; that is one line of evidence.
    let r = withResult(healthy(), { check: 'gibberish', score: 0.99, confidence: 0.99 });
    r = withResult(r, { check: 'relevance', score: 0.01, confidence: 0.99 });
    expect(decide(r, baseConfig(), fresh).action).toBe('flag');
  });

  it('refuses requireChecks above the number of evidence families', () => {
    expect(() => parseStudyConfig({ studyId: 's', thresholds: { replace: { requireChecks: 5 } } })).toThrow();
  });

  it('does not replace on a single check, however confident', () => {
    const r = withResult(healthy(), { check: 'gibberish', score: 0.99, confidence: 0.99 });
    expect(decide(r, baseConfig(), fresh).action).toBe('flag');
  });

  it('does not replace when confidence equals minConfidence (must be strictly above)', () => {
    let r = withResult(healthy(), { check: 'gibberish', score: 0.95, confidence: 0.9 });
    r = withResult(r, { check: 'duplicate', score: 0.95, confidence: 0.9 });
    expect(decide(r, baseConfig(), fresh).action).toBe('flag');
  });

  it('does not replace when only one of the agreeing checks is confident enough', () => {
    let r = withResult(healthy(), { check: 'gibberish', score: 0.95, confidence: 0.97 });
    r = withResult(r, { check: 'duplicate', score: 0.95, confidence: 0.7 });
    expect(decide(r, baseConfig(), fresh).action).toBe('flag');
  });

  it('honours explicit replace per-check thresholds when configured', () => {
    const cfg = baseConfig({
      thresholds: {
        clarify: {},
        flag: { gibberish: 0.7, duplicate: 0.85 },
        replace: { requireChecks: 2, minConfidence: 0.9, checks: { gibberish: 0.9, duplicate: 0.95 } },
      },
    });
    let r = withResult(healthy(), { check: 'gibberish', score: 0.8, confidence: 0.99 });
    r = withResult(r, { check: 'duplicate', score: 0.9, confidence: 0.99 });
    // Both trip flag but neither trips the stricter replace thresholds.
    expect(decide(r, cfg, fresh).action).toBe('flag');
    r = withResult(r, { check: 'gibberish', score: 0.95, confidence: 0.99 });
    r = withResult(r, { check: 'duplicate', score: 0.97, confidence: 0.99 });
    expect(decide(r, cfg, fresh).action).toBe('replace');
  });

  it('treats a score exactly on the threshold as not tripped', () => {
    let r = withResult(healthy(), { check: 'relevance', score: 0.55, confidence: 0.9 });
    r = withResult(r, { check: 'gibberish', score: 0.7, confidence: 0.9 });
    expect(decide(r, baseConfig(), fresh).action).toBe('keep');
  });
});

describe('decide — low confidence resolves toward keep', () => {
  it('ignores a clarify trip below the clarify confidence floor', () => {
    const r = withResult(healthy(), { check: 'relevance', score: 0.45, confidence: 0.2 });
    expect(decide(r, baseConfig(), fresh).action).toBe('keep');
  });

  it('downgrades a low-confidence flag trip to clarify', () => {
    const r = withResult(healthy(), { check: 'gibberish', score: 0.9, confidence: 0.55 });
    expect(decide(r, baseConfig(), fresh).action).toBe('clarify');
  });

  it('downgrades a very-low-confidence flag trip all the way to keep', () => {
    const r = withResult(healthy(), { check: 'gibberish', score: 0.9, confidence: 0.1 });
    expect(decide(r, baseConfig(), fresh).action).toBe('keep');
  });

  it('keeps when the provider returned nothing (fail open)', () => {
    const d = decide([], baseConfig(), fresh);
    expect(d.action).toBe('keep');
    expect(d.confidence).toBe(0);
  });

  it('decides on the checks that did return (partial failure)', () => {
    const d = decide([{ check: 'gibberish', score: 0.9, confidence: 0.9 }], baseConfig(), fresh);
    expect(d.action).toBe('flag');
  });
});

describe('decide — clarify lifecycle', () => {
  const weak = withResult(healthy(), { check: 'relevance', score: 0.45, confidence: 0.9 });

  it('never returns clarify for a re-scored answer; a still-weak answer falls through to keep', () => {
    const d = decide(weak, baseConfig(), { isRescore: true, clarifiesUsedInSession: 1 });
    expect(d.action).toBe('keep');
  });

  it('a re-scored answer can still be flagged', () => {
    const r = withResult(healthy(), { check: 'gibberish', score: 0.9, confidence: 0.9 });
    expect(decide(r, baseConfig(), { isRescore: true, clarifiesUsedInSession: 1 }).action).toBe('flag');
  });

  it('a re-scored answer is capped at flag even if replace conditions hold', () => {
    let r = withResult(healthy(), { check: 'gibberish', score: 0.95, confidence: 0.97 });
    r = withResult(r, { check: 'duplicate', score: 0.95, confidence: 0.95 });
    expect(decide(r, baseConfig(), { isRescore: true, clarifiesUsedInSession: 1 }).action).toBe('flag');
  });

  it('keeps when the session clarify budget is exhausted', () => {
    const d = decide(weak, baseConfig(), { isRescore: false, clarifiesUsedInSession: 2 });
    expect(d.action).toBe('keep');
  });

  it('a budget of zero disables clarify', () => {
    expect(decide(weak, baseConfig({ maxClarifyPerSession: 0 }), fresh).action).toBe('keep');
  });

  it('a low-confidence flag that would downgrade to clarify keeps when clarify is unavailable', () => {
    const r = withResult(healthy(), { check: 'gibberish', score: 0.9, confidence: 0.55 });
    expect(decide(r, baseConfig(), { isRescore: true, clarifiesUsedInSession: 0 }).action).toBe('keep');
  });
});

describe('decide — shadow mode', () => {
  it('returns keep but records the recommended action', () => {
    const r = withResult(healthy(), { check: 'gibberish', score: 0.9, confidence: 0.9 });
    const d = decide(r, baseConfig({ mode: 'shadow' }), fresh);
    expect(d.action).toBe('keep');
    expect(d.recommendedAction).toBe('flag');
    expect(d.mode).toBe('shadow');
  });

  it('does not emit a clarify prompt in shadow mode', () => {
    const r = withResult(healthy(), { check: 'relevance', score: 0.45, confidence: 0.9 });
    const d = decide(r, baseConfig({ mode: 'shadow' }), fresh);
    expect(d.recommendedAction).toBe('clarify');
    expect(d.clarifyPrompt).toBeUndefined();
  });
});

describe('decide — properties', () => {
  it('is deterministic and never throws on arbitrary in-range inputs', () => {
    const cfg = baseConfig();
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 2000; i++) {
      const results: CheckResult[] = CHECK_NAMES.filter(() => rand() > 0.2).map((check) => ({
        check,
        score: rand(),
        confidence: rand(),
      }));
      const ctx = { isRescore: rand() > 0.5, clarifiesUsedInSession: Math.floor(rand() * 3) };
      const a = decide(results, cfg, ctx);
      const b = decide(results, cfg, ctx);
      expect(a).toEqual(b);
      if (ctx.isRescore) expect(['keep', 'flag']).toContain(a.recommendedAction);
      if (a.recommendedAction === 'replace') {
        const confident = a.triggers.filter((t) => t.level === 'replace' && t.confidence > 0.9);
        expect(new Set(confident.map((t) => CHECK_FAMILY[t.check])).size).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('lowering every confidence never moves an action upward (monotone toward keep)', () => {
    const cfg = baseConfig();
    const rank = { keep: 0, clarify: 1, flag: 2, replace: 3 } as const;
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 2000; i++) {
      const results: CheckResult[] = CHECK_NAMES.map((check) => ({ check, score: rand(), confidence: rand() }));
      const lowered = results.map((r) => ({ ...r, confidence: r.confidence * rand() }));
      const hi = decide(results, cfg, fresh).recommendedAction;
      const lo = decide(lowered, cfg, fresh).recommendedAction;
      expect(rank[lo]).toBeLessThanOrEqual(rank[hi]);
    }
  });
});
