---
variant: "Variant A: Minimal targeted fix"
tasks:
  - desc: "Rename deno.json test:executor task to test:developer and update path"
    files: ["deno.json"]
  - desc: "Fix QA SKILL.md stale 'Executor' reference to 'Developer'"
    files: [".claude/skills/agent-qa/SKILL.md"]
---

## Justification

**Variant A selected** over B and C for these reasons:

1. **Spec alignment:** `01-spec.md` explicitly states "No SRS changes required"
   — SRS was updated in prior runs (20260314T000902, 20260314T010515). Variant B
   adds unnecessary SRS scope that contradicts the spec's own analysis.

2. **Completeness:** The Architect's audit identified exactly 2 stale references.
   All other `executor` occurrences are legitimate DAG executor terminology (not
   agent name references). No additional files need modification.

3. **Variant C rejected:** Over-engineering. Adding "not-agent" annotations to
   standard DAG executor terminology (`engine/dag.ts`) introduces comment noise.
   The distinction is already clear from context (engine code vs agent skills).

4. **Vision alignment (AGENTS.md):** "Pipeline is project-agnostic" and "Engine
   is domain-agnostic" — the DAG executor references in engine code are correct
   domain terminology and must not be conflated with agent naming. Variant A
   respects this boundary. Minimal change scope keeps project in working
   condition per AGENTS.md rules.

## Task Descriptions

### Task 1: Rename deno.json test task

`deno.json:15` has `"test:executor"` pointing to deleted
`.sdlc/scripts/stage-6-executor_test.ts`. Rename task key to `"test:developer"`
and update path to `stage-6-developer_test.ts` (the renamed file from FR-37
bulk rename).

- **File:** `deno.json`
- **Change:** Single key+value edit in `tasks` object
- **Risk:** None. One-line change, no downstream deps on task name

### Task 2: Fix QA SKILL.md agent name reference

`.claude/skills/agent-qa/SKILL.md:11` contains "Executor's implementation" —
should read "Developer's implementation" to match the renamed agent role.

- **File:** `.claude/skills/agent-qa/SKILL.md`
- **Change:** String replacement in prompt text
- **Risk:** None. Prompt text update, no structural change
