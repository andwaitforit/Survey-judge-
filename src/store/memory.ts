import type { StudyConfig } from '../policy/config.js';
import { hashApiKey } from './keys.js';
import type {
  Customer,
  DecisionRecord,
  OutcomeResult,
  SessionState,
  Store,
  VersionedConfig,
} from './types.js';

/** In-process store for tests and for `pnpm dev` without a database. Same semantics as Prisma. */
export class MemoryStore implements Store {
  private readonly rows: DecisionRecord[] = [];
  private readonly configVersions = new Map<string, VersionedConfig[]>();
  private readonly keys = new Map<string, Customer>();

  addApiKey(rawKey: string, customer: Customer): void {
    this.keys.set(hashApiKey(rawKey), customer);
  }

  readonly apiKeys = {
    resolve: async (rawKey: string): Promise<Customer | null> => this.keys.get(hashApiKey(rawKey)) ?? null,
  };

  readonly configs = {
    latest: async (customerId: string, studyId: string): Promise<VersionedConfig | null> =>
      this.configVersions.get(`${customerId}/${studyId}`)?.at(-1) ?? null,
    save: async (customerId: string, config: StudyConfig): Promise<VersionedConfig> => {
      const key = `${customerId}/${config.studyId}`;
      const list = this.configVersions.get(key) ?? [];
      const v = { version: list.length + 1, config: structuredClone(config) };
      list.push(v);
      this.configVersions.set(key, list);
      return v;
    },
  };

  readonly decisions = {
    append: async (rec: DecisionRecord): Promise<void> => {
      if (this.rows.some((r) => r.decisionId === rec.decisionId)) throw new Error('duplicate decisionId');
      this.rows.push(structuredClone(rec));
    },
    sessionState: async (customerId: string, studyId: string, sessionId: string, questionId: string): Promise<SessionState> => {
      const session = this.rows.filter(
        (r) => r.customerId === customerId && r.studyId === studyId && r.sessionId === sessionId,
      );
      const clarifies = session.filter((r) => r.recommendedAction === 'clarify');
      return {
        clarifiesUsedInSession: clarifies.length,
        questionAlreadyClarified: clarifies.some((r) => r.questionId === questionId),
      };
    },
    recentAnswers: async (customerId: string, studyId: string, questionId: string, excludeSessionId: string, limit: number): Promise<string[]> =>
      this.rows
        .filter((r) => r.customerId === customerId && r.studyId === studyId && r.questionId === questionId && r.sessionId !== excludeSessionId)
        .slice(-limit)
        .reverse()
        .map((r) => r.answerText),
    list: async (customerId: string, studyId: string, opts: { limit?: number } = {}): Promise<DecisionRecord[]> =>
      this.rows
        .filter((r) => r.customerId === customerId && r.studyId === studyId)
        .slice(0, opts.limit ?? Infinity)
        .map((r) => structuredClone(r)),
    recordOutcome: async (customerId: string, decisionId: string, outcome: string): Promise<OutcomeResult> => {
      const row = this.rows.find((r) => r.decisionId === decisionId && r.customerId === customerId);
      if (!row) return 'not_found';
      if (row.finalOutcome !== null) return 'already_set';
      row.finalOutcome = outcome;
      return 'recorded';
    },
    purgeExpired: async (customerId: string, retentionDays: number, now: Date): Promise<number> => {
      const cutoff = now.getTime() - retentionDays * 86_400_000;
      let n = 0;
      for (let i = this.rows.length - 1; i >= 0; i--) {
        const r = this.rows[i]!;
        if (r.customerId === customerId && r.createdAt.getTime() < cutoff) {
          this.rows.splice(i, 1);
          n++;
        }
      }
      return n;
    },
  };

  async close(): Promise<void> {}
}
