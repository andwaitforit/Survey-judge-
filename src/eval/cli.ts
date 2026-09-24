import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseStudyConfig, type StudyConfig } from '../policy/config.js';
import { createProvider } from '../providers/factory.js';
import { parseDataset } from './dataset.js';
import { runEval } from './harness.js';
import { renderReport } from './report.js';

/** The PRODUCT.md example thresholds. Used when no --config is given. */
export const DEFAULT_EVAL_CONFIG: StudyConfig = parseStudyConfig({ studyId: 'eval-default' });

/** Accept `fixtures/x.jsonl` as shorthand for `test/fixtures/x.jsonl` (the path CLAUDE.md uses). */
function resolveDataset(p: string): string {
  const candidates = [resolve(p), resolve('test', p)];
  const hit = candidates.find((c) => existsSync(c));
  if (!hit) throw new Error(`dataset not found: tried ${candidates.join(', ')}`);
  return hit;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      provider: { type: 'string', default: 'stub' },
      config: { type: 'string' },
      json: { type: 'boolean', default: false },
      'timeout-ms': { type: 'string', default: '450' },
    },
  });
  const path = resolveDataset(positionals[0] ?? 'fixtures/labeled-sample.jsonl');
  const rows = parseDataset(readFileSync(path, 'utf8'));
  const config = values.config
    ? parseStudyConfig(JSON.parse(readFileSync(values.config, 'utf8')))
    : DEFAULT_EVAL_CONFIG;
  const provider = createProvider(values.provider ?? 'stub', process.env);
  const result = await runEval(rows, provider, config, { timeoutMs: Number(values['timeout-ms']) });
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ ...result, predictions: undefined }, null, 2)}\n`);
  } else {
    process.stdout.write(`dataset ${path}\n${renderReport(result)}\n`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
