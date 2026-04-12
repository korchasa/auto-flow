<!-- section file — index: [documents/requirements-sdlc.md](../requirements-sdlc.md) -->

# SRS SDLC — Artifacts Layout and Agent Memory


### 3.17 FR-S17: Agentskills.io-Compliant Skill Layout

- **Description:** All workflow agent skills must conform to the [agentskills.io specification](https://agentskills.io/specification). Canonical skill directories live in `.flowai-workflow/agents/agent-<name>/`. Associated stage scripts co-located under `scripts/` subdirectory of each skill. Frontmatter uses only spec-defined fields.
- **Motivation:** Spec compliance enables standard skill tooling and discovery. Co-location reduces cognitive overhead. Removing the `agents/` → `.claude/skills/` symlink indirection eliminates broken-symlink failure mode.
- **Acceptance criteria:**
  - [x] Each skill directory `.flowai-workflow/agents/agent-<name>/` contains `SKILL.md` with frontmatter fields: `name` (matches directory name), `description`, `compatibility`, `allowed-tools`. No `disable-model-invocation` field. Expected: `.flowai-workflow/agents/agent-pm/SKILL.md`, `.flowai-workflow/agents/agent-architect/SKILL.md`, `.flowai-workflow/agents/agent-tech-lead/SKILL.md`, `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md`, `.flowai-workflow/agents/agent-developer/SKILL.md`, `.flowai-workflow/agents/agent-qa/SKILL.md`, `.flowai-workflow/agents/agent-meta-agent/SKILL.md`. Evidence: commit `f0085df sdlc(impl): rename Executor agent role to Developer (FR-S18)`; QA PASS run `20260314T000902` (436 tests)
  - [x] Stage scripts formally deprecated (superseded by engine); co-location N/A for deprecated scripts. Evidence: deprecation headers added to all `.flowai-workflow/scripts/stage-*.sh`; `AGENT_PROMPT` paths updated to `.flowai-workflow/agents/agent-<name>/SKILL.md` (this commit).
  - [x] `hitl-ask.sh`, `hitl-check.sh`, `lib.sh`, and shared utilities remain in `.flowai-workflow/scripts/` (engine infrastructure, not agent skills). Evidence: `.flowai-workflow/scripts/hitl-ask.sh`, `.flowai-workflow/scripts/hitl-check.sh`, `.flowai-workflow/scripts/lib.sh`
  - [x] `agents/` top-level directory removed; no broken symlinks in `.claude/skills/`. Evidence: commit `985e3e5 sdlc(impl): remove agents/ directory and fix stale path references`
  - [x] `workflow.yaml` `prompt:` fields updated to `.flowai-workflow/agents/agent-<name>/SKILL.md`. Evidence: `.flowai-workflow/workflow.yaml` (commit `6176e91`)
  - [x] `documents/requirements-sdlc.md` path references updated to reflect new `.claude/skills/` layout and FR-S18 rename. Evidence: this update (run `20260314T010515`); commit `f0085df`
  - [x] `deno task check` passes after migration. Evidence: QA PASS — 436 tests pass (run `20260313T230627`)



### 3.25 FR-S25: Phase-Organized SDLC Artifact Directories

- **Description:** SDLC workflow nodes with a `phase` config field must store output artifacts in phase-organized subdirectories (`.flowai-workflow/runs/<run-id>/<phase>/<node-id>/`). Nodes without `phase` use flat layout (`.flowai-workflow/runs/<run-id>/<node-id>/`). Depends on engine FR-E9 implementation.
- **Rationale:** SDLC workflow nodes are grouped into `plan`, `impl`, `report` phases in `workflow.yaml`. Phase-organized storage improves navigability and aligns artifact structure with declared execution flow. Without engine FR-E9 (phase registry + phase-aware `getNodeDir()`), the `phase` field in `workflow.yaml` has no effect on artifact paths.
- **Acceptance criteria:**
  - [x] All SDLC workflow nodes in `.flowai-workflow/workflow.yaml` have `phase:` field set to `plan`, `impl`, or `report` as appropriate. Evidence: `.flowai-workflow/workflow.yaml` (specification, design, decision → `plan`; implementation → `impl`; tech-lead-review, optimize → `report`).
  - [x] After engine FR-E9 implementation, artifact directories follow `.flowai-workflow/runs/<run-id>/<phase>/<node-id>/` layout for all phased nodes. Evidence: `engine/state.ts:20-36` (`setPhaseRegistry()`), `engine/state.ts:98-103` (`getNodeDir()` phase-aware path), `engine/engine.ts:129-130` (init at run start).
  - [x] `{{input.<node-id>}}` and `{{node_dir}}` template variables resolve to phase-aware paths for phased nodes. Evidence: `engine/state.ts:44-46` (`getPhaseForNode()`); `getNodeDir()` underpins template variable resolution.
  - [x] SDLC workflow runs end-to-end successfully with phase subdirectory layout.
    Evidence: `.flowai-workflow/runs/20260314T154052/plan/specification/`,
    `.flowai-workflow/runs/20260314T154052/plan/design/`,
    `.flowai-workflow/runs/20260314T154052/plan/decision/`,
    `.flowai-workflow/runs/20260314T154052/impl/implementation/`,
    `.flowai-workflow/runs/20260314T154052/report/tech-lead-review/`,
    `.flowai-workflow/runs/20260314T154052/report/optimize/` — 6 phase-organized node
    directories across all 3 phases (`plan`, `impl`, `report`).
  - [x] `deno task check` passes. Evidence: `deno task check` exit 0, 498 tests
    passed, 0 failed, run 20260314T154052.



### 3.26 FR-S26: Workflow Asset Directory Consolidation

- **Desc:** All workflow assets (config, agent prompts, scripts, tasks, runs) MUST be consolidated under `.flowai-workflow/` directory. Eliminates `.flowai-workflow/` (domain-specific naming, violates engine's domain-agnostic principle) and decouples agent prompts from `.claude/skills/` (Claude Code's skill-system coupling).
- **Directory layout:**
  ```
  .flowai-workflow/
  ├── workflow.yaml          # from .flowai-workflow/workflow.yaml
  ├── agents/                # from .flowai-workflow/agents/agent-*/
  │   └── <name>/SKILL.md   # 6 agents
  ├── scripts/               # active scripts only (from .flowai-workflow/scripts/)
  │   ├── rollback-uncommitted.sh
  │   ├── hitl-ask.sh
  │   ├── hitl-check.sh
  │   └── lib.sh
  ├── tasks/                 # from .flowai-workflow/tasks/
  └── runs/                  # from .flowai-workflow/runs/
  ```
- **Rationale:** Single discoverable location; easier portability between projects; `.flowai-workflow/` is engine-brand-aligned and domain-agnostic.
- **Migration actions:**
  - Delete deprecated `stage-*.sh` scripts and their `*_test.ts` files (already marked DEPRECATED).
  - Update all internal path references: `workflow.yaml`, engine CLI defaults, `deno.json` tasks, docs, `CLAUDE.md`.
  - `.claude/hooks/guard-deno-direct.sh` stays in `.claude/hooks/` (Claude Code hooks dir is fixed by Claude Code; not movable).
- **Acceptance:**
  - [ ] `workflow.yaml` at `.flowai-workflow/workflow.yaml`
  - [ ] Agent prompts at `.flowai-workflow/agents/<name>/SKILL.md` (6 agents: pm, architect, tech-lead, developer, qa, tech-lead-review)
  - [ ] Active scripts at `.flowai-workflow/scripts/` (rollback-uncommitted.sh, hitl-ask.sh, hitl-check.sh, lib.sh)
  - [ ] Tasks at `.flowai-workflow/tasks/`; runs at `.flowai-workflow/runs/`
  - [ ] Deprecated stage scripts (`stage-*.sh`) and their `*_test.ts` files deleted
  - [x] Zero `.flowai-workflow/` path references remain in codebase (except git history). Evidence: completed in this commit.
  - [x] Zero `.flowai-workflow/agents/agent-*` path references remain in codebase. Evidence: completed in this commit.
  - [ ] `deno task run` works with `.flowai-workflow/workflow.yaml` as default config path
  - [ ] `deno task check` passes clean
  - [ ] All docs (CLAUDE.md, AGENTS.md, SRS, SDS) updated with new paths
  - [ ] `.claude/hooks/guard-deno-direct.sh` placement decision documented (stays in `.claude/hooks/`)



### 3.28 FR-S28: Per-Agent Reflection Memory

- **Description:** Each agent owns its own reflection memory stored at `.flowai-workflow/memory/<agent-name>.md`. At session start, agent reads its memory file. At session end, agent rewrites the file in full (not append) with compressed current-state knowledge: anti-patterns, effective strategies, environment quirks, baseline metrics. Agent decides what to retain, evicting stale or resolved items.
- **Motivation:** Centralized `documents/meta.md` caused: (1) git history pollution from per-run updates to `documents/`; (2) merge conflicts on concurrent runs; (3) ~60% dead-weight content (resolved patterns duplicate git history); (4) no measurable quality improvement; (5) scope violation (workflow-level data in project docs). Per-agent decentralized memory eliminates all five issues.
- **Storage:** `.flowai-workflow/memory/<agent-name>.md` — one file per agent. Git tracking TBD (tracked enables review; gitignored avoids noise — open decision per issue #117).
- **Lifecycle per agent run:**
  1. Read `.flowai-workflow/memory/<self>.md` at session start before main work.
  2. Execute main task.
  3. Rewrite `.flowai-workflow/memory/<self>.md` at end — full rewrite, compress stale data out.
- **Memory content (agent-curated, ≤50 lines):**
  - Known anti-patterns in own behavior and avoidance strategies.
  - Effective strategies discovered empirically.
  - Environment quirks and gotchas.
  - Baseline metrics (turns, cost) for self-assessment.
- **Scope:** All 6 workflow agents: pm, architect, tech-lead, tech-lead-review, developer, qa.
- **Acceptance criteria:**
  - [x] `.flowai-workflow/memory/` directory exists in repo.
  - [x] Each of 6 agent `SKILL.md` files includes: (a) read-memory step at
    session start, (b) rewrite-memory step at session end.
  - [x] `workflow.yaml` `task_templates` or `defaults` exposes
    `.flowai-workflow/memory/<agent-name>.md` path to each agent.
  - [ ] `documents/meta.md` removed or repurposed (no longer used as shared
    cross-run memory).
  - [x] At least one end-to-end workflow run completes with agents
    reading/writing their own memory files.
  - [x] `deno task check` passes after changes.



### 3.32 FR-S32: SDLC Artifact File Numbering Standard

- **Description:** SDLC workflow artifact filenames MUST use gapless sequential
  numeric prefixes reflecting actual workflow execution order.
- **Motivation:** Non-gapless or inverted prefix numbering (e.g., `06-impl-summary`
  produced before `05-qa-report`) breaks alphabetical-sort as an execution-order
  proxy, creating confusion for developers and tooling relying on prefix ordering.
- **Rules:**
  - Prefix sequence MUST be gapless (`01, 02, 03, …`) — no skipped numbers.
  - Prefix order MUST match DAG execution order.
  - All references (workflow.yaml, agent SKILL.md prompts, docs, validation rules)
    MUST use the canonical gapless filenames.
- **Acceptance criteria:**
  - [x] Artifact sequence is `01-spec → 02-plan → 03-decision → 04-impl-summary →
    05-qa-report → 06-review` — no gaps, no ordering inversions. Evidence:
    `.flowai-workflow/workflow.yaml` outputs, `documents/design-sdlc.md §2.2`.
  - [x] `workflow.yaml`, all agent SKILL.md files, and documentation reference the
    canonical gapless filenames exclusively (zero matches for old names
    `04-decision`, `06-impl-summary`, `08-review`). Evidence: grep sweep
    post-implementation confirms zero matches across all SKILL.md files and docs.



### 3.35 FR-S35: HITL Artifact Source Node Reference

- **Description:** `defaults.hitl.artifact_source` in `workflow.yaml` MUST
  reference the upstream node via `{{input.<node-id>}}/…` template syntax
  instead of a hardcoded relative path. Engine interpolates the template at
  runtime in `buildScriptArgs()`. SDLC-level validator emits a parse-time error
  if a hardcoded path (no `{{input.`) is detected. HITL polling behavior and
  timing remain unchanged.
- **Extends:** FR-S24 (Workflow Config Validation) — concrete application of
  config validation for `hitl.artifact_source`.
- **Acceptance criteria:**
  - [x] `workflow.yaml` `defaults.hitl.artifact_source` uses
    `{{input.specification}}/01-spec.md` template syntax. Evidence:
    `.flowai-workflow/workflow.yaml:23`.
  - [x] `interpolate()` applied to `artifact_source` in
    `engine/hitl.ts:buildScriptArgs()` before passing value to scripts; ctx
    threaded through `HitlRunOptions`. Evidence: `engine/hitl.ts:257,264`.
  - [x] `validateHitlArtifactSource(config)` exported pure function: returns
    error message for hardcoded path (no `{{`), empty array for template or
    absent field. Evidence: `scripts/check.ts:110–118`.
  - [x] `hitlArtifactSource()` validation function in `scripts/check.ts` reads
    workflow config, calls `validateHitlArtifactSource()`, emits error and
    exits 1 on hardcoded path. Evidence: `scripts/check.ts:120–146`.
  - [x] Test `runHitlLoop — artifact_source template resolved via ctx` in
    `engine/hitl_test.ts` verifies `{{input.specification}}/01-spec.md` →
    `/runs/abc/specification/01-spec.md`. Evidence:
    `engine/hitl_test.ts:232–277`.
  - [x] Tests in `scripts/check_test.ts` cover: valid template path (pass),
    hardcoded path (fail), absent field (skip/pass), empty string (skip/pass).
    Evidence: `scripts/check_test.ts:109–130`.
  - [x] `deno task check` passes. Evidence: PASS (519 tests, run
    `20260319T204544`).


