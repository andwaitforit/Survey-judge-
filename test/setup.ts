// No network calls in tests (CLAUDE.md). Any code path that reaches the real fetch fails loudly.
globalThis.fetch = (() => {
  throw new Error('Network access is disabled in tests: inject a fake fetch');
}) as typeof fetch;
