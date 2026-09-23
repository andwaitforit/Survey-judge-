import type { CheckName } from '../policy/types.js';
import { clamp01 } from './parallel.js';
import type { CheckState } from './types.js';
import { contentWords, hasNegation, jaccard, normalize, shingles, stem, tokens } from './text.js';

/**
 * Deterministic heuristics behind StubProvider. They are NOT a model. They are good enough that
 * the eval harness produces non-trivial numbers offline, and bad enough to remind everyone that
 * the stub baseline is a floor, not a target.
 */

const FILLER = new Set([
  'good', 'ok', 'okay', 'fine', 'nothing', 'none', 'na', 'n a', 'idk', 'no', 'yes', 'nope', 'dunno',
  'whatever', 'test', 'no comment', 'not sure', 'dont know', "don't know", 'i dont know', "i don't know",
  'no idea', 'nothing really', 'its good', "it's good", 'it was good', 'nice', 'great', 'cool', 'meh',
  'because', 'just because', 'no reason', 'same', 'lol', 'k', 'yes it is', 'i like it', 'good product',
]);

const TEMPLATE_PHRASES = [
  'as an ai', 'language model', 'lorem ipsum', 'in conclusion', 'i hope this helps',
  'here is a', 'certainly!', 'great question', 'overall, ', 'it is important to note',
];

const KEYBOARD_RUNS = ['qwer', 'wert', 'asdf', 'sdfg', 'dfgh', 'fghj', 'ghjk', 'hjkl', 'zxcv', 'xcvb', 'uiop', 'yuio'];
/** Three-letter home/top-row runs that are never English words. */
const SHORT_RUNS = new Set(['asd', 'sdf', 'dfg', 'fgh', 'ghj', 'hjk', 'jkl', 'qwe', 'wer', 'zxc', 'xcv']);

function isMash(tok: string): boolean {
  if (SHORT_RUNS.has(tok)) return true;
  if (tok.length < 4 || /^\d+$/.test(tok)) return false;
  if (/(.)\1{2,}/u.test(tok)) return true;
  if (KEYBOARD_RUNS.some((k) => tok.includes(k))) return true;
  const letters = tok.replace(/[^a-z]/g, '');
  if (letters.length < 4) return false; // non-Latin scripts: do not guess
  const vowels = (letters.match(/[aeiouy]/g) ?? []).length;
  if (vowels / letters.length < 0.15) return true;
  return /[bcdfghjklmnpqrstvwxz]{5,}/.test(letters);
}

export interface Signals {
  words: string[];
  content: string[];
  filler: boolean;
  mashRatio: number;
  repeatRatio: number;
}

export function signals(answer: string): Signals {
  const words = tokens(answer);
  const content = contentWords(answer);
  const norm = normalize(answer).replace(/[^\p{L}\p{N}' ]/gu, '').trim();
  const mash = words.filter(isMash).length;
  const repeatRatio = words.length > 2 ? 1 - new Set(words).size / words.length : 0;
  return {
    words,
    content,
    filler: FILLER.has(norm) || norm.length === 0,
    mashRatio: words.length ? mash / words.length : 1,
    repeatRatio,
  };
}

export type Scorer = (state: CheckState, s: Signals) => { score: number; certainty?: number };

export const SCORERS: Record<CheckName, Scorer> = {
  gibberish: (_state, s) => {
    if (s.words.length === 0) return { score: 0.98 };
    // A filler non-answer ("good") is recoverable, which is what clarify is for. Keyboard mash is not.
    // So filler sits below mash, and below the PRODUCT.md example flag threshold (0.70).
    if (s.filler) return { score: 0.65, certainty: 0.9 };
    const short = s.content.length <= 1 ? 0.55 : 0;
    return { score: Math.max(s.mashRatio, short, s.repeatRatio > 0.6 ? 0.8 : 0) };
  },
  specificity: (_state, s) => {
    if (s.filler) return { score: 0.05 };
    const distinct = new Set(s.content).size;
    const concrete = s.words.some((w) => /\d/.test(w)) ? 0.1 : 0;
    return { score: clamp01((0.05 + 0.09 * distinct + concrete) * (1 - s.mashRatio)) };
  },
  relevance: (state, s) => {
    if (s.filler) return { score: 0.35 };
    if (s.mashRatio > 0.5) return { score: 0.08 };
    const q = new Set(contentWords(`${state.questionText} ${state.studyContext ?? ''}`).map(stem));
    const overlap = new Set(s.content.map(stem).filter((w) => q.has(w))).size;
    // Brevity is specificity's job, not relevance's: "price" is a relevant (if thin) answer.
    const base = 0.5 + Math.min(0.25, 0.12 * overlap) + Math.min(0.2, 0.025 * s.content.length);
    // Overlap is a weak proxy for topicality, so the stub is never very sure.
    return { score: clamp01(base), certainty: 0.8 };
  },
  coherence: (_state, s) => {
    if (s.words.length === 0) return { score: 0.02 };
    return { score: clamp01(1 - s.mashRatio - 0.6 * s.repeatRatio) };
  },
  contradiction: (state, s) => {
    const neg = hasNegation(state.answerText);
    const mine = new Set(s.content.map(stem));
    for (const p of state.priorAnswers) {
      const shared = contentWords(p.answer).map(stem).filter((w) => mine.has(w));
      if (shared.length > 0 && hasNegation(p.answer) !== neg) return { score: 0.8, certainty: 0.75 };
    }
    return { score: 0.08, certainty: state.priorAnswers.length ? 1 : 0.6 };
  },
  boilerplate: (state, s) => {
    const lower = normalize(state.answerText);
    if (TEMPLATE_PHRASES.some((p) => lower.includes(p))) return { score: 0.88 };
    const copy = jaccard(s.words, tokens(state.questionText));
    return { score: clamp01(copy > 0.5 ? 0.5 + copy / 2 : copy / 2) };
  },
  duplicate: (state, s) => {
    const peers = state.peerAnswers ?? [];
    if (peers.length === 0) return { score: 0.05, certainty: 0.4 };
    if (s.filler) return { score: 0.1 };
    const mine = shingles(state.answerText);
    const norm = normalize(state.answerText);
    let best = 0;
    for (const p of peers) {
      best = Math.max(best, normalize(p) === norm ? 1 : jaccard(mine, shingles(p)));
    }
    return { score: best };
  },
  effort: (state, s) => {
    const gib = SCORERS.gibberish(state, s).score;
    const spec = SCORERS.specificity(state, s).score;
    return { score: clamp01(0.55 * spec + 0.45 * (1 - gib)) };
  },
};
