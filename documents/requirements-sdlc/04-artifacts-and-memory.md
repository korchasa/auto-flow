<!-- section file — index: [documents/requirements-sdlc.md](../requirements-sdlc.md) -->

# SRS SDLC — Artifacts Layout and Agent Memory


### 3.17 FR-S17: Agent Prompt Layout

- **Status:** Superseded by FR-S47 — canonical agent location is now
  `.flowai-workflow/<name>/agents/agent-<role>.md` (single Markdown file per
  agent; the earlier `agent-<name>/SKILL.md` directory layout is dropped).
- **Description (current):** Each workflow folder owns its agent prompts as
  flat Markdown files under `.flowai-workflow/<name>/agents/agent-<role>.md`.
  Files are framework-independent (no spec-bound frontmatter required) and
  loaded by `system_prompt: '{{file(...)}}'` in `workflow.yaml`.
- **Description (legacy):** Earlier revisions of this FR required
  agentskills.io-compliant skill directories at `.flowai-workflow/agents/agent-<name>/SKILL.md`. That layout is no longer used; agent prompts ship as plain `.md` files inside the workflow folder.
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
  - [x] After engine FR-E9 implementation, artifact directories follow `.flowai-workflow/runs/<run-id>/<phase>/<node-id>/` layout for all phased nodes. Evidence: `state.ts:20-36` (`setPhaseRegistry()`), `state.ts:98-103` (`getNodeDir()` phase-aware path), `engine.ts:129-130` (init at run start).
  - [x] `{{input.<node-id>}}` and `{{node_dir}}` template variables resolve to phase-aware paths for phased nodes. Evidence: `state.ts:44-46` (`getPhaseForNode()`); `getNodeDir()` underpins template variable resolution.
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

- **Status:** Superseded by FR-S47 — the consolidation unit is now the
  workflow folder `.flowai-workflow/<name>/`, not the top-level
  `.flowai-workflow/`. Multiple workflow folders may coexist as siblings.
- **Desc (current):** All assets for a single workflow (config, agent
  prompts, memory, scripts, runs, worktrees) live under one
  `.flowai-workflow/<name>/` directory. The top level
  `.flowai-workflow/` holds only workflow folders — never files.
- **Desc (legacy):** Earlier revisions required all assets at the flat
  top level (`.flowai-workflow/agents/`, `.flowai-workflow/scripts/`,
  …). That layout is replaced by the per-workflow folder shape; each
  workflow is a self-contained, portable unit.
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
  4. **Commit** memory + history files in the worktree before exiting the
     session (prevents reflection-loss; in-loop nodes may opt out via
     `memory_commit_deferred: true` in `workflow.yaml`).
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
  - [x] **Commit step in lifecycle:** Each agent's reflection-protocol
    appendix instructs it to commit memory + history files at session end.
    `.flowai-workflow/memory/reflection-protocol.md` §Lifecycle includes
    step 3c. Evidence: `.flowai-workflow/memory/reflection-protocol.md:49-50`
    (step "c. Commit MEMORY + HISTORY files").
  - [x] **Engine enforcement:** When `defaults.memory_paths` is configured
    in `workflow.yaml`, the engine checks the worktree's working tree
    after each agent invocation; if any path matching the configured globs
    is dirty AND the node has not declared `memory_commit_deferred: true`,
    the node is failed with an explicit reflection-violation message.
    Evidence: `node-dispatch.ts:163-186`; helper `memory-check.ts:24-53`;
    test suite `memory-check_test.ts` (8 cases).
  - [x] **`memory_commit_deferred` opt-out:** Per-node boolean flag in
    `NodeConfig` (default `false`) that disables the per-invocation dirty
    check. Intended for loop-body agents (e.g. `build`) that defer their
    commit to a later iteration. Evidence: `types.ts:225-229`;
    `config.ts:524-531`; consumed at `node-dispatch.ts:172`.
  - [x] **`workflow.yaml`:** SDLC workflow declares
    `defaults.memory_paths` and sets `memory_commit_deferred: true` on the
    `build` node. Evidence: `.flowai-workflow/workflow.yaml:24-25`
    (`memory_paths: [.flowai-workflow/memory/agent-*.md]`); line 135
    (`memory_commit_deferred: true` on the build node).



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

- **Description:** `defaults.hitl.artifact_source` in `workflow.yaml` is
  optional. When set, it MUST reference the upstream node via
  `{{input.<node-id>}}/…` template syntax — a hardcoded relative path is
  rejected at parse time by the SDLC-level validator. Engine interpolates the
  template at runtime in `buildScriptArgs()`. The SDLC workflow now uses
  Telegram HITL transport (see SDS §3.5) which does not read any artifact —
  the field is therefore absent from `workflow.yaml`; validation still
  enforces template syntax for any other workflow that opts in.
- **Extends:** FR-S24 (Workflow Config Validation) — concrete application of
  config validation for `hitl.artifact_source`.
- **Acceptance criteria:**
  - [x] `workflow.yaml` omits `defaults.hitl.artifact_source` (Telegram
    transport does not require it). Evidence:
    `.flowai-workflow/workflow.yaml:18-22`.
  - [x] `interpolate()` applied to `artifact_source` in
    `hitl.ts:buildScriptArgs()` before passing value to scripts; ctx
    threaded through `HitlRunOptions`. Evidence: `hitl.ts:257,264`.
  - [x] `validateHitlArtifactSource(config)` exported pure function: returns
    error message for hardcoded path (no `{{`), empty array for template or
    absent field. Evidence: `scripts/check.ts:110–118`.
  - [x] `hitlArtifactSource()` validation function in `scripts/check.ts` reads
    workflow config, calls `validateHitlArtifactSource()`, emits error and
    exits 1 on hardcoded path. Evidence: `scripts/check.ts:120–146`.
  - [x] Test `runHitlLoop — artifact_source template resolved via ctx` in
    `hitl_test.ts` verifies `{{input.specification}}/01-spec.md` →
    `/runs/abc/specification/01-spec.md`. Evidence:
    `hitl_test.ts:232–277`.
  - [x] Tests in `scripts/check_test.ts` cover: valid template path (pass),
    hardcoded path (fail), absent field (skip/pass), empty string (skip/pass).
    Evidence: `scripts/check_test.ts:109–130`.
  - [x] `deno task check` passes. Evidence: PASS (519 tests, run
    `20260319T204544`).





### 3.47 FR-S47: Workflow Folder Contract

- **Description:** A "workflow" is the unit of consolidation. Every
  workflow lives at `.flowai-workflow/<name>/` and is fully self-
  contained: it owns its `workflow.yaml`, agent prompts, memory,
  scripts, runs and worktrees. A single project may host any number
  of workflow folders as siblings under `.flowai-workflow/`. Top-
  level `.flowai-workflow/` MUST NOT contain any non-folder entries
  (no `runs/`, no `memory/`, no shared `_shared/` — keep workflows
  isolated; copy duplicates instead).
- **Required entries** (per workflow folder):
  - `workflow.yaml` — engine config; `name:` matches `<name>`.
  - `agents/agent-*.md` — REQUIRED iff `workflow.yaml` references any
    `{{file("…/agents/agent-*.md")}}` prompt. Optional otherwise.
- **Optional entries:** `memory/`, `scripts/`, `runs/`, `tasks/`,
  `.gitignore`, `.template.json`. (FR-E57: per-run worktrees live under
  `runs/<run-id>/worktree/` — there is no top-level `worktrees/` folder.)
- **Cross-workflow drift:** Agent prompt copies between workflow
  folders are intentional duplicates. Edits to a shared agent must be
  applied to every copy or a deliberate divergence must be recorded
  in CLAUDE.md / AGENTS.md.
- **Acceptance:**
  - [x] `assertWorkflowFolderShape(dir)` enforces the contract on
    every dogfood workflow folder. Evidence:
    `scripts/check.ts::assertWorkflowFolderShape`,
    `scripts/check.ts::workflowIntegrity`,
    `scripts/check_test.ts` (5 cases covering OK / missing-yaml /
    missing-agents-when-referenced / no-agents-when-not-referenced /
    empty-agents).
  - [x] Top-level `.flowai-workflow/` of this repo holds exactly the
    three workflow folders `github-inbox`, `github-inbox-opencode`,
    `github-inbox-opencode-test` and zero files. Evidence:
    `dogfood_layout_test.ts`.
  - [x] No active configs/code reference `.claude/agents/`. Evidence:
    `scripts/check.ts::noClaudeAgentsRefs` runs as part of
    `workflowIntegrity` in `deno task check`.
  - [x] `state.json` migration helper `scripts/migrate-state-paths.ts`
    rewrites legacy paths in-place; idempotent. Evidence:
    `scripts/migrate-state-paths_test.ts` (3 cases: rewrite, idempotent,
    walk).
