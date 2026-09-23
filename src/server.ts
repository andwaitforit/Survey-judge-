import { buildApp } from './api/app.js';
import { createProvider } from './providers/factory.js';
import { newApiKey } from './store/keys.js';
import { MemoryStore } from './store/memory.js';
import type { Store } from './store/types.js';

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  const provider = createProvider(process.env.PROVIDER ?? 'stub', process.env);

  let store: Store;
  let devKey: string | undefined;
  if (process.env.DATABASE_URL) {
    const { PrismaStore } = await import('./store/prisma.js');
    store = new PrismaStore(process.env.DATABASE_URL);
  } else {
    // No database: an in-memory store with one dev customer. Data is lost on restart.
    const mem = new MemoryStore();
    devKey = process.env.DEV_API_KEY ?? newApiKey();
    mem.addApiKey(devKey, { id: 'dev', name: 'dev', retentionDays: 90 });
    store = mem;
  }

  const app = buildApp({ store, provider, logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  app.addHook('onClose', () => store.close());
  await app.listen({ port, host });
  app.log.info({ provider: provider.name, modelVersion: provider.modelVersion }, 'provider ready');
  if (devKey) app.log.warn(`No DATABASE_URL: using the in-memory store. Dev API key: ${devKey}`);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => void app.close());
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
