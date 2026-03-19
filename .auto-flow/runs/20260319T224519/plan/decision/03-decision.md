---
variant: "Variant A: Direct migration per FR-S38 template"
tasks:
  - desc: "Remove prompt: field and inject shared-rules.md + SKILL.md via file() in task_template for all 6 agent nodes"
    files: [".auto-flow/pipeline.yaml"]
  - desc: "Run deno task check to verify pipeline config validity post-migration"
    files: []
---

## Justification

I selected Variant A because it directly implements the FR-S38 acceptance
criteria with zero deviation. Key reasons:

- **Full spec compliance:** FR-S38 AC#1-4 satisfied by construction — all 6
  nodes use `{{file(...)}}` in `task_template`, no node retains `prompt:`,
  `---` separators match the prescribed template, `deno task check` validates.
- **Single-file change:** Only `.auto-flow/pipeline.yaml` modified. No engine
  code, no SRS amendments, no SKILL.md restructuring needed.
- **AGENTS.md alignment:** "YAML pipeline config defines node graph" — making
  prompt composition explicit in `task_template` moves from implicit
  `prompt:`-based loading to declarative `file()` injection visible in config.
  "Agents are stateless — all context from file artifacts and system prompts"
  — context delivery mechanism changes but statelessness preserved.
- **Variant B rejected:** H1 markers deviate from FR-S38 prescribed `---`
  separator format and conflict with SKILL.md internal `# Role:` headings.
  Would require SRS amendment or create spec-implementation mismatch.
- **Variant C rejected:** Violates FR-S38 AC#3 ("No agent node may use the
  `prompt:` field") and requires engine changes (out of scope).

## Task Descriptions

### Task 1: Migrate 6 agent nodes from prompt: to file() injection

For each of the 6 agent nodes (`specification`, `design`, `decision`, `build`,
`verify`, `tech-lead-review`) in `.auto-flow/pipeline.yaml`:

1. Remove the `prompt:` line (e.g., `prompt: ".auto-flow/agents/agent-pm/SKILL.md"`).
2. Prepend to `task_template` the `file()` injection block:
   ```yaml
   task_template: |
     {{file(".auto-flow/agents/shared-rules.md")}}
     ---
     {{file(".auto-flow/agents/agent-<name>/SKILL.md")}}
     ---
     <existing task_template content unchanged>
   ```
3. Existing `task_template` body (input refs, reflection memory instructions,
   task-specific context) remains verbatim after the `---` separator.

All 6 nodes follow identical pattern. Mechanical edit — no conditional logic.

### Task 2: Validate pipeline config post-migration

Run `deno task check` to confirm:
- `loadConfig()` succeeds (no schema errors from missing `prompt:` field —
  field is optional in engine schema).
- All `file()` template paths resolve (engine validates referenced files exist).
- No regressions in existing validation checks.

## Summary

I selected Variant A (direct migration per FR-S38 template). It implements the
exact `file()` injection structure prescribed by FR-S38 with `---` separators,
requires changes to only `.auto-flow/pipeline.yaml` (6 node blocks), and
satisfies all 4 acceptance criteria. 2 tasks: migration edit + validation run.
Branch `sdlc/issue-156` created, draft PR opened.
