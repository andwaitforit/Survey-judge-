/**
 * Server entrypoint. Vercel's Fastify preset detects the app by finding a file that imports
 * `fastify` and calls `listen()`, so the instance is created here rather than inside buildApp().
 */
import Fastify from 'fastify';
import { registerRoutes, SERVER_OPTIONS } from './api/app.js';
import { createProvider } from './providers/factory.js';
import { newApiKey } from './store/keys.js';
import { MemoryStore } from './store/memory.js';
import { PrismaStore } from './store/prisma.js';
import type { Store } from './store/types.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const provider = createProvider(process.env.PROVIDER ?? 'stub', process.env);

let store: Store;
let devKey: string | undefined;
if (process.env.DATABASE_URL) {
  store = new PrismaStore(process.env.DATABASE_URL);
} else {
  // No database: an in-memory store with one dev customer. Data is lost on restart, and on a
  // serverless platform each instance has its own memory. Set DEV_API_KEY for a stable key.
  const mem = new MemoryStore();
  devKey = process.env.DEV_API_KEY ?? newApiKey();
  mem.addApiKey(devKey, { id: 'dev', name: 'dev', retentionDays: 90 });
  store = mem;
}

const app = Fastify({ ...SERVER_OPTIONS, logger: { level: process.env.LOG_LEVEL ?? 'info' } });
registerRoutes(app, { store, provider });
app.addHook('onClose', () => store.close());

app.listen({ port, host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info({ provider: provider.name, modelVersion: provider.modelVersion }, 'provider ready');
  if (devKey) {
    app.log.warn(
      process.env.DEV_API_KEY
        ? 'No DATABASE_URL: using the in-memory store with DEV_API_KEY.'
        : `No DATABASE_URL: using the in-memory store. Dev API key: ${devKey}`,
    );
  }
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => void app.close());
