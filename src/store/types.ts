import type { StudyConfig } from '../policy/config.js';
import type { Action, CheckName, Mode } from '../policy/types.js';

export type CheckScores = Partial<Record<CheckName, { score: number; confidence: number }>>;

/** One row of the append-only decision log. Respondent attributes are deliberately NOT stored. */
export interface DecisionRecord {
  decisionId: string;
  customerId: string;
  studyId: string;
  sessionId: string;
  questionId: string;
  answerText: string;
  provider: string;
  modelVersion: string;
  configVersion: number;
  checks: CheckScores;
  confidence: number;
  action: Action;
  recommendedAction: Action;
  mode: Mode;
  latencyMs: number;
  /** This decision is the re-score of an answer that was sent back for clarification. */
  clarified: boolean;
  providerError: string | null;
  missingChecks: CheckName[];
  finalOutcome: string | null;
  createdAt: Date;
}

export interface SessionState {
  /** Clarifies the policy has issued in this session (recommended, so shadow mode simulates the budget). */
  clarifiesUsedInSession: number;
  /** This question was already sent back for clarification, so the next score is a re-score. */
  questionAlreadyClarified: boolean;
}

export type OutcomeResult = 'recorded' | 'not_found' | 'already_set';

export interface DecisionLog {
  append(rec: DecisionRecord): Promise<void>;
  sessionState(customerId: string, studyId: string, sessionId: string, questionId: string): Promise<SessionState>;
  /** Most recent answers to this question from other sessions: the peer sample for the duplicate check. */
  recentAnswers(customerId: string, studyId: string, questionId: string, excludeSessionId: string, limit: number): Promise<string[]>;
  /** Oldest first. */
  list(customerId: string, studyId: string, opts?: { limit?: number }): Promise<DecisionRecord[]>;
  /** The only mutation the log allows: set finalOutcome once. */
  recordOutcome(customerId: string, decisionId: string, outcome: string): Promise<OutcomeResult>;
  /** Retention: delete this customer's decisions older than `retentionDays`. Returns rows deleted. */
  purgeExpired(customerId: string, retentionDays: number, now: Date): Promise<number>;
}

export interface VersionedConfig {
  version: number;
  config: StudyConfig;
}

export interface StudyConfigRepo {
  latest(customerId: string, studyId: string): Promise<VersionedConfig | null>;
  /** Stores a new version (previous versions are kept) and returns it. */
  save(customerId: string, config: StudyConfig): Promise<VersionedConfig>;
}

export interface Customer {
  id: string;
  name: string;
  retentionDays: number;
}

export interface ApiKeyRepo {
  resolve(rawKey: string): Promise<Customer | null>;
}

export interface Store {
  decisions: DecisionLog;
  configs: StudyConfigRepo;
  apiKeys: ApiKeyRepo;
  close(): Promise<void>;
}
