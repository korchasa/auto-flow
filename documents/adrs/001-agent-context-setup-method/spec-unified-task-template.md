# Spec: Unified task_template with file() for prompt and shared-rules injection

| Field   | Value      |
|---------|------------|
| Status  | Draft      |
| Created | 2026-03-16 |
| Updated | 2026-03-16 |

## Goal

Eliminate the `prompt` field from pipeline nodes and the manual "read
shared-rules.md" instruction from SKILL.md files. Use `file()` in
`task_template` to inline both shared-rules and agent prompt, making injection
automatic and guaranteed (currently agents can ignore the "read shared-rules"
instruction).

## Overview

Current state: each agent node has two text channels to Claude CLI:
- `prompt` → read at config load → `--append-system-prompt` (system prompt addition)
- `task_template` → interpolated at runtime → `-p` (user message)

Shared-rules are referenced via a manual instruction at the top of each
SKILL.md: "Read `.auto-flow/agents/shared-rules.md`". Agents may skip this
read, wasting a turn or ignoring rules entirely.

With `file()` already supported in `task_template`, both SKILL.md content and
shared-rules can be inlined directly into the task prompt. This:
- Guarantees shared-rules are always present in agent context
- Removes one turn (agent no longer needs to Read the shared-rules file)
- Eliminates the `prompt` / `--append-system-prompt` code path for pipeline use
- Makes the prompt composition visible and explicit in pipeline.yaml

Trade-off: SKILL.md content moves from system prompt (`--append-system-prompt`)
to user message (`-p`). Since `--append-system-prompt` only appends to the
existing system prompt (CLAUDE.md), and SKILL.md content is task instructions
(not persona/role), the behavioral impact is minimal.

## Non-Goals

- No engine code changes (no new template variables, no defaults.task_template
  merging, no new fields in NodeConfig or TemplateContext)
- No changes to `file()` implementation in engine/template.ts
- No changes to engine validation logic
- No removal of `prompt` field support from engine (backward compatibility)
- No restructuring of SKILL.md content beyond removing the shared-rules
  read instruction

## Architecture & Boundaries

### Always (agent autonomy)

- Edit pipeline.yaml task_template fields
- Edit SKILL.md files to remove shared-rules read instruction
- Run `deno task check` to verify

### Ask First

- Changing the order of sections in the unified task_template (shared-rules
  vs SKILL.md vs task)

### Never

- Modify engine source code (engine/*.ts)
- Add new fields to pipeline config schema
- Change SKILL.md content beyond removing the shared-rules instruction

## Definition of Done

- [ ] No node in pipeline.yaml uses the `prompt` field
- [ ] Every agent node's `task_template` inlines shared-rules via
      `{{file(".auto-flow/agents/shared-rules.md")}}`
- [ ] Every agent node's `task_template` inlines its SKILL.md via
      `{{file(".auto-flow/agents/<agent-name>/SKILL.md")}}`
- [ ] No SKILL.md contains the "read shared-rules" instruction
- [ ] `deno task check` passes
- [ ] Pipeline runs without errors (manual verification)

---

## Phase 1: Update pipeline.yaml — replace prompt with file() in task_template

**Status:** done | **Prerequisites:** none

### Goal

Rewrite each agent node in pipeline.yaml: remove `prompt` field, prepend
`file()` calls for shared-rules and SKILL.md to `task_template`.

### Scope

- `.auto-flow/pipeline.yaml`

### Tasks

1. For each of the 6 agent nodes (specification, design, decision, build,
   verify, tech-lead-review): remove `prompt` field, prepend two `file()`
   lines to `task_template`:
   ```yaml
   task_template: |
     {{file(".auto-flow/agents/shared-rules.md")}}
     ---
     {{file(".auto-flow/agents/<agent-name>/SKILL.md")}}
     ---
     <existing task_template content>
   ```
2. Verify YAML syntax is valid (`deno task check` or yq parse)

### Verification

- [ ] `grep -c 'prompt:' .auto-flow/pipeline.yaml` returns 0 (no prompt fields)
- [ ] All 6 agent nodes contain `{{file("...shared-rules.md")}}`
- [ ] All 6 agent nodes contain `{{file("...SKILL.md")}}`
- [ ] `deno task check` passes

### Notes

- Loop body nodes (build, verify) are nested under `implementation.nodes` —
  same transformation applies
- Separator `---` between sections aids model parsing of boundaries

---

## Phase 2: Clean up SKILL.md files — remove shared-rules read instruction

**Status:** done | **Prerequisites:** Phase 1

### Goal

Remove the now-redundant "read shared-rules.md" instruction from all SKILL.md
files, since shared-rules are inlined automatically via `file()`.

### Scope

- `.auto-flow/agents/agent-pm/SKILL.md`
- `.auto-flow/agents/agent-architect/SKILL.md`
- `.auto-flow/agents/agent-tech-lead/SKILL.md`
- `.auto-flow/agents/agent-developer/SKILL.md`
- `.auto-flow/agents/agent-qa/SKILL.md`
- `.auto-flow/agents/agent-tech-lead-review/SKILL.md`

### Tasks

1. In each SKILL.md, remove the "BEFORE YOU DO ANYTHING" block that instructs
   the agent to read shared-rules.md (typically lines 7-10)
2. Verify no other references to "shared-rules.md" remain in SKILL.md files

### Verification

- [ ] `grep -r 'shared-rules' .auto-flow/agents/agent-*/SKILL.md` returns empty
- [ ] `deno task check` passes

### Notes

- Each SKILL.md has YAML frontmatter (name, description, compatibility) —
  preserve it unchanged
