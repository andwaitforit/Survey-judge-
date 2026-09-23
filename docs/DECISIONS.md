# DECISIONS.md

One short entry per non-obvious choice: date, decision, why, alternatives rejected.

- 2026-09-22 — Actions are keep/clarify/flag/replace, and we never terminate a respondent ourselves. Removing a real respondent is the expensive error; the customer owns that call.
- 2026-09-22 — Stylometric "AI-written" detection is logged as a weak signal only, never a deciding one. Accuracy collapses on edited text and it biases against non-native speakers.
- 2026-09-22 — Model access sits behind DecisionProvider so Jev can be swapped for a small LLM or an open clone. The vendor is not the moat; the decision log is.
- 2026-09-23 — `docs/TASKS.md` was missing, so the agent rebuilt M1–M8 from the other spec docs (see QUESTIONS.md). Stopping for the whole night was the alternative; the spec was detailed enough to proceed and mark the file as reconstructed.
- 2026-09-23 — Work is on branch `claude/policy-engine-milestones-1kbd4e`, not `feat/gate-core`. The session environment only allows pushes to that branch. Rename or merge it as needed.
- 2026-09-23 — Added dev dependency `tsx` to run TypeScript directly for `pnpm dev` and `pnpm eval`, with no build step. Rejected `ts-node` (slower, ESM friction) and a `tsc` build (extra step for the dev loop).
- 2026-09-23 — TypeScript is pinned to `~5.9`. TS 7 (native) is `latest` on npm, but typescript-eslint does not support it yet.
- 2026-09-23 — Check polarity: relevance/specificity/coherence/effort are *quality* scores (higher is better; a threshold trips when score < t). contradiction/gibberish/boilerplate/duplicate are *risk* scores (trip when score > t). This reads the PRODUCT.md example (`flag.relevance 0.30` is a floor, `flag.gibberish 0.70` a ceiling) literally. Both comparisons are strict, so a score on the threshold does not trip.
- 2026-09-23 — What counts as a "replace condition": a check that trips its replace threshold (`thresholds.replace.checks`, defaulting to the flag thresholds) with confidence strictly above `minConfidence`. At least `requireChecks` *distinct* checks must qualify. The schema puts a floor of 2 on `requireChecks`, so one check can never replace on its own.
- 2026-09-23 — Low confidence resolves toward keep through `confidenceFloors` (defaults: clarify 0.5, flag 0.6). A flag trip below the flag floor becomes a clarify trip; any trip below the clarify floor is ignored. A property test checks the result: lowering confidence never raises the action.
- 2026-09-23 — Re-score and budget behaviour: when clarify is not allowed (re-score, or session budget spent), a clarify-level outcome falls through to `keep`, as the rule order says. A re-score that meets replace conditions is capped at `flag` ("can only move to keep or flag").
- 2026-09-23 — AI authorship is kept out of the deciding path by construction. Config thresholds only accept the eight PRODUCT.md check names (strict Zod), so no such signal can trip an action.
- 2026-09-23 — Shadow mode returns `action: "keep"` and exposes `recommendedAction` separately (logged, and echoed in the response for the customer's own analysis). ARCHITECTURE.md's example response shows `action: "clarify"` with `mode: "shadow"`. CLAUDE.md rule 4 is explicit, so rule 4 wins.
