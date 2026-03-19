## Summary

### Files Changed

- `.auto-flow/pipeline.yaml` — renamed all `04-decision`→`03-decision`, `06-impl-summary`→`04-impl-summary`, `08-review`→`06-review` refs (15 occurrences; task_template strings, output paths, validate paths)
- `.auto-flow/agents/agent-tech-lead/SKILL.md` — `04-decision.md`→`03-decision.md` (3 occurrences: responsibility text, Output section heading, Allowed Modifications)
- `.auto-flow/agents/agent-tech-lead-review/SKILL.md` — `08-review.md`→`06-review.md` (5 occurrences: responsibilities, Output section, rules, Allowed Modifications)
- `.auto-flow/agents/agent-developer/SKILL.md` — `04-decision.md`→`03-decision.md` and `06-impl-summary.md`→`04-impl-summary.md` (full rewrite; 9+3 occurrences)
- `documents/requirements-sdlc.md` — `04-decision.md`→`03-decision.md` (7 occurrences in FR-S5, FR-S11, FR-S25, FR-S32 sections, Appendix A, Appendix C)
- `README.md` — `04-decision.md`→`03-decision.md` and `08-review.md`→`06-review.md` (2 occurrences in pipeline table)
- `.auto-flow/memory/agent-tech-lead-review.md` — `08-review.md`→`06-review.md` (1 occurrence in Output dir note)
- `.auto-flow/memory/agent-tech-lead-history.md` — fixed pre-existing trailing space (line 10)
- `.auto-flow/memory/agent-tech-lead-review-history.md` — fixed pre-existing table alignment/trailing spaces

### Tests Added or Modified

None — this is a pure config/doc rename. Verification by grep sweep (0 matches for old names) and `deno task check` pipeline integrity validation (covers `pipeline.yaml` schema).

### Check Status

PASS — `deno task check`: fmt ✓, lint ✓, type-check ✓, CLI smoke ✓, 493 tests ✓, pipeline integrity ✓, AGENTS.md accuracy ✓
