import type { DecisionRecord } from '../store/types.js';
import { CHECK_NAMES } from '../policy/types.js';

export const CSV_COLUMNS = [
  'decisionId', 'createdAt', 'studyId', 'sessionId', 'questionId', 'answerText', 'provider', 'modelVersion',
  'configVersion', 'mode', 'action', 'recommendedAction', 'confidence', 'latencyMs', 'clarified',
  'providerError', 'missingChecks', 'finalOutcome',
  ...CHECK_NAMES.flatMap((c) => [`${c}.score`, `${c}.confidence`]),
] as const;

/**
 * RFC 4180 quoting, plus formula-injection defence. Answer text is written by respondents and
 * will be opened in Excel, so a leading = + - @ (or tab/CR) gets a leading apostrophe.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsvRow(r: DecisionRecord): string {
  const cells: unknown[] = [
    r.decisionId, r.createdAt, r.studyId, r.sessionId, r.questionId, r.answerText, r.provider, r.modelVersion,
    r.configVersion, r.mode, r.action, r.recommendedAction, r.confidence, r.latencyMs, r.clarified,
    r.providerError, r.missingChecks.join(';'), r.finalOutcome,
    ...CHECK_NAMES.flatMap((c) => [r.checks[c]?.score, r.checks[c]?.confidence]),
  ];
  return cells.map(csvCell).join(',');
}

export function toCsv(rows: readonly DecisionRecord[]): string {
  return [CSV_COLUMNS.join(','), ...rows.map(toCsvRow)].join('\r\n') + '\r\n';
}
