import { z } from 'zod';
import { CHECK_NAMES, FAMILY_COUNT } from './types.js';

const unit = z.number().min(0).max(1);
const checkName = z.enum(CHECK_NAMES);
/** Only known check names are accepted: an AI-authorship score can never become a deciding check. */
const checkThresholds = z.partialRecord(checkName, unit);

export const DEFAULT_CLARIFY_PROMPT =
  'Thanks! Could you tell us a little more, in your own words?';

/** PRODUCT.md example thresholds. These are the defaults, so a config that omits thresholds still acts. */
export const DEFAULT_THRESHOLDS = {
  clarify: { relevance: 0.55, specificity: 0.45 },
  flag: { relevance: 0.3, gibberish: 0.7, duplicate: 0.85 },
  replace: { requireChecks: 2, minConfidence: 0.9 },
} as const;

export const StudyConfigSchema = z.strictObject({
  studyId: z.string().min(1).max(128),
  /** Shadow is the default for every study: compute and log, return keep. */
  mode: z.enum(['shadow', 'enforce']).default('shadow'),
  thresholds: z
    .strictObject({
      clarify: checkThresholds.default({ ...DEFAULT_THRESHOLDS.clarify }),
      flag: checkThresholds.default({ ...DEFAULT_THRESHOLDS.flag }),
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
        .default({ ...DEFAULT_THRESHOLDS.replace }),
    })
    .default({
      clarify: { ...DEFAULT_THRESHOLDS.clarify },
      flag: { ...DEFAULT_THRESHOLDS.flag },
      replace: { ...DEFAULT_THRESHOLDS.replace },
    }),
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
