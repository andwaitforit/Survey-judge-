import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/api/app.js';
import { StubProvider } from '../src/providers/stub.js';
import type { DecisionProvider } from '../src/providers/types.js';
import { MemoryStore } from '../src/store/memory.js';

const KEY = 'sk_test_c1';
const OTHER_KEY = 'sk_test_c2';

function setup(provider: DecisionProvider = new StubProvider(), store = new MemoryStore()) {
  store.addApiKey(KEY, { id: 'c1', name: 'Acme', retentionDays: 90 });
  store.addApiKey(OTHER_KEY, { id: 'c2', name: 'Other', retentionDays: 90 });
  const app = buildApp({ store, provider });
  apps.push(app);
  return { app, store };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

const body = (over: Record<string, unknown> = {}) => ({
  studyId: 'acme-q4-tracker',
  sessionId: 'R_abc123',
  questionId: 'Q7',
  questionText: 'Why did you choose Brand X?',
  answerText: 'it was good',
  priorAnswers: [{ questionId: 'Q3', answer: 'I have never bought Brand X' }],
  attributes: { languageGroup: 'en', ageBand: '25-34' },
  ...over,
});

const post = (app: FastifyInstance, url: string, payload: unknown, key = KEY) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: { authorization: `Bearer ${key}` } });

const enforce = (app: FastifyInstance, studyId = 'acme-q4-tracker', extra: Record<string, unknown> = {}) =>
  app.inject({
    method: 'PUT',
    url: `/v1/studies/${studyId}/config`,
    headers: { 'x-api-key': KEY },
    payload: {
      studyId,
      mode: 'enforce',
      thresholds: {
        clarify: { relevance: 0.55, specificity: 0.45 },
        flag: { relevance: 0.3, gibberish: 0.7, duplicate: 0.85 },
        replace: { requireChecks: 2, minConfidence: 0.9 },
      },
      clarifyPrompts: { specificity: 'Could you say a bit more about what made you choose it?' },
      maxClarifyPerSession: 2,
      ...extra,
    },
  });

describe('auth and health', () => {
  it('serves /health without a key', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true });
  });

  it('rejects missing and unknown API keys', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'POST', url: '/v1/score', payload: body() })).statusCode).toBe(401);
    expect((await post(app, '/v1/score', body(), 'sk_wrong')).statusCode).toBe(401);
  });

  it('accepts the key as a Bearer token or an x-api-key header', async () => {
    const { app } = setup();
    expect((await post(app, '/v1/score', body())).statusCode).toBe(200);
    const r = await app.inject({ method: 'POST', url: '/v1/score', payload: body(), headers: { 'x-api-key': KEY } });
    expect(r.statusCode).toBe(200);
  });
});

describe('POST /v1/score', () => {
  it('returns a typed decision, in shadow mode by default', async () => {
    const { app, store } = setup();
    const r = await post(app, '/v1/score', body({ answerText: 'asdfgh qwrtzp' }));
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.decisionId).toMatch(/^dec_[0-9a-f]{32}$/);
    expect(d.mode).toBe('shadow');
    expect(d.action).toBe('keep');
    expect(d.recommendedAction).toBe('flag');
    expect(d.configVersion).toBe(0);
    expect(d.clarifyPrompt).toBeUndefined();
    expect(Object.keys(d.checks).sort()).toHaveLength(8);
    expect(d.latencyMs).toBeLessThan(500);
    const logged = await store.decisions.list('c1', 'acme-q4-tracker');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ decisionId: d.decisionId, provider: 'stub', recommendedAction: 'flag', mode: 'shadow', configVersion: 0 });
    // Attributes are accepted but never persisted.
    expect(JSON.stringify(logged[0])).not.toContain('25-34');
  });

  it('rejects unknown fields rather than storing them', async () => {
    const { app } = setup();
    const r = await post(app, '/v1/score', { ...body(), respondentName: 'Jane Doe' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_request');
  });

  it('rejects unknown attributes and non-opaque session ids (e.g. an email)', async () => {
    const { app } = setup();
    expect((await post(app, '/v1/score', body({ attributes: { email: 'a@b.com' } }))).statusCode).toBe(400);
    expect((await post(app, '/v1/score', body({ sessionId: 'jane@example.com' }))).statusCode).toBe(400);
  });

  it('enforce mode: clarify once, then a re-score can only be keep or flag', async () => {
    const { app, store } = setup();
    expect((await enforce(app)).statusCode).toBe(201);
    const first = (await post(app, '/v1/score', body({ answerText: 'it was good' }))).json();
    expect(first.mode).toBe('enforce');
    expect(first.configVersion).toBe(1);
    expect(first.action).toBe('clarify');
    expect(first.clarifyPrompt).toBe('Could you say a bit more about what made you choose it?');
    const second = (await post(app, '/v1/score', body({ answerText: 'it was nice' }))).json();
    expect(['keep', 'flag']).toContain(second.action);
    const rows = await store.decisions.list('c1', 'acme-q4-tracker');
    expect(rows.map((r) => r.clarified)).toEqual([false, true]);
  });

  it('enforce mode: the session clarify budget caps clarifies across questions', async () => {
    const { app } = setup();
    await enforce(app);
    const actions: string[] = [];
    for (const q of ['Q1', 'Q2', 'Q3']) {
      actions.push((await post(app, '/v1/score', body({ questionId: q, answerText: 'fine' }))).json().action);
    }
    expect(actions).toEqual(['clarify', 'clarify', 'keep']);
  });

  it('fails open to keep, within budget, when the provider hangs', async () => {
    const hang: DecisionProvider = { name: 'hang', modelVersion: '0', scoreBatch: () => new Promise(() => undefined) };
    const { app, store } = setup(hang);
    await enforce(app);
    const t0 = performance.now();
    const r = await post(app, '/v1/score', body({ answerText: 'asdfgh' }));
    expect(performance.now() - t0).toBeLessThan(600);
    expect(r.json()).toMatchObject({ action: 'keep', degraded: true, checks: {} });
    const [row] = await store.decisions.list('c1', 'acme-q4-tracker');
    expect(row!.providerError).toMatch(/timeout/);
    expect(row!.missingChecks).toHaveLength(8);
  });

  it('fails open to keep when the provider throws', async () => {
    const boom: DecisionProvider = { name: 'boom', modelVersion: '0', scoreBatch: async () => { throw new Error('500 from vendor'); } };
    const { app } = setup(boom);
    await enforce(app);
    expect((await post(app, '/v1/score', body({ answerText: 'asdfgh' }))).json()).toMatchObject({ action: 'keep', degraded: true });
  });

  it('fails open when the store is down (reads and log write fail)', async () => {
    const store = new MemoryStore();
    const broken = new Error('db down');
    store.decisions.sessionState = async () => { throw broken; };
    store.decisions.recentAnswers = async () => { throw broken; };
    store.decisions.append = async () => { throw broken; };
    store.configs.latest = async () => { throw broken; };
    const { app } = setup(new StubProvider(), store);
    const r = await post(app, '/v1/score', body({ answerText: 'it was good' }));
    expect(r.statusCode).toBe(200);
    expect(r.json().action).toBe('keep');
  });

  it('uses other sessions’ answers to the same question as the duplicate peer sample', async () => {
    const { app } = setup();
    const text = 'This product is very good and I would recommend it to everyone I know.';
    await post(app, '/v1/score', body({ sessionId: 'R_1', answerText: text }));
    const d = (await post(app, '/v1/score', body({ sessionId: 'R_2', answerText: text }))).json();
    expect(d.checks.duplicate).toBeGreaterThan(0.85);
    expect(d.recommendedAction).toBe('flag');
  });

  it('keeps p95 latency under 500 ms against the stub provider', async () => {
    const { app } = setup();
    const latencies: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      const r = await post(app, '/v1/score', body({ sessionId: `R_${i % 40}`, questionId: `Q${i % 5}`, answerText: `answer number ${i} about the price and delivery` }));
      latencies.push(performance.now() - t0);
      expect(r.statusCode).toBe(200);
    }
    latencies.sort((a, b) => a - b);
    expect(latencies[Math.ceil(0.95 * latencies.length) - 1]).toBeLessThan(500);
  });
});

describe('POST /v1/score/batch', () => {
  it('scores items in request order and logs each', async () => {
    const { app, store } = setup();
    const items = [
      body({ sessionId: 'R_1', questionId: 'Q1', answerText: 'asdfgh qwrtzp' }),
      body({ sessionId: 'R_2', questionId: 'Q1', answerText: 'The price was 20% lower than other brands and it arrived in two days' }),
      body({ sessionId: 'R_1', questionId: 'Q2', answerText: 'good' }),
    ];
    const r = await post(app, '/v1/score/batch', { items });
    expect(r.statusCode).toBe(200);
    const { results } = r.json();
    expect(results).toHaveLength(3);
    expect(results[0].recommendedAction).toBe('flag');
    expect(results[1].recommendedAction).toBe('keep');
    expect(await store.decisions.list('c1', 'acme-q4-tracker')).toHaveLength(3);
  });

  it('validates every item', async () => {
    const { app } = setup();
    expect((await post(app, '/v1/score/batch', { items: [{ ...body(), extra: 1 }] })).statusCode).toBe(400);
    expect((await post(app, '/v1/score/batch', { items: [] })).statusCode).toBe(400);
  });
});

describe('GET /v1/decisions (CSV export)', () => {
  it('exports the log as CSV, neutralising spreadsheet formulas, scoped to the customer', async () => {
    const { app } = setup();
    await post(app, '/v1/score', body({ answerText: '=HYPERLINK("http://evil","click")' }));
    await post(app, '/v1/score', body({ sessionId: 'R_other' }), OTHER_KEY);
    const r = await app.inject({ method: 'GET', url: '/v1/decisions?studyId=acme-q4-tracker', headers: { 'x-api-key': KEY } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    const lines = r.body.trim().split('\r\n');
    expect(lines[0]).toMatch(/^decisionId,createdAt,studyId,sessionId,questionId,answerText,/);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(r.body).not.toContain('R_other');
  });

  it('requires studyId', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/v1/decisions', headers: { 'x-api-key': KEY } })).statusCode).toBe(400);
  });
});

describe('outcomes and study config', () => {
  it('records a final outcome once', async () => {
    const { app } = setup();
    const { decisionId } = (await post(app, '/v1/score', body())).json();
    const url = `/v1/decisions/${decisionId}/outcome`;
    expect((await post(app, url, { outcome: 'removed_in_cleaning' })).statusCode).toBe(200);
    expect((await post(app, url, { outcome: 'kept' })).statusCode).toBe(409);
    expect((await post(app, url, { outcome: 'kept' }, OTHER_KEY)).statusCode).toBe(404);
  });

  it('returns the default shadow config for an unconfigured study, and versions saved configs', async () => {
    const { app } = setup();
    const get = () => app.inject({ method: 'GET', url: '/v1/studies/acme-q4-tracker/config', headers: { 'x-api-key': KEY } });
    expect((await get()).json()).toMatchObject({ version: 0, config: { mode: 'shadow' } });
    await enforce(app);
    await enforce(app);
    expect((await get()).json()).toMatchObject({ version: 2, config: { mode: 'enforce' } });
  });

  it('rejects configs that name a non-product check or mismatch the URL', async () => {
    const { app } = setup();
    expect((await enforce(app, 'acme-q4-tracker', { thresholds: { flag: { aiWritten: 0.5 } } })).statusCode).toBe(400);
    const r = await app.inject({
      method: 'PUT',
      url: '/v1/studies/other/config',
      headers: { 'x-api-key': KEY },
      payload: { studyId: 'acme-q4-tracker' },
    });
    expect(r.statusCode).toBe(400);
  });
});
