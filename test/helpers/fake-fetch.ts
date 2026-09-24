import type { CheckName } from '../../src/policy/types.js';
import type { FetchInit, FetchLike } from '../../src/providers/types.js';
import { sleep } from '../../src/providers/parallel.js';

export interface FakeFetchOptions {
  /** Work out which check a request body is for. */
  identify: (body: unknown) => CheckName;
  /** Build the JSON response for a check. */
  respond: (check: CheckName, body: unknown) => unknown;
  slow?: CheckName[];
  slowMs?: number;
  fail?: CheckName[];
  /** Every request is recorded here for assertions. */
  calls?: { url: string; init: FetchInit; body: unknown }[];
}

/** An offline stand-in for fetch. Honors AbortSignal, so slow fakes never outlive a test. */
export function fakeFetch(o: FakeFetchOptions): FetchLike {
  return async (url, init) => {
    const body: unknown = JSON.parse(String(init.body));
    o.calls?.push({ url, init, body });
    const check = o.identify(body);
    if (o.slow?.includes(check)) await sleep(o.slowMs ?? 1000, init.signal);
    if (o.fail?.includes(check)) return new Response('{"error":"injected"}', { status: 500 });
    return new Response(JSON.stringify(o.respond(check, body)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}
