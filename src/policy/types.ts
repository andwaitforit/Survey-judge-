/**
 * Core vocabulary shared by providers, the policy engine and the API.
 * Changing ACTIONS or CHECK_NAMES is a product decision (see docs/PRODUCT.md) — stop and ask.
 */
export const ACTIONS = ['keep', 'clarify', 'flag', 'replace'] as const;
export type Action = (typeof ACTIONS)[number];

export const CHECK_NAMES = [
  'relevance',
  'specificity',
  'coherence',
  'contradiction',
  'gibberish',
  'boilerplate',
  'duplicate',
  'effort',
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

/**
 * Polarity of each check's score.
 * - `quality`: higher is better; a threshold trips when score < threshold.
 * - `risk`: higher is worse; a threshold trips when score > threshold.
 * Matches the PRODUCT.md example (`flag.relevance: 0.30` is a floor, `flag.gibberish: 0.70` a ceiling).
 */
export const CHECK_POLARITY: Record<CheckName, 'quality' | 'risk'> = {
  relevance: 'quality',
  specificity: 'quality',
  coherence: 'quality',
  effort: 'quality',
  contradiction: 'risk',
  gibberish: 'risk',
  boilerplate: 'risk',
  duplicate: 'risk',
};

/**
 * Evidence families. `replace` needs agreement from `requireChecks` *independent* checks. Checks
 * that read the same answer text for the same kind of weakness are correlated: keyboard mash trips
 * gibberish, relevance, coherence and effort together. So agreement is counted per family.
 */
export const CHECK_FAMILY: Record<CheckName, 'content' | 'consistency' | 'duplicate' | 'boilerplate'> = {
  relevance: 'content',
  specificity: 'content',
  coherence: 'content',
  gibberish: 'content',
  effort: 'content',
  contradiction: 'consistency',
  duplicate: 'duplicate',
  boilerplate: 'boilerplate',
};
export const FAMILY_COUNT = new Set(Object.values(CHECK_FAMILY)).size;

export interface CheckResult {
  check: CheckName;
  /** 0..1 */
  score: number;
  /** 0..1, calibrated where the provider supports it */
  confidence: number;
}

export type Mode = 'shadow' | 'enforce';
