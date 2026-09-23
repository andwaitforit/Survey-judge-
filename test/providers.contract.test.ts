import { describe, expect, it } from 'vitest';
import { CHECK_NAMES, type CheckName } from '../src/policy/types.js';
import { runChecks } from '../src/providers/run.js';
import type { CheckRequest } from '../src/providers/types.js';
import { stubHarness, type ProviderHarness } from './helpers/provider-harness.js';

export const HARNESSES: ProviderHarness[] = [stubHarness];

const req = (checks: CheckName[] = [...CHECK_NAMES]): CheckRequest => ({
  checks,
  state: {
    questionText: 'Why did you choose Brand X?',
    answerText: 'The price was lower and the delivery arrived in two days.',
    priorAnswers: [{ question: 'Have you bought Brand X?', answer: 'Yes, twice this year' }],
    peerAnswers: ['cheaper than the rest', 'fast delivery and good price'],
  },
});

describe.each(HARNESSES)('DecisionProvider contract: $name', (h) => {
  it('exposes a name and model version', () => {
    const p = h.make();
    expect(p.name).toMatch(/\S/);
    expect(p.modelVersion).toMatch(/\S/);
  });

  it('returns every requested check once, with score and confidence in 0..1', async () => {
    const out = await h.make().scoreBatch(req(), { timeoutMs: 1000 });
    expect(out.map((r) => r.check).sort()).toEqual([...CHECK_NAMES].sort());
    for (const r of out) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('returns only the requested checks', async () => {
    const out = await h.make().scoreBatch(req(['relevance', 'gibberish']), { timeoutMs: 1000 });
    expect(out.map((r) => r.check).sort()).toEqual(['gibberish', 'relevance']);
  });

  it('respects the timeout when every check is slow', async () => {
    const p = h.make({ slow: [...CHECK_NAMES], slowMs: 2000 });
    const t0 = performance.now();
    const out = await p.scoreBatch(req(), { timeoutMs: 50 }).catch(() => []);
    expect(performance.now() - t0).toBeLessThan(400);
    expect(out).toEqual([]);
  });

  it('returns the fast checks when some time out (partial failure)', async () => {
    const slow: CheckName[] = ['duplicate', 'contradiction'];
    const out = await h.make({ slow, slowMs: 2000 }).scoreBatch(req(), { timeoutMs: 100 });
    const got = out.map((r) => r.check);
    for (const c of slow) expect(got).not.toContain(c);
    expect(got.sort()).toEqual(CHECK_NAMES.filter((c) => !slow.includes(c)).sort());
  });

  it('returns the healthy checks when some error', async () => {
    const out = await h.make({ fail: ['effort'] }).scoreBatch(req(), { timeoutMs: 1000 });
    const got = out.map((r) => r.check);
    expect(got).not.toContain('effort');
    expect(got).toHaveLength(CHECK_NAMES.length - 1);
  });

  it('fails open through runChecks when everything times out', async () => {
    const outcome = await runChecks(h.make({ slow: [...CHECK_NAMES], slowMs: 2000 }), req(), 50);
    expect(outcome.results).toEqual([]);
    expect(outcome.missing.sort()).toEqual([...CHECK_NAMES].sort());
    expect(outcome.latencyMs).toBeLessThan(400);
  });
});
