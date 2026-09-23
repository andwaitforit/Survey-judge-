# DECISIONS.md

One short entry per non-obvious choice: date, decision, why, alternatives rejected.

- 2026-09-22 — Actions are keep/clarify/flag/replace, and we never terminate a respondent ourselves. Removing a real respondent is the expensive error; the customer owns that call.
- 2026-09-22 — Stylometric "AI-written" detection is logged as a weak signal only, never a deciding one. Accuracy collapses on edited text and it biases against non-native speakers.
- 2026-09-22 — Model access sits behind DecisionProvider so Jev can be swapped for a small LLM or an open clone. The vendor is not the moat; the decision log is.
- 2026-09-23 — `docs/TASKS.md` was missing, so the agent rebuilt M1–M8 from the other spec docs (see QUESTIONS.md). Stopping for the whole night was the alternative; the spec was detailed enough to proceed and mark the file as reconstructed.
- 2026-09-23 — Work is on branch `claude/policy-engine-milestones-1kbd4e`, not `feat/gate-core`. The session environment only allows pushes to that branch. Rename or merge it as needed.
- 2026-09-23 — Added dev dependency `tsx` to run TypeScript directly for `pnpm dev` and `pnpm eval`, with no build step. Rejected `ts-node` (slower, ESM friction) and a `tsc` build (extra step for the dev loop).
- 2026-09-23 — TypeScript is pinned to `~5.9`. TS 7 (native) is `latest` on npm, but typescript-eslint does not support it yet.
