# CLAUDE.md

## What this project is

An API that scores open-ended survey answers **while the respondent is still in the survey** and
returns one of four actions in under 500 ms: `keep`, `clarify`, `flag`, `replace`.

Customers are market research agencies, fieldwork shops and opt-in pollsters. Their survey
platform (Qualtrics, Alchemer, Decipher) calls us mid-survey from a web-service element.

The differentiator is **clarify**: instead of deleting a weak answer after fieldwork, we ask the
respondent to improve it while they are still there, then re-score.

## Non-goals (do not build these tonight)

- Dashboard UI, billing, org/user management, SSO
- Post-field verbatim coding (later phase)
- Image/vision handling
- Anything that auto-terminates a respondent. `replace` is a recommendation the customer acts on.

## Architecture rules

1. **Model-agnostic.** All model calls go through the `DecisionProvider` interface
   (`src/providers/`). Jev is one implementation. A small-LLM implementation and a deterministic
   stub must also exist and pass the same contract tests. No provider-specific types leak into
   the policy engine or the API layer.
2. **The policy engine is deterministic.** Models produce per-check scores and confidence; a
   plain TypeScript function maps scores + study config to an action. No model decides the action.
3. **Every decision is logged**, append-only, with provider, model version, per-check scores,
   confidence, action, latency and config version. This log is the company's core asset.
4. **Shadow mode is the default** for every new study: compute and log the action, return `keep`.
   Enforcement is opt-in per study.
5. **Latency budget: 500 ms p95.** Checks run in parallel. Any provider call is wrapped in a
   timeout; on timeout or error, return `keep` and log the failure. Never block a survey.

## Stack

TypeScript (strict), Node 22, Fastify, Postgres via Prisma, Zod for all boundaries, Vitest,
pnpm. No other dependencies without adding a line to `docs/DECISIONS.md` explaining why.

## Working agreement for the agent

- Work through `docs/TASKS.md` in order. One milestone per commit, conventional commit messages,
  on branch `feat/gate-core`.
- Every milestone ends green: `pnpm lint && pnpm typecheck && pnpm test`. Do not start the next
  milestone with a red build.
- Write the test first for the policy engine and the eval harness. Those two are where
  correctness matters most.
- No network calls in tests. Providers are faked with fixtures in `test/fixtures/`.
- Keep `docs/DECISIONS.md` updated: one short entry per non-obvious choice.

## Stop and ask (leave a note in docs/QUESTIONS.md, then continue with other work)

- The Jev API shape cannot be confirmed from official docs. **Do not invent endpoints and present
  them as real.** Implement `JevProvider` against the documented interface if docs are available;
  otherwise implement it behind a clearly marked adapter with fixtures and a `TODO(jev-api)`.
- Anything that would store personal data beyond the answer text.
- Any change to the four actions or the check list in `docs/PRODUCT.md`.

## Definition of done for the night

`pnpm dev` runs the API. `POST /v1/score` returns a typed decision in under 500 ms against the
stub provider. `pnpm eval fixtures/labeled-sample.jsonl` prints a report with precision, recall,
false-positive rate and calibration at several thresholds. Tests, types and lint are green.
