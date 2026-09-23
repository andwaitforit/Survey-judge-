import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { parseStudyConfig, type StudyConfig } from '../policy/config.js';
import type { Action, CheckName, Mode } from '../policy/types.js';
import { hashApiKey } from './keys.js';
import type {
  CheckScores,
  Customer,
  DecisionRecord,
  OutcomeResult,
  SessionState,
  Store,
  VersionedConfig,
} from './types.js';

type DecisionRow = Awaited<ReturnType<PrismaClient['decision']['findFirstOrThrow']>>;

function toRecord(r: DecisionRow): DecisionRecord {
  return {
    ...r,
    checks: r.checks as CheckScores,
    action: r.action as Action,
    recommendedAction: r.recommendedAction as Action,
    mode: r.mode as Mode,
    missingChecks: r.missingChecks as CheckName[],
  };
}

export class PrismaStore implements Store {
  readonly db: PrismaClient;

  constructor(connectionString: string) {
    this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }

  readonly apiKeys = {
    resolve: async (rawKey: string): Promise<Customer | null> => {
      const key = await this.db.apiKey.findUnique({
        where: { keyHash: hashApiKey(rawKey) },
        include: { customer: true },
      });
      if (!key || key.revokedAt) return null;
      const { id, name, retentionDays } = key.customer;
      return { id, name, retentionDays };
    },
  };

  readonly configs = {
    latest: async (customerId: string, studyId: string): Promise<VersionedConfig | null> => {
      const row = await this.db.studyConfigVersion.findFirst({
        where: { customerId, studyId },
        orderBy: { version: 'desc' },
      });
      return row ? { version: row.version, config: parseStudyConfig(row.config) } : null;
    },
    save: async (customerId: string, config: StudyConfig): Promise<VersionedConfig> =>
      this.db.$transaction(async (tx) => {
        const last = await tx.studyConfigVersion.findFirst({
          where: { customerId, studyId: config.studyId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const version = (last?.version ?? 0) + 1;
        // The unique (customerId, studyId, version) index turns a concurrent save into an error, not a silent overwrite.
        await tx.studyConfigVersion.create({
          data: { id: randomUUID(), customerId, studyId: config.studyId, version, config },
        });
        return { version, config };
      }),
  };

  readonly decisions = {
    append: async (rec: DecisionRecord): Promise<void> => {
      await this.db.decision.create({ data: { ...rec, checks: rec.checks } });
    },
    sessionState: async (customerId: string, studyId: string, sessionId: string, questionId: string): Promise<SessionState> => {
      const rows = await this.db.decision.findMany({
        where: { customerId, studyId, sessionId, recommendedAction: 'clarify' },
        select: { questionId: true },
      });
      return {
        clarifiesUsedInSession: rows.length,
        questionAlreadyClarified: rows.some((r) => r.questionId === questionId),
      };
    },
    recentAnswers: async (customerId: string, studyId: string, questionId: string, excludeSessionId: string, limit: number): Promise<string[]> => {
      const rows = await this.db.decision.findMany({
        where: { customerId, studyId, questionId, sessionId: { not: excludeSessionId } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { answerText: true },
      });
      return rows.map((r) => r.answerText);
    },
    list: async (customerId: string, studyId: string, opts: { limit?: number } = {}): Promise<DecisionRecord[]> => {
      const rows = await this.db.decision.findMany({
        where: { customerId, studyId },
        orderBy: { createdAt: 'asc' },
        ...(opts.limit !== undefined ? { take: opts.limit } : {}),
      });
      return rows.map(toRecord);
    },
    recordOutcome: async (customerId: string, decisionId: string, outcome: string): Promise<OutcomeResult> => {
      const { count } = await this.db.decision.updateMany({
        where: { decisionId, customerId, finalOutcome: null },
        data: { finalOutcome: outcome },
      });
      if (count === 1) return 'recorded';
      const exists = await this.db.decision.findFirst({ where: { decisionId, customerId }, select: { decisionId: true } });
      return exists ? 'already_set' : 'not_found';
    },
    purgeExpired: async (customerId: string, retentionDays: number, now: Date): Promise<number> => {
      const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
      const { count } = await this.db.decision.deleteMany({ where: { customerId, createdAt: { lt: cutoff } } });
      return count;
    },
  };

  async close(): Promise<void> {
    await this.db.$disconnect();
  }
}
