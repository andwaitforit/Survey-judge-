import { createHash, randomBytes, randomUUID } from 'node:crypto';

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function newApiKey(): string {
  return `sk_${randomBytes(24).toString('base64url')}`;
}

export function newDecisionId(): string {
  return `dec_${randomUUID().replaceAll('-', '')}`;
}
