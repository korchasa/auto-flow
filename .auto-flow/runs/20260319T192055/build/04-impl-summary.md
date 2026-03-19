## Summary

- **Files changed (iter 1):**
  - `.claude/skills/agent-pm` — deleted symlink (pointed to `../../.auto-flow/agents/agent-pm`)
  - `.claude/skills/agent-architect` — deleted symlink
  - `.claude/skills/agent-developer` — deleted symlink
  - `.claude/skills/agent-qa` — deleted symlink
  - `.claude/skills/agent-tech-lead` — deleted symlink
  - `.claude/skills/agent-tech-lead-review` — deleted symlink
  - `scripts/check.ts` — removed lines 103-130: symlink validation block in
    `pipelineIntegrity()` (the `// 2. Check agent symlinks...` loop and
    "Agent symlinks valid." log). Function now contains only `loadConfig()`
    delegation (step 1).
  - `documents/design-sdlc.md` — §2.2 Agent Runtime symlink clause removed;
    §3.4 Purpose, Interfaces, Migration updated with FR-S33 reference.
- **Files changed (iter 2 — QA fix):**
  - `documents/requirements-sdlc.md` — added §3.33 FR-S33 section with 5 `[x]`
    ACs; updated NFR §4 Reproducibility (`.claude/skills/` → `.auto-flow/agents/`);
    removed Appendix B `.claude/skills/ agent-*/` symlink lines; added FR-S32 +
    FR-S33 rows to Appendix C; fixed stale FR-S13 AC (standalone invocability);
    fixed stale FR-S15 AC (`.claude/skills/` canonical dirs).
- **Tests added/modified:** None — no logic added; 493 existing tests serve as
  regression gate. Symlink validation had no dedicated tests.
- **`deno task check` result:** PASS (493 tests, all checks passed)
