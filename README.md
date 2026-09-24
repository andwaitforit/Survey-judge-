# survey-judge

An API that scores open-ended survey answers while the respondent is still in the survey. It
returns `keep`, `clarify`, `flag` or `replace` in under 500 ms. Read these first: `CLAUDE.md`,
`docs/PRODUCT.md`, `docs/ARCHITECTURE.md`.

## Quickstart

```bash
pnpm install                 # also runs prisma generate
pnpm dev                     # API on :3000 with the in-memory store; prints a dev API key
pnpm lint && pnpm typecheck && pnpm test
pnpm eval fixtures/labeled-sample.jsonl
pnpm eval fixtures/labeled-sample.jsonl --config test/fixtures/study-config.recommended.json
```

Score an answer:

```bash
curl -s localhost:3000/v1/score -H "x-api-key: $DEV_API_KEY" -H 'content-type: application/json' -d '{
  "studyId": "acme-q4-tracker", "sessionId": "R_abc123", "questionId": "Q7",
  "questionText": "Why did you choose Brand X?", "answerText": "it was good"
}'
```

### With Postgres

```bash
export DATABASE_URL=postgresql://user:pass@localhost:5432/survey_judge
pnpm db:migrate
pnpm db:seed --customer acme          # prints an API key once
pnpm dev
pnpm test:pg                          # store contract tests against that database
```

## Providers

Set with `PROVIDER` (server) or `--provider` (eval). See `.env.example`.

| Provider | Status |
| --- | --- |
| `stub` | Deterministic heuristics. Default. Offline. |
| `llm` | Any OpenAI-compatible `/chat/completions` server (Ollama, vLLM, llama.cpp, gateways). |
| `jev` | **Unverified adapter, `TODO(jev-api)`.** See `docs/QUESTIONS.md`. |

## Layout

```
src/policy     pure decision engine + study config schema
src/providers  DecisionProvider interface, stub / llm / jev, fail-open runner
src/eval       replay harness, metrics, report
src/store      decision log, study configs, API keys (memory + Prisma)
src/api        Fastify routes and Zod schemas
test/          unit, contract and API tests; fixtures in test/fixtures
docs/          spec, decisions, questions, integrations, eval baselines
```
