/**
 * Run keyed tasks in parallel under one deadline. Returns the values that resolved in time;
 * rejected or late tasks are dropped (the caller sees them as missing). The shared AbortSignal
 * fires at the deadline so HTTP-backed tasks can cancel their requests.
 */
export async function settleWithin<K, V>(
  keys: readonly K[],
  run: (key: K, signal: AbortSignal) => Promise<V>,
  timeoutMs: number,
): Promise<{ key: K; value: V }[]> {
  const controller = new AbortController();
  const deadline = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  });
  deadline.catch(() => undefined);
  const timer = setTimeout(() => controller.abort(), Math.max(0, timeoutMs));
  try {
    const settled = await Promise.allSettled(
      keys.map(async (key) => ({ key, value: await Promise.race([run(key, controller.signal), deadline]) })),
    );
    return settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** A sleep that rejects early when the signal aborts, so slow fakes never outlive a test. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
