# INTEGRATIONS.md

> Phase 1: stub integration. The request and response below match the implemented API. The
> Qualtrics UI steps come from general knowledge of the Web Service element. They were **not**
> checked against current Qualtrics docs tonight (no network access to them), so confirm the menu
> labels before sending this to a customer.

## Qualtrics: Web Service element

Put a **Web Service** element in the Survey Flow, directly after the block that holds the open-ended
question (Q7 in this example).

| Setting | Value |
| --- | --- |
| URL | `https://<your-host>/v1/score` |
| Method | `POST` |
| Body format | JSON (`application/json`) |
| Custom header | `x-api-key: <customer API key>`, or `Authorization: Bearer <key>` |

**Body parameters** (piped text on the right):

| Key | Value |
| --- | --- |
| `studyId` | `acme-q4-tracker` |
| `sessionId` | `${e://Field/ResponseID}` |
| `questionId` | `Q7` |
| `questionText` | `Why did you choose Brand X?` |
| `answerText` | `${q://QID7/ChoiceTextEntryValue}` |

**Set embedded data from the response** (response field → embedded data field):

| Response field | Embedded data |
| --- | --- |
| `action` | `gate_action_Q7` |
| `clarifyPrompt` | `gate_prompt_Q7` |
| `recommendedAction` | `gate_recommended_Q7` |
| `decisionId` | `gate_decision_Q7` |
| `degraded` | `gate_degraded_Q7` |

Declare those embedded data fields at the top of the Survey Flow so they are exported with the
responses.

### Copy-paste request body

```json
{
  "studyId": "acme-q4-tracker",
  "sessionId": "${e://Field/ResponseID}",
  "questionId": "Q7",
  "questionText": "Why did you choose Brand X?",
  "answerText": "${q://QID7/ChoiceTextEntryValue}",
  "priorAnswers": [
    { "questionId": "Q3", "questionText": "Have you bought Brand X before?", "answer": "${q://QID3/ChoiceGroup/SelectedChoices}" }
  ]
}
```

Only `studyId`, `sessionId`, `questionId`, `questionText`, `answerText`, `priorAnswers` and
`attributes` (`languageGroup`, `region`, `ageBand`) are accepted. **Any other field is rejected
with a 400**, including names and emails. `sessionId` must be the opaque platform ID
(`ResponseID`), never a panel member ID that could identify a person.

### The clarify loop (enforce mode only)

In shadow mode (the default) `action` is always `keep`, so none of this triggers. It is safe to
wire up the survey before a study is switched to enforce.

1. After the Web Service element, add a block with a follow-up text question **Q7b** that has
   display logic: *Embedded Data `gate_action_Q7` is equal to `clarify`*.
   Its question text is the piped prompt: `${e://Field/gate_prompt_Q7}`.
2. Add a second Web Service element after that block, with the same branch condition. Send the
   **same `questionId`** (`Q7`) and the combined answer, so the gate treats it as the re-score:

   ```json
   {
     "studyId": "acme-q4-tracker",
     "sessionId": "${e://Field/ResponseID}",
     "questionId": "Q7",
     "questionText": "Why did you choose Brand X?",
     "answerText": "${q://QID7/ChoiceTextEntryValue} ${q://QID7b/ChoiceTextEntryValue}"
   }
   ```

   Map `action` into the same `gate_action_Q7` field. A re-score only ever returns `keep` or
   `flag`, never `clarify` again.
3. Clarify fires at most `maxClarifyPerSession` times per respondent (default 2). Later weak
   answers get `keep`.

### What to do with each action

| `gate_action_*` | Suggested survey behaviour |
| --- | --- |
| `keep` | Nothing. |
| `clarify` | Show the follow-up (above). |
| `flag` | Nothing in the survey. Filter or review on `gate_action_* = flag` in post-field cleaning. |
| `replace` | **We never terminate.** The customer decides, e.g. mark for replacement in the quota logic. |

### Failure behaviour

If the gate is slow or down, it answers `keep` (with `degraded: true`) within the latency budget.
A survey should never wait on it. Set the Web Service element's timeout (where the platform
allows) a little above 500 ms, and treat a missing `gate_action_*` as `keep`.

## Enabling enforce mode for a study

```bash
curl -X PUT https://<host>/v1/studies/acme-q4-tracker/config \
  -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{
    "studyId": "acme-q4-tracker",
    "mode": "enforce",
    "clarifyPrompts": { "specificity": "Could you say a bit more about what made you choose it?" }
  }'
```

Omitted thresholds default to the PRODUCT.md example values. Every PUT creates a new version, and
each decision records the `configVersion` it was made under.

## Reporting final outcomes

When the customer knows what happened to a respondent, post it back. This is what turns the log
into labelled data.

```bash
curl -X POST https://<host>/v1/decisions/dec_.../outcome \
  -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{ "outcome": "removed_in_cleaning" }'
```

It can be set once per decision. A second call returns 409.

## Exporting the log

```bash
curl -H "x-api-key: $KEY" "https://<host>/v1/decisions?studyId=acme-q4-tracker" > decisions.csv
```

Cells that start with `= + - @` are prefixed with `'` so respondent text cannot run as a
spreadsheet formula.

## Alchemer, Decipher

Not done tonight. Both have a web-service / API-call element that can POST JSON and store response
fields, so the Qualtrics mapping above should carry over.
