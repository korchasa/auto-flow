---
variant: "Variant B: Replace diagram, document tasks explicitly"
tasks:
  - desc: "Replace SDS §2.1 legacy Mermaid diagram with deprecation tombstone"
    files: ["documents/design-sdlc.md"]
  - desc: "Rewrite SDS §3.2 Stage Scripts with accurate deprecated task list"
    files: ["documents/design-sdlc.md"]
  - desc: "Run deno task check to verify no regressions"
    files: []
---

## Justification

I selected Variant B because it delivers the cleanest outcome within the spec's
scope boundaries (§2.1 and §3.2 only). Key reasons:

- **Removes cognitive noise:** The legacy 9-stage Mermaid diagram in §2.1 is
  misleading — it shows removed stages (Reviewer, Architect, SDS Update,
  Presenter) as active nodes. Variant B replaces it with a compact tombstone
  referencing §2.2 as the authoritative diagram. Git history preserves the
  original for anyone needing historical context.
- **Accurate task documentation:** §3.2 currently implies legacy `test:*` tasks
  are functional. Variant B rewrites the section to explicitly list the 9 tasks
  with DEPRECATED status and superseding reference (`deno task run`).
- **Vision alignment (AGENTS.md):** The project uses its own SDLC pipeline as
  both development method and reference example. Inaccurate SDS sections
  undermine this dogfooding model — agents reading stale docs may produce
  incorrect outputs. FR-S23 directly addresses this.
- **Scope discipline:** Variant A retains unnecessary diagram noise. Variant C
  merges §3.3 into §3.2, exceeding the spec's stated scope ("narrowly scoped to
  sections 2.1 and 3.2"). Variant B is the optimal balance.

## Task Descriptions

### Task 1: Replace SDS §2.1 legacy Mermaid diagram with deprecation tombstone

Remove the full `graph LR` Mermaid block (lines 13-29 of current
`design-sdlc.md`). Replace with a compact tombstone noting: legacy 9-stage
shell pipeline removed, stages 3/4/5/8 absorbed/eliminated per FR-S15, current
architecture in §2.2. Update section heading deprecation label from
"pre-FR-26" to "pre-FR-S15" (correct FR numbering per scope separation).

### Task 2: Rewrite SDS §3.2 Stage Scripts with accurate deprecated task list

Rewrite §3.2 to accurately document: (1) formal deprecated status with
superseding reference (engine `deno task run`), (2) explicit list of 9 legacy
`test:*` deno.json tasks (`test:lib`, `test:pm`, `test:tech-lead`,
`test:reviewer`, `test:architect`, `test:sds-update`, `test:developer`,
`test:qa`, `test:presenter`, `test:meta-agent`) with DEPRECATED label, (3)
note that tasks reference `.sdlc/scripts/` shell scripts superseded by engine.

### Task 3: Run `deno task check` to verify no regressions

Execute `deno task check` to confirm no linting, formatting, or test failures
introduced by documentation changes. This satisfies FR-S23 acceptance criterion
#3.

## Summary

- I selected Variant B (replace diagram + document tasks explicitly) for its
  clean removal of misleading legacy diagram and accurate task documentation.
- I defined 3 tasks: §2.1 tombstone replacement, §3.2 task list rewrite, and
  verification via `deno task check`.
- I will create branch `sdlc/issue-97` and open a draft PR.
