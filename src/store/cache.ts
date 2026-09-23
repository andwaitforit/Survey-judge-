import type { StudyConfig } from '../policy/config.js';
import type { StudyConfigRepo, VersionedConfig } from './types.js';

/**
 * Read-through TTL cache for study configs: /v1/score must not pay a DB round trip per call.
 * `save` invalidates immediately. Other instances pick up a change within `ttlMs`.
 */
export class CachedStudyConfigRepo implements StudyConfigRepo {
  private readonly cache = new Map<string, { at: number; value: VersionedConfig | null }>();

  constructor(
    private readonly inner: StudyConfigRepo,
    private readonly ttlMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  async latest(customerId: string, studyId: string): Promise<VersionedConfig | null> {
    const key = `${customerId}/${studyId}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = await this.inner.latest(customerId, studyId);
    this.cache.set(key, { at: this.now(), value });
    return value;
  }

  async save(customerId: string, config: StudyConfig): Promise<VersionedConfig> {
    const v = await this.inner.save(customerId, config);
    this.cache.set(`${customerId}/${config.studyId}`, { at: this.now(), value: v });
    return v;
  }
}
