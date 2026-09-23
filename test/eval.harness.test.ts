import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDataset } from '../src/eval/dataset.js';
import { runEval } from '../src/eval/harness.js';
import { renderReport } from '../src/eval/report.js';
import { parseStudyConfig } from '../src/policy/config.js';
import { CHECK_NAMES } from '../src/policy/types.js';
import { StubProvider } from '../src/providers/stub.js';
import type { DecisionProvider } from '../src/providers/types.js';

const config = parseStudyConfig({
  studyId: 'eval',
  thresholds: {
    clarify: { relevance: 0.55, specificity: 0.45 },
    flag: { relevance: 0.3, gibberish: 0.7, duplicate: 0.85 },
    replace: { requireChecks: 2, minConfidence: 0.9 },
  },
});

describe('parseDataset', () => {
  it('parses JSONL, skipping blank lines and comments', () => {
    const rows = parseDataset(
      [
        '{"id":"a","questionText":"q","answerText":"x","label":"keep"}',
        '',
        '# comment',
        '{"id":"b","questionText":"q","answerText":"y","label":"flag","attributes":{"languageGroup":"en"}}',
      ].join('\n'),
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows[0]!.priorAnswers).toEqual([]);
  });

  it('reports the line number of a bad row', () => {
    expect(() => parseDataset('{"id":"a","questionText":"q","answerText":"x","label":"delete"}')).toThrow(/line 1/);
  });

  it('rejects duplicate ids', () => {
    const line = '{"id":"a","questionText":"q","answerText":"x","label":"keep"}';
    expect(() => parseDataset(`${line}\n${line}`)).toThrow(/duplicate id/);
  });
});

describe('runEval', () => {
  it('replays every row and uses the recommended action even for shadow configs', async () => {
    const rows = parseDataset(
      [
        '{"id":"1","questionText":"Why did you choose Brand X?","answerText":"asdfgh qwrtzp","label":"flag"}',
        '{"id":"2","questionText":"Why did you choose Brand X?","answerText":"The price was about 20% lower than other brands I compared and delivery was fast","label":"keep"}',
      ].join('\n'),
    );
    const result = await runEval(rows, new StubProvider(), config);
    expect(config.mode).toBe('shadow');
    expect(result.predictions).toHaveLength(2);
    expect(result.predictions.find((p) => p.id === '1')!.predicted).toBe('flag');
    expect(result.predictions.find((p) => p.id === '2')!.predicted).toBe('keep');
    expect(result.provider).toEqual({ name: 'stub', modelVersion: 'stub-heuristics-1' });
  });

  it('supplies other answers to the same question as peers, so duplicates are detectable', async () => {
    const seen: (string[] | undefined)[] = [];
    const spy: DecisionProvider = {
      name: 'spy',
      modelVersion: '0',
      scoreBatch: async (req) => {
        seen.push(req.state.peerAnswers);
        return [];
      },
    };
    const rows = parseDataset(
      [
        '{"id":"1","questionText":"Q1","answerText":"a","label":"keep"}',
        '{"id":"2","questionText":"Q1","answerText":"b","label":"keep"}',
        '{"id":"3","questionText":"Q2","answerText":"c","label":"keep"}',
      ].join('\n'),
    );
    await runEval(rows, spy, config);
    expect(seen[0]).toEqual(['b']);
    expect(seen[2]).toEqual([]);
  });

  it('counts provider failures and resolves them to keep', async () => {
    const broken: DecisionProvider = {
      name: 'broken',
      modelVersion: '0',
      scoreBatch: async () => {
        throw new Error('down');
      },
    };
    const rows = parseDataset('{"id":"1","questionText":"q","answerText":"zzzz","label":"flag"}');
    const r = await runEval(rows, broken, config);
    expect(r.predictions[0]!.predicted).toBe('keep');
    expect(r.providerErrors).toBe(1);
  });

  it('raises the bias warning end to end', async () => {
    // Fake provider: replace-level scores (two independent families) for any answer containing "ZZ".
    const fake: DecisionProvider = {
      name: 'fake',
      modelVersion: '0',
      scoreBatch: async (req) =>
        req.state.answerText.includes('ZZ')
          ? [
              { check: 'gibberish', score: 0.99, confidence: 0.99 },
              { check: 'duplicate', score: 0.99, confidence: 0.99 },
            ]
          : CHECK_NAMES.map((check) => ({ check, score: check === 'relevance' || check === 'specificity' || check === 'coherence' || check === 'effort' ? 0.9 : 0.05, confidence: 0.9 })),
    };
    const lines = [
      ...Array.from({ length: 9 }, (_, i) => `{"id":"en${i}","questionText":"q","answerText":"fine answer ${i}","label":"keep","attributes":{"languageGroup":"en"}}`),
      '{"id":"en9","questionText":"q","answerText":"ZZ","label":"replace","attributes":{"languageGroup":"en"}}',
      '{"id":"es0","questionText":"q","answerText":"ZZ one","label":"replace","attributes":{"languageGroup":"es"}}',
      '{"id":"es1","questionText":"q","answerText":"ZZ two","label":"keep","attributes":{"languageGroup":"es"}}',
    ];
    const r = await runEval(parseDataset(lines.join('\n')), fake, config);
    expect(r.bias.warnings.map((w) => w.group)).toEqual(['es']);
    const text = renderReport(r);
    expect(text).toMatch(/WARNING/);
    expect(text).toMatch(/languageGroup=es/);
  });
});

describe('renderReport on the shipped fixture', () => {
  it('prints precision, recall, FPR and calibration at several thresholds', async () => {
    const rows = parseDataset(readFileSync(new URL('./fixtures/labeled-sample.jsonl', import.meta.url), 'utf8'));
    expect(rows.length).toBeGreaterThanOrEqual(60);
    const r = await runEval(rows, new StubProvider(), config);
    const text = renderReport(r);
    for (const needle of ['precision', 'recall', 'FPR', 'ECE', 'Threshold sweep', 'Calibration', 'Bias guardrail']) {
      expect(text).toContain(needle);
    }
    expect(r.sweep.length).toBeGreaterThanOrEqual(4);
  });
});

describe('regression guard: the expensive error', () => {
  it('never recommends replace for a keep-labelled answer in the shipped fixture', async () => {
    const rows = parseDataset(readFileSync(new URL('./fixtures/labeled-sample.jsonl', import.meta.url), 'utf8'));
    const recommended = parseStudyConfig(
      JSON.parse(readFileSync(new URL('./fixtures/study-config.recommended.json', import.meta.url), 'utf8')),
    );
    for (const cfg of [config, recommended]) {
      const r = await runEval(rows, new StubProvider(), cfg);
      expect(r.sweep[0]!.keepLabelledReplaced).toBe(0);
      expect(r.sweep[0]!.intervention.fpr).toBe(0);
    }
  });
});
