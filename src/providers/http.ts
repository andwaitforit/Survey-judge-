import type { FetchLike } from './types.js';

/**
 * Node's global fetch, typed through our own FetchLike rather than the global DOM/undici types,
 * which resolve differently under Vercel's TypeScript build.
 */
export const defaultFetch: FetchLike = (input, init) =>
  (globalThis as unknown as { fetch: FetchLike }).fetch(input, init);
