# QUESTIONS.md

Blockers and open questions for Andrew. Append, do not rewrite.

- [ ] Jev API shape: confirm from official docs before JevProvider is treated as real.
- [ ] Do we need per-question config overrides, or is per-study enough for the first customers?
- [ ] **`docs/TASKS.md` was not in the repo or in the upload.** The agent rebuilt M1–M8 from CLAUDE.md, PRODUCT.md and ARCHITECTURE.md, and marked the file as reconstructed. Please diff it against your original.
- [ ] Branch: the brief says `feat/gate-core`, but the session can only push to `claude/policy-engine-milestones-1kbd4e`. Rename it when you merge.
- [ ] ARCHITECTURE.md's example response shows `"action": "clarify"` with `"mode": "shadow"`, which contradicts CLAUDE.md rule 4 (shadow returns keep). The agent implemented rule 4 and added `recommendedAction` to the response. Is echoing `recommendedAction` in shadow mode OK, or should it be log-only?
- [ ] After a clarify, a re-score that is still weak currently resolves to `keep`, by the literal rule order. Should a still-weak re-score be `flag` instead?
- [ ] "Independent checks" for `replace` is implemented as distinct evidence families (content / consistency / duplicate / boilerplate); see DECISIONS.md. Is that your intent, and are these the right families?
- [ ] The PRODUCT.md example config has no thresholds for `contradiction` or `boilerplate`, so those checks never act. Should the default study template include them (see `test/fixtures/study-config.recommended.json`)?
- [ ] Labelling policy for bot farms: pure copy-paste duplicates are one line of evidence, so they reach `flag`, not `replace`. The fixture labels them `replace`. Which is right?
- [ ] **Jev API (still open).** The official docs (docs.typesafe.ai) were unreachable from the build environment. `JevProvider` follows third-party descriptions (`{model, state, questions}` → `{answers: {id: {score, confidence, probabilities}}}`) and is marked `TODO(jev-api)` throughout `src/providers/jev/`. To make it real: confirm the endpoint, auth, score encoding and whether confidence is calibrated; record real responses into `test/fixtures/jev/`; then decide between one request per check (current: partial results, 8x calls) and one batched request per answer (cheaper, all-or-nothing on timeout).
