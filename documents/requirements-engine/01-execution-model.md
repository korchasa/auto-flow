<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Execution Model


### 3.1 FR-E1: Continuation Mechanism

- **Description:** Each stage script wraps the selected agent runtime invocation and validates the agent's output before considering the stage complete. If validation fails, the script re-invokes the agent in the same session using the runtime's session-resume mechanism (`claude --resume`, `opencode run --session`) with a description of the problem, giving the agent a chance to fix its output without starting from scratch.
- **Acceptance criteria:**
  - **Tests:** `agent_test.ts`, `validate_test.ts`, `scope-check_test.ts`
    (regression-locked; continuation loop with limit + session-resume,
    `custom_script` and `frontmatter_field` validation rules, scope
    check via FR-E37).
  - [x] Legacy shell implementation in `lib.sh`: `continuation_loop()`,
    `safety_check_diff()`, `run_agent()`, `retry_with_backoff()`.
    Evidence: `.flowai-workflow/scripts/lib.sh:59-233`.

  Quality metrics (observability targets, tracked in dashboards, not
  per-FR acceptance):
  - Continuation success rate: percentage of continuations that resolve
    the issue (target > 70%).
  - Average continuations per stage (target < 1.0 across all runs).



### 3.3 FR-E3: Artifact Versioning

- **Description:** Defines how workflow artifacts are managed on repeated runs for the same issue.
- **Acceptance criteria:**
  - On re-run, artifacts in `.flowai-workflow/workflow/<issue-number>/` are overwritten.
  - Previous versions are preserved in git history of the feature branch.
  - QA reports use iteration suffix (`05-qa-report-1.md`, `05-qa-report-2.md`) within a single run; on re-run, iteration numbering restarts from 1.
  - Log files are overwritten on re-run (previous logs preserved in git history).



### 3.5 FR-E5: Project Directory Structure

- **Description:** Project directory layout must reflect application structure, not be buried under a single `.flowai-workflow/` prefix. Engine code, agent prompts, workflow config, and run artifacts should be organized at the top level as distinct concerns.
- **Motivation:** Current `.flowai-workflow/` prefix conflates engine source code, configuration, runtime data, and legacy scripts. This hinders navigation, IDE support, and standard tooling (test runners, linters).
- **Acceptance criteria:**
  - [x] Engine source code lives under a standard `src/` or dedicated top-level directory (not `.flowai-workflow/engine/`). Evidence: `engine/` (top-level directory, 30 files moved via `git mv .flowai-workflow/engine/ engine/`)
  - ~~`[ ] Agent prompts in a top-level agents/ directory`~~ — superseded by FR-S17/FR-S13: canonical location is `.flowai-workflow/agents/agent-<name>/`.
  - [x] Workflow config path resolved from positional `<workflow>`
    argument (FR-E53; `<workflow>/workflow.yaml`). With FR-S47 the
    workflow folder is `.flowai-workflow/<name>/`. Engine remains
    path-agnostic — `loadConfig` accepts any path. Evidence:
    `cli.ts::parseArgs` (positional handling),
    `engine.ts::deriveWorkflowDir`, `config.ts::loadConfig`.
  - [x] Run artifacts live in gitignored `<workflow-dir>/runs/` (per
    FR-E9 update + FR-S47). Evidence: `.gitignore`
    (`.flowai-workflow/*/runs/`), `state.ts::getRunDir(runId, workflowDir)`,
    `engine.ts::Engine.workflowDir`.
  - ~~`[ ] Legacy shell scripts in a scripts/ directory (not .flowai-workflow/scripts/)`~~ — SDLC workflow convention, not engine constraint. Legacy scripts remain at `.flowai-workflow/scripts/` (SDLC scope, outside engine boundary).
  - [x] `deno.json` tasks (`run`, `check`, `test`) updated to reference `cli.ts` and `scripts/`. Evidence: `deno.json:7,19` (`check`, `run` tasks referencing `cli.ts`).
  - [x] SDS (`documents/design-engine.md`) updated to reflect implemented layout. Evidence: `documents/design-engine.md` §3.1 (engine modules), §3.2 (Phase Registry — IMPLEMENTED with evidence).



### 3.9 FR-E9: Run Artifacts Folder Structure

- **Description:** Run artifacts live under
  `<workflow-dir>/runs/<run-id>/` — where `<workflow-dir>` is the
  workflow folder selected by the positional `<workflow>` argument
  (FR-E53; FR-S47 mandates
  `.flowai-workflow/<name>/`). Within a run, node output directories
  are grouped by workflow phase, separating agent output artifacts
  from runtime metadata (logs, state).

  **Layout:** Node output directories grouped into phase subdirectories
  reflecting the DAG execution flow. Runtime metadata (`state.json`,
  `logs/`) at the run root level (not inside phase groups).
- **Motivation:** Current flat layout intermixes planning nodes, implementation
  loop nodes, commit nodes, and infrastructure files (`logs/`, `state.json`)
  at the same level. This hinders navigability and does not reflect the
  workflow execution flow.
- **Acceptance criteria:**
  - **Tests:** `state_test.ts`, `template_test.ts` (FR-E9; regression-locked;
    `getRunDir` workflow-aware, `getNodeDir` phase-aware path
    composition, `{{node_dir}}` / `{{input.<id>}}` resolution).



### 3.14 FR-E14: Engine-Workflow Separation Invariant

- **Description:** The workflow engine (`engine/`) is a domain-agnostic DAG executor. It MUST be physically separated from workflow-specific concerns (config, agents, run artifacts) by directory structure, not only by convention. This constraint is structural and must be enforced by the project layout.

  **Rules:**
  - Engine source lives in a dedicated top-level directory (e.g., `engine/` or a standardized path); no workflow, agent, git, or GitHub-specific logic inside.
  - Workflow config (`workflow.yaml`), agent prompts (`.claude/skills/`), and run artifacts (`runs/`) are domain-specific — must not be nested under the engine directory.
  - `deno.json` tasks and imports reference the new layout consistently.
- **Motivation:** Issue #12 — collocating engine source with workflow data under `.flowai-workflow/` obscures boundaries, hinders tooling, and blocks future engine reuse.
- **Acceptance criteria:**
  - [x] Engine source directory contains only domain-agnostic DAG executor code. Evidence: `git.ts` and `git_test.ts` deleted; `mod.ts` git exports removed; `types.ts` `HitlConfig` fields renamed to domain-neutral names (`artifact_source`, `exclude_login`).
  - [x] Engine source contains zero references to concrete artifact filenames
    (e.g., `failed-node.txt`) or concrete node names (e.g., `meta-agent`).
  - [x] No `workflow.yaml`, agent skill files, or run artifacts reside inside
    the engine directory.
  - [x] `deno task run` and `deno task test:engine` reference the new engine
    path.



### 3.25 FR-E25: Graceful Shutdown (Signal Handling)

- **Description:** Engine kills spawned child processes and releases resources on SIGINT/SIGTERM. Global process registry tracks long-running `Deno.ChildProcess` instances. On signal: SIGTERM all registered processes, wait up to 5s, SIGKILL survivors, run shutdown callbacks (lock release, state save), exit with 130 (SIGINT) or 143 (SIGTERM).
- **Motivation:** Without signal propagation, Ctrl+C leaves orphaned `claude` processes consuming resources and stale lock files blocking subsequent runs. Critical in Docker environments.
- **Acceptance criteria:**
  - **Tests:** `process-registry_test.ts` (regression-locked; registry
    operations, `killAll`, shutdown callbacks, disposer leak fix,
    error resilience).
  - [x] `agent.ts:executeClaudeProcess()` registers/unregisters process
    in try/finally. Evidence: `agent.ts:430-574`.
  - [x] `cli.ts` calls `installSignalHandlers()` at startup. Evidence:
    `cli.ts:139`.
  - [x] `engine.ts` registers shutdown callbacks for lock release and
    state save after lock acquisition; disposes in finally. Evidence:
    `engine.ts:139-153`.
  - [x] `self-runner.ts` calls `Engine.run()` directly (no subprocess),
    `installSignalHandlers()` at startup. Evidence:
    `scripts/self-runner.ts:5-7,57-64,135`.



### 3.33 FR-E33: Phase Assignment Single-Mechanism Enforcement

- **Description:** A workflow config MUST use exactly one mechanism to assign
  nodes to phases: either a top-level `phases:` block (maps phase names → node
  ID lists) or per-node `phase:` fields on individual node definitions. Both
  mechanisms simultaneously is forbidden. `phases:` block is canonical
  (preferred). Engine rejects at parse time any config containing a `phases:`
  block and at least one node with a `phase:` field.
- **Motivation:** Two mechanisms encoding the same information cause silent
  inconsistency when they diverge. Prior behavior silently preferred `phases:`
  as "authoritative" over `phase:` as "fallback" — a misconfigured workflow
  misbehaved without diagnostic feedback. Parse-time rejection enforces the
  fail-fast principle and eliminates the dual-mechanism merge path from
  `setPhaseRegistry()`.
- **Acceptance criteria:**
  - **Tests:** `config_test.ts` (FR-E33; regression-locked; rejection,
    `phases:`-only accepted, per-node `phase:`-only accepted, neither
    accepted, diagnostic message format).



### 3.34 FR-E34: Error Handling Precedence (`on_error` vs `on_failure_script`)

- **Description:** Two error-handling mechanisms coexist in workflow config.
  `settings.on_error: continue` (per-node) marks a node `failed` and continues
  workflow without triggering `on_failure_script` at node level.
  `defaults.on_failure_script` (workflow-end hook) runs once, only when
  `workflowSuccess === false` after all DAG levels complete. Their interaction
  is deterministic and governed by 4 rules.

  **Interaction rules:**
  1. `on_error: continue` → emits info log, continues workflow. Hook not triggered.
  2. All failures suppressed → `workflowSuccess === true` → hook does NOT run.
  3. Any unsuppressed failure → `workflowSuccess === false` → hook runs once.
  4. Hook failure does not affect `on_error: continue` semantics (FR-E19 applies).
- **Motivation:** Without formal definition, workflow authors cannot predict
  whether the failure hook fires when a node is `continue`-d. Deterministic
  rules prevent silent unexpected hook invocations.
- **Acceptance criteria:**
  - **Tests:** `engine_test.ts` (FR-E34; regression-locked; 5 cases
    cover the 4 interaction rules + log-message format).


