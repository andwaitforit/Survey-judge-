# QUESTIONS.md

Blockers and open questions for Andrew. Append, do not rewrite.

- [ ] Jev API shape: confirm from official docs before JevProvider is treated as real.
- [ ] Do we need per-question config overrides, or is per-study enough for the first customers?
- [ ] **`docs/TASKS.md` was not in the repo or in the upload.** The agent rebuilt M1–M8 from CLAUDE.md, PRODUCT.md and ARCHITECTURE.md, and marked the file as reconstructed. Please diff it against your original.
- [ ] Branch: the brief says `feat/gate-core`, but the session can only push to `claude/policy-engine-milestones-1kbd4e`. Rename it when you merge.
- [ ] ARCHITECTURE.md's example response shows `"action": "clarify"` with `"mode": "shadow"`, which contradicts CLAUDE.md rule 4 (shadow returns keep). The agent implemented rule 4 and added `recommendedAction` to the response. Is echoing `recommendedAction` in shadow mode OK, or should it be log-only?
- [ ] After a clarify, a re-score that is still weak currently resolves to `keep`, by the literal rule order. Should a still-weak re-score be `flag` instead?
