import Fastify, { type FastifyInstance } from 'fastify';

export interface AppOptions {
  logger?: boolean;
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  app.get('/health', async () => ({ ok: true }));
  return app;
}
