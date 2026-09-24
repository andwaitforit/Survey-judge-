import { z } from 'zod';
import type { ACTIONS, CHECK_NAMES } from '../policy/types.js';

/**
 * Every boundary is strict: unknown fields are rejected, never stored (ARCHITECTURE.md → Privacy).
 * `sessionId` must be an opaque platform identifier. Anything that looks like an email is refused.
 */
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_\-:.]+$/, 'must be an opaque identifier (letters, digits, _ - : .)');

const shortLabel = z.string().min(1).max(32).regex(/^[\p{L}\p{N}_\-+ ]+$/u, 'must be a short label');

export const ScoreRequestSchema = z.strictObject({
  studyId: id,
  sessionId: id,
  questionId: id,
  questionText: z.string().min(1).max(2000),
  answerText: z.string().max(5000),
  priorAnswers: z
    .array(
      z.strictObject({
        questionId: id,
        /** Optional: lets the contradiction check see what was asked. */
        questionText: z.string().max(2000).optional(),
        answer: z.string().max(5000),
      }),
    )
    .max(50)
    .default([]),
  /** Only these three coarse attributes are accepted. They are not persisted (see DECISIONS.md). */
  attributes: z
    .strictObject({ languageGroup: shortLabel.optional(), region: shortLabel.optional(), ageBand: shortLabel.optional() })
    .optional(),
});
export type ScoreRequest = z.output<typeof ScoreRequestSchema>;

export const BatchRequestSchema = z.strictObject({
  items: z.array(ScoreRequestSchema).min(1).max(500),
});

export const OutcomeRequestSchema = z.strictObject({
  outcome: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

export const DecisionsQuerySchema = z.strictObject({
  studyId: id,
  limit: z.coerce.number().int().min(1).max(100_000).optional(),
});

export interface ScoreResponse {
  decisionId: string;
  action: (typeof ACTIONS)[number];
  clarifyPrompt?: string;
  checks: Partial<Record<(typeof CHECK_NAMES)[number], number>>;
  confidence: number;
  mode: 'shadow' | 'enforce';
  /** What enforce mode would return. Equals `action` in enforce mode. */
  recommendedAction: (typeof ACTIONS)[number];
  configVersion: number;
  /** True when the provider failed or some checks are missing. The action then leans toward keep. */
  degraded: boolean;
  latencyMs: number;
}
