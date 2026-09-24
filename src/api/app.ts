import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { StudyConfigSchema } from '../policy/config.js';
import type { DecisionProvider } from '../providers/types.js';
import type { Customer, Store } from '../store/types.js';
import { toCsv } from './csv.js';
import {
  BatchRequestSchema,
  DecisionsQuerySchema,
  OutcomeRequestSchema,
  ScoreRequestSchema,
  type ScoreRequest,
  type ScoreResponse,
} from './schemas.js';
import { defaultStudyConfig, scoreAnswer } from './score-service.js';

export interface AppOptions {
  store: Store;
  provider: DecisionProvider;
  logger?: boolean | { level: string };
  /** Total per-request budget for /v1/score. p95 target is 500 ms; the default leaves headroom. */
  scoreBudgetMs?: number;
  /** Per-item budget for /v1/score/batch (post-field replay, no live respondent waiting). */
  batchItemBudgetMs?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    customer?: Customer;
  }
}

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: 'invalid_request', issues: z.treeifyError(error) });
}

function apiKeyFrom(req: FastifyRequest): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const x = req.headers['x-api-key'];
  return typeof x === 'string' ? x : undefined;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  const { store, provider } = opts;
  const scoreBudgetMs = opts.scoreBudgetMs ?? 450;
  const batchItemBudgetMs = opts.batchItemBudgetMs ?? 5000;

  app.get('/health', async () => ({ ok: true }));

  app.register(async (v1) => {
    v1.addHook('onRequest', async (req, reply) => {
      const key = apiKeyFrom(req);
      const customer = key ? await store.apiKeys.resolve(key).catch(() => null) : null;
      if (!customer) return reply.code(401).send({ error: 'unauthorized' });
      req.customer = customer;
    });

    v1.post('/score', async (req, reply) => {
      const parsed = ScoreRequestSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error);
      try {
        return await scoreAnswer({ store, provider, log: req.log }, req.customer!, parsed.data, {
          budgetMs: scoreBudgetMs,
        });
      } catch (err) {
        // Last line of fail-open: never block a survey on a bug in our code.
        req.log.error({ err }, 'score failed unexpectedly; returning keep');
        return {
          decisionId: null,
          action: 'keep',
          checks: {},
          confidence: 0,
          mode: 'shadow',
          recommendedAction: 'keep',
          configVersion: null,
          degraded: true,
          latencyMs: null,
        };
      }
    });

    v1.post('/score/batch', async (req, reply) => {
      const parsed = BatchRequestSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error);
      const items = parsed.data.items;
      // Items in one session run in order (clarify state depends on earlier answers). Sessions run in parallel.
      const bySession = new Map<string, number[]>();
      items.forEach((it, i) => bySession.set(it.sessionId, [...(bySession.get(it.sessionId) ?? []), i]));
      const results: ScoreResponse[] = new Array(items.length);
      const groups = [...bySession.values()];
      let next = 0;
      const worker = async () => {
        while (next < groups.length) {
          for (const i of groups[next++]!) {
            results[i] = await scoreAnswer({ store, provider, log: req.log }, req.customer!, items[i] as ScoreRequest, {
              budgetMs: batchItemBudgetMs,
            });
          }
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      return { results };
    });

    v1.get('/decisions', async (req, reply) => {
      const parsed = DecisionsQuerySchema.safeParse(req.query);
      if (!parsed.success) return badRequest(reply, parsed.error);
      const rows = await store.decisions.list(req.customer!.id, parsed.data.studyId, {
        ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      });
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="decisions-${parsed.data.studyId}.csv"`)
        .send(toCsv(rows));
    });

    v1.post<{ Params: { decisionId: string } }>('/decisions/:decisionId/outcome', async (req, reply) => {
      const parsed = OutcomeRequestSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error);
      const result = await store.decisions.recordOutcome(req.customer!.id, req.params.decisionId, parsed.data.outcome);
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (result === 'already_set') return reply.code(409).send({ error: 'outcome_already_set' });
      return { ok: true };
    });

    v1.get<{ Params: { studyId: string } }>('/studies/:studyId/config', async (req) => {
      const v = await store.configs.latest(req.customer!.id, req.params.studyId);
      return v ?? { version: 0, config: defaultStudyConfig(req.params.studyId) };
    });

    v1.put<{ Params: { studyId: string } }>('/studies/:studyId/config', async (req, reply) => {
      const parsed = StudyConfigSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error);
      if (parsed.data.studyId !== req.params.studyId) {
        return reply.code(400).send({ error: 'studyId in body must match the URL' });
      }
      return reply.code(201).send(await store.configs.save(req.customer!.id, parsed.data));
    });
  }, { prefix: '/v1' });

  return app;
}
