import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/providers/run.js';
import type { CheckRequest, DecisionProvider } from '../src/providers/types.js';

const req: CheckRequest = {
  checks: ['relevance', 'gibberish'],
  state: { questionText: 'q', answerText: 'a', priorAnswers: [] },
};

const fake = (impl: DecisionProvider['scoreBatch']): DecisionProvider => ({
  name: 'fake',
  modelVersion: 'v0',
  scoreBatch: impl,
});

describe('runChecks (fail-open wrapper)', () => {
  it('never throws when the provider throws', async () => {
    const out = await runChecks(fake(async () => { throw new Error('boom'); }), req, 100);
    expect(out.results).toEqual([]);
    expect(out.error).toContain('boom');
    expect(out.missing).toEqual(['relevance', 'gibberish']);
  });

  it('enforces a hard timeout on a provider that ignores its deadline', async () => {
    const t0 = performance.now();
    const out = await runChecks(fake(() => new Promise(() => undefined)), req, 50);
    expect(performance.now() - t0).toBeLessThan(300);
    expect(out.error).toMatch(/hard timeout/);
    expect(out.results).toEqual([]);
  });

  it('drops out-of-range, unrequested, duplicate and malformed results', async () => {
    const out = await runChecks(
      fake(async () => [
        { check: 'relevance', score: 0.5, confidence: 0.9 },
        { check: 'relevance', score: 0.1, confidence: 0.9 },
        { check: 'gibberish', score: 1.5, confidence: 0.9 },
        { check: 'duplicate', score: 0.5, confidence: 0.9 },
        { nonsense: true },
      ] as never),
      req,
      100,
    );
    expect(out.results).toEqual([{ check: 'relevance', score: 0.5, confidence: 0.9 }]);
    expect(out.missing).toEqual(['gibberish']);
    expect(out.error).toMatch(/malformed/);
  });

  it('handles a non-array response', async () => {
    const out = await runChecks(fake(async () => 'nope' as never), req, 100);
    expect(out.results).toEqual([]);
    expect(out.error).toBeDefined();
  });
});
