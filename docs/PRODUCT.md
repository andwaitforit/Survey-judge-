# PRODUCT.md — what the gate decides

## The four actions

| Action | Meaning | Default behaviour |
| --- | --- | --- |
| `keep` | Answer is usable | Survey continues |
| `clarify` | Answer is weak but recoverable | Return a short follow-up prompt; re-score once |
| `flag` | Suspect; keep the data but mark it | Written to embedded data for post-field cleaning |
| `replace` | Respondent should not be counted | Customer decides what to do; we never terminate |

`clarify` fires at most once per answer. A re-scored answer can only move to `keep` or `flag`,
never back to `clarify`.

## The checks

Each is a bounded question scored 0–1 with confidence, evaluated in parallel against the same
state (question text, answer, prior answers in this session, study context).

| Check | Question |
| --- | --- |
| `relevance` | Does the answer address the question asked? |
| `specificity` | Is it concrete enough to be usable in analysis? |
| `coherence` | Is it internally coherent, not word salad? |
| `contradiction` | Does it contradict this respondent's earlier answers? |
| `gibberish` | Is it keyboard mash, filler, or a non-answer like "good"? |
| `boilerplate` | Does it look pasted, templated, or copied from the question? |
| `duplicate` | Is it a near-duplicate of other respondents' answers in this study? |
| `effort` | Is it plausibly a genuine attempt? |

**Deliberately excluded:** "was this written by AI" as a deciding signal. Stylometric AI detection
is unreliable and biases against non-native speakers. It may be logged as a weak signal only, and
must never on its own move an answer to `flag` or `replace`.

## Policy engine

Per-study config (versioned, stored, referenced in every decision):

```jsonc
{
  "studyId": "acme-q4-tracker",
  "mode": "shadow",              // shadow | enforce
  "thresholds": {
    "clarify": { "relevance": 0.55, "specificity": 0.45 },
    "flag":    { "relevance": 0.30, "gibberish": 0.70, "duplicate": 0.85 },
    "replace": { "requireChecks": 2, "minConfidence": 0.90 }
  },
  "clarifyPrompts": { "relevance": "Could you say a bit more about ...?" },
  "maxClarifyPerSession": 2
}
```

Rules, in order: if any `replace` condition is met with confidence above `minConfidence` **and**
at least `requireChecks` independent checks agree, return `replace`. Otherwise if a `flag`
condition is met, return `flag`. Otherwise if a `clarify` condition is met and the session budget
allows, return `clarify`. Otherwise `keep`.

Low confidence always resolves downward toward `keep`. The expensive error is removing a real
respondent, not keeping a weak answer.

## Bias guardrail

The eval harness must report action rates split by any respondent attributes the customer passes
(language, region, age band). A group whose `replace` rate is more than 1.5x the overall rate is
reported as a warning in the eval output.
