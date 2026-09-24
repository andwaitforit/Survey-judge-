import { describe, expect, it } from 'vitest';
import { CHECK_NAMES } from '../src/policy/types.js';
import { StubProvider } from '../src/providers/stub.js';
import type { CheckState } from '../src/providers/types.js';

const score = async (state: Partial<CheckState> & { answerText: string }) => {
  const out = await new StubProvider().scoreBatch(
    {
      checks: [...CHECK_NAMES],
      state: { questionText: 'Why did you choose Brand X over other brands?', priorAnswers: [], ...state },
    },
    { timeoutMs: 1000 },
  );
  return Object.fromEntries(out.map((r) => [r.check, r]));
};

describe('StubProvider', () => {
  it('is deterministic for the same answer', async () => {
    const a = await score({ answerText: 'Cheaper than the alternatives and my sister recommended it' });
    const b = await score({ answerText: 'Cheaper than the alternatives and my sister recommended it' });
    expect(a).toEqual(b);
  });

  it('scores keyboard mash as gibberish with high confidence', async () => {
    const r = await score({ answerText: 'asdfgh jkjkjk qwrtzp' });
    expect(r.gibberish!.score).toBeGreaterThan(0.7);
    expect(r.gibberish!.confidence).toBeGreaterThan(0.85);
    expect(r.relevance!.score).toBeLessThan(0.3);
  });

  it('scores a filler non-answer as gibberish-ish but below keyboard mash, and unspecific', async () => {
    const r = await score({ answerText: 'good' });
    const mash = await score({ answerText: 'asdfgh jkjkjk' });
    expect(r.gibberish!.score).toBeGreaterThan(0.5);
    expect(r.gibberish!.score).toBeLessThan(mash.gibberish!.score);
    expect(r.specificity!.score).toBeLessThan(0.2);
  });

  it('scores a concrete answer as specific, relevant and clean', async () => {
    const r = await score({
      answerText: 'I chose Brand X because the price was about 20% lower than other brands and delivery took two days',
    });
    expect(r.gibberish!.score).toBeLessThan(0.3);
    expect(r.specificity!.score).toBeGreaterThan(0.6);
    expect(r.relevance!.score).toBeGreaterThan(0.55);
  });

  it('detects a contradiction with a prior answer', async () => {
    const r = await score({
      answerText: 'I bought Brand X because it was cheap',
      priorAnswers: [{ question: 'Have you bought Brand X?', answer: 'I have never bought Brand X' }],
    });
    expect(r.contradiction!.score).toBeGreaterThan(0.7);
  });

  it('detects a near-duplicate of a peer answer', async () => {
    const r = await score({
      answerText: 'The price was great and the quality is excellent for the money',
      peerAnswers: ['the price was great and the quality is excellent for the money!'],
    });
    expect(r.duplicate!.score).toBeGreaterThan(0.85);
  });

  it('detects a copied question as boilerplate', async () => {
    const r = await score({ answerText: 'Why did you choose Brand X over other brands' });
    expect(r.boilerplate!.score).toBeGreaterThan(0.7);
  });

  it('does not call non-Latin script gibberish just because it has no ASCII vowels', async () => {
    const r = await score({ answerText: '价格便宜而且质量很好，朋友也推荐了这个品牌' });
    expect(r.gibberish!.score).toBeLessThan(0.7);
  });
});
