import { z } from 'zod';
import { ACTIONS } from '../policy/types.js';

export const EvalRowSchema = z.strictObject({
  id: z.string().min(1),
  questionText: z.string(),
  answerText: z.string(),
  label: z.enum(ACTIONS),
  priorAnswers: z.array(z.strictObject({ question: z.string(), answer: z.string() })).default([]),
  studyContext: z.string().optional(),
  /** If absent, the harness uses other rows' answers to the same question. */
  peerAnswers: z.array(z.string()).optional(),
  /** Respondent attributes for the bias guardrail (languageGroup, region, ageBand, ...). */
  attributes: z.record(z.string(), z.string()).default({}),
  /** Free-text note on why the label was chosen. Ignored by the harness. */
  note: z.string().optional(),
});

export type EvalRow = z.output<typeof EvalRowSchema>;

/** Parse JSONL. Blank lines and lines starting with `#` are skipped. Errors name the line number. */
export function parseDataset(text: string): EvalRow[] {
  const rows: EvalRow[] = [];
  const ids = new Set<string>();
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`line ${i + 1}: invalid JSON (${(err as Error).message})`, { cause: err });
    }
    const parsed = EvalRowSchema.safeParse(json);
    if (!parsed.success) throw new Error(`line ${i + 1}: ${z.prettifyError(parsed.error)}`);
    if (ids.has(parsed.data.id)) throw new Error(`line ${i + 1}: duplicate id "${parsed.data.id}"`);
    ids.add(parsed.data.id);
    rows.push(parsed.data);
  });
  return rows;
}
