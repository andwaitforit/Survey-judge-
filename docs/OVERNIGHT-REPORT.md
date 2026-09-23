# Overnight report: 2026-09-23

**Two things first:**

1. **`docs/TASKS.md` didn't exist.** It wasn't in the repo or in the uploaded docs. I rebuilt
   M1–M8 from CLAUDE.md, PRODUCT.md and ARCHITECTURE.md, following your priority order (policy +
   eval → providers → endpoints → docs), and marked the file as reconstructed. If your original
   differs, diff it against `docs/TASKS.md`.
2. **Branch:** the work is on `claude/policy-engine-milestones-1kbd4e`, not `feat/gate-core`. This
   session could only push to that branch. It holds one conventional commit per milestone on top
   of `main`, so a rename or fast-forward is enough.

Every milestone ended with `pnpm lint && pnpm typecheck && pnpm test` green before the next began.
Final state: **131 tests passing, 1 skipped** (a Postgres-only assertion). The store contract
suite also runs against Postgres behind `pnpm test:pg` (8 Postgres-specific tests, including the
append-only trigger). They passed against a local Postgres 16.

## What I built

| Milestone | Commit | What |
| --- | --- | --- |
| M1 | `chore(scaffold)` | pnpm, TS strict, ESLint, Vitest, Fastify; spec docs checked in |
| M2 | `feat(policy)` | Pure `decide()`, written test-first: replace → flag → clarify → keep, confidence floors, clarify-once, session budget, shadow by default. Includes property tests: deterministic, and lowering confidence never raises the action |
| M3 | `feat(providers)` | `DecisionProvider` exactly as specified, deterministic `StubProvider`, `runChecks()` fail-open wrapper (hard timeout, Zod-validated results), shared contract tests |
| M4 | `feat(eval)` | `pnpm eval`, written test-first: confusion matrix, precision/recall/FPR per action and for any intervention, threshold sweep, reliability bins + ECE, bias guardrail. Plus a 69-row hand-labelled fixture |
| M5 | `feat(providers)` | `LlmProvider` (OpenAI-compatible, so Ollama/vLLM/llama.cpp work) and `JevProvider` behind `TODO(jev-api)`. All three providers pass the same contract suite offline |
| M6 | `feat(store)` | Prisma 7 schema and migrations. A Postgres trigger makes the decision log truly append-only (only `finalOutcome` may be set, once). Versioned study configs, hashed API keys, retention purge |
| M7 | `feat(api)` | `POST /v1/score`, `/v1/score/batch`, `GET /v1/decisions` (CSV), plus the config and outcome endpoints enforce mode needs. Strict schemas, fail-open at every step |
| M8 | `docs` | `docs/INTEGRATIONS.md` (Qualtrics snippet, piped text, clarify loop), README, `.env.example`, eval baselines in `docs/eval/`, this report |

Definition of done:
- `pnpm dev` runs the API. It uses the in-memory store and prints a key, or Postgres when
  `DATABASE_URL` is set.
- `POST /v1/score` returns a typed decision in about 3 ms (in-process) and about 20 ms (over HTTP
  to local Postgres) against the stub. A test asserts p95 < 500 ms over 200 requests.
- `pnpm eval fixtures/labeled-sample.jsonl` prints the report.
- All checks are green.

## Choices you should check

The full list is in `docs/DECISIONS.md`. These affect behaviour:

- **"Independent checks" for `replace` = distinct evidence families.** The families are content,
  consistency, duplicate and boilerplate. The first eval run showed that keyboard mash trips
  `gibberish` and `relevance` together at over 0.9 confidence. Counting raw checks recommended
  `replace` for a single junk answer. This is the most consequential call I made; please confirm
  it.
- **Shadow returns `keep` and echoes `recommendedAction`.** This follows CLAUDE.md rule 4, which
  conflicts with the ARCHITECTURE.md example response.
- **Check polarity.** relevance/specificity/coherence/effort trip *below* a threshold;
  contradiction/gibberish/boilerplate/duplicate trip *above* it. This reads the PRODUCT.md example
  literally.
- **Respondent attributes are accepted but not stored** (the personal-data stop-and-ask). As a
  result, the bias guardrail only runs on labelled eval sets today.
- **Thresholds default to the PRODUCT.md example.** A live smoke test showed that
  `PUT {"mode":"enforce"}` would otherwise save empty thresholds and silently never act.

## What I skipped, and why

- **Real Jev integration.** The official docs (docs.typesafe.ai) and the mirror docs were blocked
  by the egress proxy. `JevProvider` is shaped on third-party descriptions and labelled
  unverified in the code, the fixtures, `modelVersion` and the factory (no default URL). It's in
  QUESTIONS.md.
- **Storing respondent attributes, and production bias monitoring.** Blocked on the personal-data
  question in QUESTIONS.md.
- **A scheduler for retention purges.** `purgeExpired` exists and is tested, but nothing calls it
  yet.
- **LLM confidence calibration.** The LLM provider returns self-reported confidence. It is
  uncalibrated and must not drive enforce mode until it is calibrated against logged outcomes.
- **Alchemer and Decipher snippets.** Qualtrics only. The Qualtrics UI labels also need checking
  against current docs, which I couldn't reach.
- **Durable log writes.** If the Postgres write fails, the response still goes out and the error
  is logged, but that decision is lost. CLAUDE.md says every decision is logged; this is the one
  gap.

## Eval baseline: StubProvider, 69 hand-labelled answers

Full reports: `docs/eval/baseline-stub-*.txt`. **Read these as a floor and a pipeline check, not
as model quality.** The stub is text heuristics, the fixture is small, and I both labelled it and
wrote the heuristics. Two stub fixes (filler answers are recoverable; relevance shouldn't penalise
brevity) were prompted by the first run. That is disclosed in DECISIONS.md, and there was no
further tuning.

**PRODUCT.md example config** (`pnpm eval fixtures/labeled-sample.jsonl`), at the policy's output:

| | precision | recall | FPR |
| --- | --- | --- | --- |
| any intervention | 100.0% | 80.5% | 0.0% |
| clarify | 87.5% | 100.0% | 3.6% |
| flag | 35.7% | 35.7% | 16.4% |
| replace | 100.0% | 23.1% | 0.0% |

**Recommended config** (`--config test/fixtures/study-config.recommended.json`; adds `contradiction`
and `boilerplate` flag thresholds):

| | precision | recall | FPR |
| --- | --- | --- | --- |
| any intervention | 100.0% | 95.1% | 0.0% |
| clarify | 100.0% | 100.0% | 0.0% |
| flag | 60.0% | 85.7% | 14.5% |
| replace | 100.0% | 38.5% | 0.0% |

Across both configs and every threshold: **0 keep-labelled answers recommended for replace, and
intervention FPR 0%.** A regression test now guards this.

**Threshold sweep, recommended config.** Interventions with decision confidence < t drop to keep:

| t | coverage | intervention recall | calibration gap |
| --- | --- | --- | --- |
| 0.0 | 56.5% | 95.1% | +0.08 |
| 0.7 | 49.3% | 82.9% | +0.11 |
| 0.8 | 46.4% | 78.0% | +0.13 |
| 0.9 | 26.1% | 43.9% | +0.35 |

**Calibration.** ECE is 0.139 on the example config and 0.006 on the recommended one. Don't trust
the 0.006: it is dominated by easy `keep`s. The per-threshold calibration gap on interventions
shows the stub is **overconfident on the interventions it makes**, and more so at high
confidence.

**What the numbers say:**
- The PRODUCT.md example config never acts on `contradiction` or `boilerplate`, because it has no
  thresholds for them. Adding them lifts flag recall from 36% to 86%.
- `replace` recall is low by design. Copy-paste bot farms are one line of evidence (duplicate), so
  they stop at `flag`. My fixture labels them `replace`. That is a labelling-policy question for
  you, in QUESTIONS.md.
- Off-topic answers ("I like turtles") are the stub's blind spot. It has no semantic model, so
  this is where a real provider has to earn its place.
- **Bias guardrail:** `ageBand=18-24` warns (1.97x overall with the recommended config; 3.29x with
  the example config, where `region=north` and `region=east` also warn). The cause is that every
  bot row in the fixture is 18-24, so these are true positives. The guardrail compares raw
  *predicted* rates as PRODUCT.md specifies, so a group with more real fraud will warn too. The
  `es` and `en-l2` groups had 0% replace and 0% flag, which is the result we want, but n = 5–6.

## Three things I'd do next

1. **Resolve Jev and run the real providers through the eval.** Confirm the API, then record real
   fixtures. Run `pnpm eval --provider llm` against a small local model, and `--provider jev`,
   on a *larger, independently labelled* set: at least a few hundred real verbatims labelled by
   research ops, not by me. Fit per-provider confidence calibration (isotonic, from the logged
   outcomes) before any study turns on enforce mode.
2. **Make the bias guardrail measure harm, not base rates.** Add per-group *false-positive*
   replace and flag rates, because they need labels. Decide the attribute-storage question so the
   guardrail can run on production decisions, not only on eval sets. Include the non-native
   speaker slices, and require a minimum n before warning.
3. **Close the durability and operations gaps in the decision log.** Add a local write-ahead
   buffer (or queue) so a Postgres blip can't drop decisions, schedule the retention purge, and
   add a `/metrics` endpoint (latency p95, degraded rate, action mix per study). Together these
   let a customer run shadow mode for a week and see whether enforce mode is worth switching on.
