import { describe, expect, it } from 'vitest';
import { toJevRequest, toUnitScore } from '../src/providers/jev/adapter.js';
import { JevProvider } from '../src/providers/jev/provider.js';
import { createProvider } from '../src/providers/factory.js';

const state = {
  questionText: 'Why did you choose Brand X?',
  answerText: 'cheap',
  priorAnswers: [{ question: 'Bought before?', answer: 'never' }],
  peerAnswers: ['cheap', 'good price'],
};

describe('Jev adapter (TODO(jev-api): unverified shape)', () => {
  it('maps one check to one score question with a 5-level rubric', () => {
    const r = toJevRequest('jev-x', 'relevance', state);
    expect(Object.keys(r.questions)).toEqual(['relevance']);
    expect(r.questions.relevance!.type).toBe('score');
    expect(r.questions.relevance!.criteria).toHaveLength(5);
    expect(r.state).not.toHaveProperty('prior_answers');
    expect(toJevRequest('jev-x', 'contradiction', state).state).toHaveProperty('prior_answers');
    expect(toJevRequest('jev-x', 'duplicate', state).state).toHaveProperty('peer_answers');
  });

  it('interprets probabilities, rubric indexes, unit numbers and rubric labels', () => {
    expect(toUnitScore({ probabilities: { '0': 0, '4': 1 } }, 5)).toBe(1);
    expect(toUnitScore({ probabilities: { '0': 0.5, '4': 0.5 } }, 5)).toBeCloseTo(0.5);
    expect(toUnitScore({ score: 3 }, 5)).toBeCloseTo(0.75);
    expect(toUnitScore({ score: 0.42 }, 5)).toBeCloseTo(0.42);
    expect(toUnitScore({ score: '0.25: mostly no' }, 5)).toBeCloseTo(0.25);
    expect(() => toUnitScore({ score: 'banana' }, 5)).toThrow();
  });

  it('marks its model version as unverified', () => {
    const p = new JevProvider({ baseUrl: 'http://x.invalid', path: 'p', model: 'm' });
    expect(p.modelVersion).toMatch(/unverified/);
  });

  it('has no default endpoint: the factory refuses to build it without configuration', () => {
    expect(() => createProvider('jev', {})).toThrow(/JEV_BASE_URL/);
    expect(() => createProvider('llm', {})).toThrow(/LLM_BASE_URL/);
    expect(createProvider('stub', {}).name).toBe('stub');
  });
});
