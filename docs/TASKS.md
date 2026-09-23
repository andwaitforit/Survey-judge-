# TASKS.md

> **Reconstructed on 2026-09-23 by the agent.** The brief pointed at `docs/TASKS.md`, but the file
> was not in the repo or in the uploaded docs. The milestones below come from CLAUDE.md,
> PRODUCT.md and ARCHITECTURE.md, in the priority order the brief gave: policy engine and eval
> harness first, then providers, then endpoints, then docs. See docs/QUESTIONS.md. If your
> original TASKS.md differs, it wins.

Every milestone ends with `pnpm lint && pnpm typecheck && pnpm test` green and a single
conventional commit.

## M1 — Scaffold
- pnpm + TypeScript (strict) + ESLint + Vitest + Fastify skeleton.
- `pnpm dev` starts the API; `GET /health` returns `{ ok: true }`.
- Spec docs checked into `docs/`.

## M2 — Policy engine (test first)
- `CheckName`, `Action`, `StudyConfig` Zod schema matching PRODUCT.md.
- `decide(results, config, ctx)`: a pure function. Rule order: replace → flag → clarify → keep.
- Confidence gating: low confidence resolves toward `keep`. `replace` needs `requireChecks`
  independent checks, each above `minConfidence`.
- Clarify runs at most once per answer; a re-score can only land on keep/flag; session budget
  comes from `maxClarifyPerSession`.
- Shadow mode: `recommendedAction` is computed and logged, and `keep` is returned.
- The AI-authorship signal is never a deciding check.

## M3 — DecisionProvider + StubProvider + contract tests
- Interface exactly as ARCHITECTURE.md.
- `StubProvider`: deterministic, seeded from a hash of the answer text, with heuristics so the
  eval produces meaningful numbers.
- `runChecks()` wrapper: per-call timeout and fail-open, recording partial failures.
- `test/providers.contract.test.ts`: shape, range, timeout, partial failure, for every provider.

## M4 — Eval harness (test first)
- `pnpm eval fixtures/labeled-sample.jsonl`: replays labeled answers through provider + policy.
- Report: precision, recall, false-positive rate per action and for "any intervention";
  calibration (reliability bins + ECE); a threshold sweep over several thresholds.
- Bias guardrail: action rates per attribute group; a warning when a group's `replace` rate is
  more than 1.5x the overall rate.
- A labeled sample fixture in `test/fixtures/labeled-sample.jsonl`.

## M5 — Small-LLM provider + Jev adapter
- `LlmProvider`: OpenAI-compatible chat-completions over `fetch`, one bounded prompt per check,
  run in parallel.
- `JevProvider`: behind an adapter marked `TODO(jev-api)` unless the official docs confirm the
  interface. It works against fixtures.
- Both pass the contract tests with an injected fake `fetch`. No network in tests.

## M6 — Store
- Prisma schema: `Decision` (append-only log), `StudyConfigVersion`, `ApiKey`.
- `DecisionLog` and `StudyConfigRepo` interfaces, with in-memory and Prisma implementations.
- Retention setting per customer (90-day default); only answer text is stored.

## M7 — API endpoints
- `POST /v1/score` (500 ms budget), `POST /v1/score/batch`, `GET /v1/decisions?studyId=` (CSV).
- Strict Zod schemas: unknown fields are rejected. API key per customer.
- Fail open end to end. Latency test against the stub.

## M8 — Integration docs + report
- `docs/INTEGRATIONS.md`: a Qualtrics web-service snippet and a piped-text example.
- README quickstart. `docs/OVERNIGHT-REPORT.md`.
