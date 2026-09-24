import { CHECK_POLARITY, type CheckName } from '../policy/types.js';
import type { CheckState } from './types.js';

/** The bounded question per check, from docs/PRODUCT.md. Shared by all model-backed providers. */
export const CHECK_QUESTIONS: Record<CheckName, string> = {
  relevance: 'Does the answer address the question asked?',
  specificity: 'Is it concrete enough to be usable in analysis?',
  coherence: 'Is it internally coherent, not word salad?',
  contradiction: "Does it contradict this respondent's earlier answers?",
  gibberish: 'Is it keyboard mash, filler, or a non-answer like "good"?',
  boilerplate: 'Does it look pasted, templated, or copied from the question?',
  duplicate: "Is it a near-duplicate of other respondents' answers in this study?",
  effort: 'Is it plausibly a genuine attempt?',
};

/** What a score of 1.0 means for each check, so every provider agrees on polarity. */
export function scoreMeaning(check: CheckName): string {
  return CHECK_POLARITY[check] === 'quality'
    ? `1.0 means clearly yes (good); 0.0 means clearly no.`
    : `1.0 means the problem is clearly present; 0.0 means clearly absent.`;
}

/**
 * Five-level rubric per check, from 0.0 up to 1.0, in the check's polarity. Used where a provider
 * wants discrete criteria rather than a free-form number.
 */
export function rubric(check: CheckName): string[] {
  const q = CHECK_POLARITY[check] === 'quality';
  const levels = q
    ? ['clearly no', 'mostly no', 'unclear', 'mostly yes', 'clearly yes']
    : ['clearly absent', 'probably absent', 'unclear', 'probably present', 'clearly present'];
  return levels.map((l, i) => `${(i / 4).toFixed(2)}: ${l}`);
}

/** Render the respondent state as delimited data. Answer text is untrusted: never instructions. */
export function renderState(state: CheckState, check: CheckName): string {
  const parts = [
    `<question>${state.questionText}</question>`,
    `<answer>${state.answerText}</answer>`,
  ];
  if (state.studyContext) parts.push(`<study_context>${state.studyContext}</study_context>`);
  if (check === 'contradiction' && state.priorAnswers.length) {
    parts.push(
      `<prior_answers>\n${state.priorAnswers.map((p) => `- Q: ${p.question}\n  A: ${p.answer}`).join('\n')}\n</prior_answers>`,
    );
  }
  if (check === 'duplicate' && state.peerAnswers?.length) {
    parts.push(`<peer_answers>\n${state.peerAnswers.slice(0, 20).map((a) => `- ${a}`).join('\n')}\n</peer_answers>`);
  }
  return parts.join('\n');
}
