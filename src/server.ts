/**
 * Server entrypoint. Vercel's Fastify preset detects the app by finding a file that imports
 * `fastify` and calls `listen()`, so the instance is created here rather than inside buildApp().
 */
import Fastify from 'fastify';
import { registerRoutes, SERVER_OPTIONS } from './api/app.js';
import { readEnv } from './env.js';
import { createProvider } from './providers/factory.js';
import { newApiKey } from './store/keys.js';
import { MemoryStore } from './store/memory.js';
import { PrismaStore } from './store/prisma.js';
import type { Store } from './store/types.js';

const env = process.env;
const port = Number(readEnv(env, 'PORT') ?? 3000);
const host = readEnv(env, 'HOST') ?? '0.0.0.0';
const provider = createProvider(readEnv(env, 'PROVIDER'), env);
const databaseUrl = readEnv(env, 'DATABASE_URL');
const devApiKey = readEnv(env, 'DEV_API_KEY');

let store: Store;
let devKey: string | undefined;
if (databaseUrl) {
  const schema = readEnv(env, 'DATABASE_SCHEMA');
  store = new PrismaStore(databaseUrl, schema ? { schema } : {});
} else {
  // No database: an in-memory store with one dev customer. Data is lost on restart, and on a
  // serverless platform each instance has its own memory. Set DEV_API_KEY for a stable key.
  const mem = new MemoryStore();
  devKey = devApiKey ?? newApiKey();
  mem.addApiKey(devKey, { id: 'dev', name: 'dev', retentionDays: 90 });
  store = mem;
}

const app = Fastify({ ...SERVER_OPTIONS, logger: { level: readEnv(env, 'LOG_LEVEL') ?? 'info' } });
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
      devApiKey
        ? 'No DATABASE_URL: using the in-memory store with DEV_API_KEY.'
        : `No DATABASE_URL: using the in-memory store. Dev API key: ${devKey}`,
    );
  }
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => void app.close());
