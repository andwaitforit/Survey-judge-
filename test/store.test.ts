import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseStudyConfig } from '../src/policy/config.js';
import { CachedStudyConfigRepo } from '../src/store/cache.js';
import { hashApiKey, newDecisionId } from '../src/store/keys.js';
import { MemoryStore } from '../src/store/memory.js';
import type { DecisionRecord, Store } from '../src/store/types.js';

/**
 * Store contract. Always runs against MemoryStore. Also runs against Postgres when
 * TEST_DATABASE_URL points at a migrated database (never in the default offline run).
 */
interface StoreHarness {
  name: string;
  make(): Promise<{ store: Store; addKey(raw: string, customerId: string): Promise<void>; rawUpdate?(id: string): Promise<void> }>;
}

const memory: StoreHarness = {
  name: 'MemoryStore',
  make: async () => {
    const store = new MemoryStore();
    return {
      store,
      addKey: async (raw, customerId) => store.addApiKey(raw, { id: customerId, name: customerId, retentionDays: 90 }),
    };
  },
};

const harnesses: StoreHarness[] = [memory];
const pgUrl = process.env.TEST_DATABASE_URL;
if (pgUrl) {
  const { PrismaStore } = await import('../src/store/prisma.js');
  const shared = new PrismaStore(pgUrl);
  afterAll(() => shared.close());
  harnesses.push({
    name: 'PrismaStore (Postgres)',
    make: async () => {
      await shared.db.$executeRawUnsafe('TRUNCATE "Decision", "StudyConfigVersion", "ApiKey", "Customer"');
      return {
        store: shared,
        addKey: async (raw, customerId) => {
          await shared.db.customer.upsert({ where: { id: customerId }, update: {}, create: { id: customerId, name: customerId } });
          await shared.db.apiKey.create({ data: { id: randomUUID(), customerId, keyHash: hashApiKey(raw) } });
        },
        rawUpdate: async (id) => {
          await shared.db.$executeRawUnsafe(`UPDATE "Decision" SET "action" = 'replace' WHERE "decisionId" = $1`, id);
        },
      };
    },
  });
}

const rec = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  decisionId: newDecisionId(),
  customerId: 'c1',
  studyId: 's1',
  sessionId: 'R_1',
  questionId: 'Q1',
  answerText: 'it was good',
  provider: 'stub',
  modelVersion: 'v',
  configVersion: 1,
  checks: { relevance: { score: 0.4, confidence: 0.8 } },
  confidence: 0.8,
  action: 'keep',
  recommendedAction: 'clarify',
  mode: 'shadow',
  latencyMs: 12,
  clarified: false,
  providerError: null,
  missingChecks: [],
  finalOutcome: null,
  createdAt: new Date(),
  ...over,
});

describe.each(harnesses)('Store contract: $name', (h) => {
  let ctx: Awaited<ReturnType<StoreHarness['make']>>;
  beforeEach(async () => {
    ctx = await h.make();
  });

  it('resolves API keys by hash and rejects unknown keys', async () => {
    await ctx.addKey('sk_live_abc', 'c1');
    expect((await ctx.store.apiKeys.resolve('sk_live_abc'))?.id).toBe('c1');
    expect(await ctx.store.apiKeys.resolve('sk_live_nope')).toBeNull();
  });

  it('versions study configs and returns the latest', async () => {
    await ctx.addKey('k', 'c1');
    expect(await ctx.store.configs.latest('c1', 's1')).toBeNull();
    const a = await ctx.store.configs.save('c1', parseStudyConfig({ studyId: 's1' }));
    const b = await ctx.store.configs.save('c1', parseStudyConfig({ studyId: 's1', mode: 'enforce' }));
    expect([a.version, b.version]).toEqual([1, 2]);
    const latest = await ctx.store.configs.latest('c1', 's1');
    expect(latest?.version).toBe(2);
    expect(latest?.config.mode).toBe('enforce');
    expect(await ctx.store.configs.latest('c2', 's1')).toBeNull();
  });

  it('appends decisions and lists them per customer and study', async () => {
    await ctx.store.decisions.append(rec());
    await ctx.store.decisions.append(rec({ studyId: 's2' }));
    await ctx.store.decisions.append(rec({ customerId: 'c2' }));
    const rows = await ctx.store.decisions.list('c1', 's1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.checks).toEqual({ relevance: { score: 0.4, confidence: 0.8 } });
  });

  it('derives clarify budget and re-score state from the log', async () => {
    await ctx.store.decisions.append(rec({ questionId: 'Q1', recommendedAction: 'clarify' }));
    await ctx.store.decisions.append(rec({ questionId: 'Q2', recommendedAction: 'keep' }));
    expect(await ctx.store.decisions.sessionState('c1', 's1', 'R_1', 'Q1')).toEqual({
      clarifiesUsedInSession: 1,
      questionAlreadyClarified: true,
    });
    expect(await ctx.store.decisions.sessionState('c1', 's1', 'R_1', 'Q3')).toEqual({
      clarifiesUsedInSession: 1,
      questionAlreadyClarified: false,
    });
    expect((await ctx.store.decisions.sessionState('c1', 's1', 'R_2', 'Q1')).clarifiesUsedInSession).toBe(0);
  });

  it('sets finalOutcome exactly once, and only for the owning customer', async () => {
    const r = rec();
    await ctx.store.decisions.append(r);
    expect(await ctx.store.decisions.recordOutcome('c2', r.decisionId, 'removed')).toBe('not_found');
    expect(await ctx.store.decisions.recordOutcome('c1', r.decisionId, 'removed')).toBe('recorded');
    expect(await ctx.store.decisions.recordOutcome('c1', r.decisionId, 'kept')).toBe('already_set');
    expect((await ctx.store.decisions.list('c1', 's1'))[0]!.finalOutcome).toBe('removed');
  });

  it('purges decisions past the retention window only', async () => {
    const now = new Date('2026-09-23T00:00:00Z');
    await ctx.store.decisions.append(rec({ createdAt: new Date('2026-06-01T00:00:00Z') }));
    await ctx.store.decisions.append(rec({ createdAt: new Date('2026-09-01T00:00:00Z') }));
    expect(await ctx.store.decisions.purgeExpired('c1', 90, now)).toBe(1);
    expect(await ctx.store.decisions.list('c1', 's1')).toHaveLength(1);
  });

  it('rejects in-place edits of a logged decision (append-only)', async (t) => {
    if (!ctx.rawUpdate) return t.skip();
    const r = rec();
    await ctx.store.decisions.append(r);
    await expect(ctx.rawUpdate(r.decisionId)).rejects.toThrow(/append-only/);
  });
});

describe('CachedStudyConfigRepo', () => {
  it('serves from cache within the TTL and invalidates on save', async () => {
    const inner = new MemoryStore().configs;
    let calls = 0;
    const counting = { ...inner, latest: async (c: string, s: string) => (calls++, inner.latest(c, s)) };
    let t = 0;
    const repo = new CachedStudyConfigRepo(counting, 1000, () => t);
    await repo.latest('c', 's');
    await repo.latest('c', 's');
    expect(calls).toBe(1);
    await repo.save('c', parseStudyConfig({ studyId: 's' }));
    expect((await repo.latest('c', 's'))?.version).toBe(1);
    expect(calls).toBe(1);
    t = 5000;
    await repo.latest('c', 's');
    expect(calls).toBe(2);
  });
});
