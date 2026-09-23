# ARCHITECTURE.md

```
survey platform ──POST /v1/score──▶ API (Fastify)
                                     │
                                     ├─▶ study config (cached, versioned)
                                     ├─▶ DecisionProvider.scoreBatch()  ← Jev | small LLM | stub
                                     ├─▶ policy engine (pure function)
                                     └─▶ decision log (append-only)
```

## Layout

```
src/
  api/          routes, zod schemas, auth (API key per customer)
  policy/       pure decision functions + config types    <- unit tested hard
  providers/    DecisionProvider interface + jev, llm, stub
  store/        prisma client, decision log writer, study config repo
  eval/         replay harness + report renderer
test/fixtures/  labeled sample answers, provider fixtures
```

## DecisionProvider

```ts
export interface CheckRequest {
  checks: CheckName[];          // run in parallel against one state
  state: {
    questionText: string;
    answerText: string;
    priorAnswers: { question: string; answer: string }[];
    studyContext?: string;
    peerAnswers?: string[];     // sample for duplicate check
  };
}

export interface CheckResult {
  check: CheckName;
  score: number;        // 0..1
  confidence: number;   // 0..1, calibrated where the provider supports it
}

export interface DecisionProvider {
  readonly name: string;
  readonly modelVersion: string;
  scoreBatch(req: CheckRequest, opts: { timeoutMs: number }): Promise<CheckResult[]>;
}
```

Contract tests in `test/providers.contract.test.ts` run against every implementation: shape,
range, timeout behaviour, partial failure (some checks return, others time out).

`StubProvider` is deterministic, seeded from a hash of the answer text, so the whole system is
testable offline and demos never depend on a vendor.

## API contract

`POST /v1/score`

```jsonc
// request
{
  "studyId": "acme-q4-tracker",
  "sessionId": "R_abc123",        // respondent session, not PII
  "questionId": "Q7",
  "questionText": "Why did you choose Brand X?",
  "answerText": "it was good",
  "priorAnswers": [{ "questionId": "Q3", "answer": "I have never bought Brand X" }],
  "attributes": { "languageGroup": "en", "ageBand": "25-34" }
}

// response (p95 < 500 ms)
{
  "decisionId": "dec_01J...",
  "action": "clarify",
  "clarifyPrompt": "Could you say a bit more about what made you choose it?",
  "checks": { "relevance": 0.41, "specificity": 0.22, "contradiction": 0.78 },
  "confidence": 0.71,
  "mode": "shadow",
  "latencyMs": 210
}
```

Also: `POST /v1/score/batch` (post-field replay, no latency budget) and
`GET /v1/decisions?studyId=` (CSV export of the log).

## Decision log

Append-only table: `decisionId, studyId, sessionId, questionId, provider, modelVersion,
configVersion, checks(jsonb), confidence, action, mode, latencyMs, clarified(bool),
finalOutcome(nullable), createdAt`. `finalOutcome` is written later when the customer tells us
what happened to that respondent — this is how the dataset becomes the moat.

## Privacy

Answer text is stored because we need it for evaluation, but: no respondent names or emails are
accepted, `sessionId` must be an opaque platform identifier, retention is configurable per
customer with a 90-day default, and customer data is never used to train anything. Reject any
payload field not in the schema rather than storing it.

## Integration (stub for now, real in phase 2)

Qualtrics web-service element calls `/v1/score` in the survey flow and writes `action` to
embedded data. Provide a copy-paste snippet and a piped-text example in `docs/INTEGRATIONS.md`.
