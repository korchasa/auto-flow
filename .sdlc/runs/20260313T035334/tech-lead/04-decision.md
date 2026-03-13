---
variant: "Variant A"
tasks:
  - desc: "Move .sdlc/engine/ to top-level engine/ via git mv"
    files: ["engine/"]
  - desc: "Update deno.json task paths from .sdlc/engine/ to engine/"
    files: ["deno.json"]
  - desc: "Update documentation references: SDS, SRS, CLAUDE.md, AGENTS.md, README.md"
    files: ["documents/design.md", "documents/requirements.md", "CLAUDE.md", "AGENTS.md", "README.md"]
  - desc: "Run tests to verify engine works from new location"
    files: []
---

## Critique

### Variant A: Move engine to top-level `engine/`

- **Gap:** Plan omits `README.md` which references `.sdlc/engine/` in 2 places
  (line 9, line 38). Also omits `.sdlc/tasks/` files with engine path references
  — low priority (task files are historical) but should be noted.
- **Incorrect assumption:** Items 3-4 list "no change needed" for `state.ts` and
  `cli.ts` as if they were changes. These are non-changes, not steps. Misleading
  as task items.

### Variant B: Move engine + relocate pipeline config and scripts

- **Scope creep:** Issue #12 requests engine-pipeline separation, not pipeline
  config relocation. Moving `pipeline.yaml` and `scripts/` adds 3 directory
  moves and 10+ deno.json task path updates beyond the spec.
- **Naming collision:** Merging `.sdlc/scripts/` into `scripts/sdlc/` creates
  confusion — `scripts/` already contains `check.ts`, `self_runner.ts`,
  `loop_in_claude.ts` (engine-support scripts), distinct from legacy stage
  scripts.

### Variant C: Move engine + relocate runs

- **Scope violation:** Spec says "runs/ directory must be gitignored" but does
  not mandate relocation. Moving runs is explicitly out of scope per spec
  "Scope Boundaries" section.
- **Cascading risk:** `getRunDir()` return value change affects all callers
  (engine, templates, tests). Any hardcoded `.sdlc/runs/` in agent SKILL.md
  files would break silently.

## Justification

**Variant A** selected for:

- **Technical fit:** Minimal blast radius (1 directory move, 3 deno.json path
  updates, doc updates). All engine internal imports use `./`-relative paths —
  move is transparent. No functional code changes needed.
- **Vision alignment:** AGENTS.md states "Engine is domain-agnostic: Engine is a
  generic DAG executor. It MUST NOT contain git, GitHub, branch, PR, or any
  other domain-specific logic." Moving engine to top-level `engine/` physically
  enforces this separation — engine is no longer nested under `.sdlc/` alongside
  domain-specific pipeline config, scripts, and runs.
- **Complexity/maintainability:** Effort S. Single atomic move with grep-
  verifiable doc updates. No runtime behavior change. Variants B/C add M effort
  with higher risk and no additional value for issue #12.

## Task Descriptions

### Task 1: Move .sdlc/engine/ to top-level engine/

`git mv .sdlc/engine/ engine/` — moves all 30 TS files (16 source + 14 tests).
Engine internal imports unchanged (all `./`-relative). Verify directory exists
post-move.

### Task 2: Update deno.json task paths

Update 3 tasks referencing `.sdlc/engine/`:
- `run`: `.sdlc/engine/cli.ts` → `engine/cli.ts`
- `run:validate`: `.sdlc/engine/mod.ts` → `engine/mod.ts`
- `test:engine`: `.sdlc/engine/` → `engine/`

### Task 3: Update documentation references

Grep-and-replace all `.sdlc/engine/` references in:
- `documents/design.md` (SDS) — sections 2, 3.6, 5
- `documents/requirements.md` (SRS) — FR-8, FR-10, FR-12, FR-14, FR-17, FR-18, FR-21, evidence paths
- `CLAUDE.md` — Architecture section
- `AGENTS.md` — Architecture section
- `README.md` — intro and directory listing

### Task 4: Run tests to verify

Execute `deno task test:engine` and `deno task check` from new location. Verify
all existing tests pass with zero changes to test code. Verify `deno task run
--dry-run` works.
