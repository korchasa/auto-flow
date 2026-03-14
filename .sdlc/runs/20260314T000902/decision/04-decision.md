---
variant: "Variant B: Layered rename with verification gates"
tasks:
  - desc: "Rename skill directory and update pipeline config"
    files: [".claude/skills/agent-executor/SKILL.md", ".sdlc/pipeline.yaml"]
  - desc: "Update engine test fixtures (executor → developer node IDs)"
    files: ["engine/config_test.ts", "engine/engine_test.ts", "engine/output_test.ts", "engine/dag_test.ts", "engine/state_test.ts", "engine/agent_test.ts", "engine/log_test.ts", "engine/dag.ts"]
  - desc: "Update documentation (SRS, SDS, CLAUDE.md, AGENTS.md, meta.md, README)"
    files: ["documents/requirements.md", "documents/design.md", "CLAUDE.md", "AGENTS.md", "documents/meta.md", "README.md"]
  - desc: "Rename legacy scripts and update internal references"
    files: [".sdlc/scripts/stage-6-executor.sh", ".sdlc/scripts/stage-6-executor_test.ts", ".sdlc/scripts/stage-7-qa.sh"]
---

## Justification

**Selected: Variant B** over A (atomic) and C (minimal/deferred).

- **Fail-fast alignment:** AGENTS.md mandates "fail fast, fail clearly." Layered
  verification gates isolate failures to a specific category (skill/config vs
  test fixtures vs docs), enabling faster root-cause identification. Variant A's
  single-pass approach risks a 19-file blast radius where one missed reference
  causes cascading failures across unrelated categories.
- **FR-37 compliance:** Variant C explicitly violates FR-37 acceptance criteria
  (requires ALL references updated). Deferring test/doc updates creates
  inconsistency contradicting the spec's "pure rename" scope.
- **Same effort, better debuggability:** Both A and B are effort M with identical
  file scope. B adds 2 extra verify cycles but each layer is independently
  verifiable — net time savings when errors occur.
- **Engine independence preserved:** Engine test fixtures contain only node ID
  strings (cosmetic), not production logic. Updating them in a separate layer
  confirms no engine behavioral change — aligned with "engine is pipeline-
  independent" key decision.

## Task Descriptions

### Task 1: Rename skill directory and update pipeline config

- `git mv .claude/skills/agent-executor .claude/skills/agent-developer`
- Update `SKILL.md` frontmatter `name:` field from `agent-executor` to
  `agent-developer`
- Update `.sdlc/pipeline.yaml`: prompt path (`agent-executor` → `agent-developer`),
  node labels referencing "Executor"
- Verify: `deno task check` (config parse validation)

### Task 2: Update engine test fixtures

- Replace `executor` → `developer` in all 8 engine files where it appears as
  a test fixture node ID string (62 occurrences total)
- No production logic changes — engine is pipeline-independent
- Verify: `deno task test` (all tests pass)

### Task 3: Update documentation

- `documents/requirements.md`: FR-7, FR-19, FR-26, FR-36, Appendix B
- `documents/design.md`: §3.4 agent list, §2.3 node convention, §5 logic
- `CLAUDE.md`: Project Vision agent list, Key Decisions
- `AGENTS.md`: agent list entry
- `documents/meta.md`: historical labels
- `README.md`: agent directory listing
- Verify: `grep -r executor` shows zero hits outside `.sdlc/runs/` and
  engine-internal "executor" (DAG executor, not agent role)

### Task 4: Rename legacy scripts and update internal references

- Rename `stage-6-executor.sh` → `stage-6-developer.sh`
- Rename `stage-6-executor_test.ts` → `stage-6-developer_test.ts`
- Update internal references in both files + `stage-7-qa.sh`
- Verify: legacy script filenames and content consistent
