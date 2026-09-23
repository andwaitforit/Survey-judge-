import { z } from 'zod';
import { CHECK_NAMES, FAMILY_COUNT } from './types.js';

const unit = z.number().min(0).max(1);
const checkName = z.enum(CHECK_NAMES);
/** Only known check names are accepted: an AI-authorship score can never become a deciding check. */
const checkThresholds = z.partialRecord(checkName, unit);

export const DEFAULT_CLARIFY_PROMPT =
  'Thanks! Could you tell us a little more, in your own words?';

export const StudyConfigSchema = z.strictObject({
  studyId: z.string().min(1).max(128),
  /** Shadow is the default for every study: compute and log, return keep. */
  mode: z.enum(['shadow', 'enforce']).default('shadow'),
  thresholds: z
    .strictObject({
      clarify: checkThresholds.default({}),
      flag: checkThresholds.default({}),
      replace: z
        .strictObject({
          /**
           * Minimum number of independent checks (distinct evidence families, see CHECK_FAMILY) that
           * must agree. Floor of 2: one line of evidence never replaces.
           */
          requireChecks: z.number().int().min(2).max(FAMILY_COUNT).default(2),
          /** Each agreeing check needs confidence strictly above this. */
          minConfidence: unit.default(0.9),
          /** Optional stricter per-check thresholds for replace; defaults to the flag thresholds. */
          checks: checkThresholds.optional(),
        })
        .default({ requireChecks: 2, minConfidence: 0.9 }),
    })
    .default({ clarify: {}, flag: {}, replace: { requireChecks: 2, minConfidence: 0.9 } }),
  /**
   * Confidence floors. A flag trip below `flag` is downgraded to a clarify trip; any trip below
   * `clarify` is ignored. This is how "low confidence resolves toward keep" is made concrete.
   */
  confidenceFloors: z
    .strictObject({ clarify: unit.default(0.5), flag: unit.default(0.6) })
    .default({ clarify: 0.5, flag: 0.6 }),
  clarifyPrompts: z.partialRecord(checkName, z.string().min(1).max(500)).default({}),
  defaultClarifyPrompt: z.string().min(1).max(500).default(DEFAULT_CLARIFY_PROMPT),
  maxClarifyPerSession: z.number().int().min(0).max(50).default(2),
});

export type StudyConfig = z.output<typeof StudyConfigSchema>;
export type StudyConfigInput = z.input<typeof StudyConfigSchema>;

export function parseStudyConfig(input: unknown): StudyConfig {
  return StudyConfigSchema.parse(input);
}
