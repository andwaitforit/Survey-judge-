import type { CheckName, CheckResult } from '../policy/types.js';

export type { CheckName, CheckResult };

export interface CheckState {
  questionText: string;
  answerText: string;
  priorAnswers: { question: string; answer: string }[];
  studyContext?: string;
  /** Sample of other respondents' answers, for the duplicate check. */
  peerAnswers?: string[];
}

export interface CheckRequest {
  /** Run in parallel against one state. */
  checks: CheckName[];
  state: CheckState;
}

export interface ScoreOptions {
  timeoutMs: number;
}

/**
 * Every model sits behind this. Contract (see test/providers.contract.test.ts):
 * - resolves within roughly `timeoutMs`, with results for the checks that finished in time;
 * - returns only requested checks, at most once each, with score and confidence in 0..1;
 * - may reject on total failure. Callers use `runChecks()`, which fails open.
 */
export interface DecisionProvider {
  readonly name: string;
  readonly modelVersion: string;
  scoreBatch(req: CheckRequest, opts: ScoreOptions): Promise<CheckResult[]>;
}

/** Shared by HTTP-backed providers so tests can inject a fake and never touch the network. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
