import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { hashApiKey, newApiKey } from './keys.js';
import { PrismaStore } from './prisma.js';

/** Create (or reuse) a customer and mint an API key. The raw key is printed once and never stored. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      customer: { type: 'string', default: 'demo' },
      name: { type: 'string' },
      'retention-days': { type: 'string', default: '90' },
    },
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const store = new PrismaStore(url);
  try {
    const id = values.customer!;
    await store.db.customer.upsert({
      where: { id },
      update: {},
      create: { id, name: values.name ?? id, retentionDays: Number(values['retention-days']) },
    });
    const raw = newApiKey();
    await store.db.apiKey.create({ data: { id: randomUUID(), customerId: id, keyHash: hashApiKey(raw) } });
    process.stdout.write(`customer ${id}\napi key  ${raw}\n`);
  } finally {
    await store.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
