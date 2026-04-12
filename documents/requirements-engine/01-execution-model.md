<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Execution Model


### 3.1 FR-E1: Continuation Mechanism

- **Description:** Each stage script wraps the selected agent runtime invocation and validates the agent's output before considering the stage complete. If validation fails, the script re-invokes the agent in the same session using the runtime's session-resume mechanism (`claude --resume`, `opencode run --session`) with a description of the problem, giving the agent a chance to fix its output without starting from scratch.
- **Acceptance criteria:**
  - **Stage script responsibilities (engine path — `engine/`):**
    1. [x] Invoke the selected runtime CLI with the stage prompt and input artifacts. Evidence: `engine/runtime/index.ts`, `engine/runtime/claude-adapter.ts`, `engine/runtime/opencode-adapter.ts`
    2. After the agent exits, run stage-specific validation checks:
       - [x] **For Developer stage:** run `deno task check` via `custom_script` validation rule. If it fails, continuation is triggered. Evidence: `engine/validate.ts:49-50,127-162` (`checkCustomScript()`), `.flowai-workflow/workflow.yaml` (developer node `custom_script` config)
       - [x] **For QA stage:** (1) verify `05-qa-report-N.md` exists and is non-empty, (2) extract verdict via frontmatter parsing, (3) if verdict is not exactly `PASS` or `FAIL` — treat as validation failure, trigger continuation on QA agent. Evidence: `engine/validate.ts:51-52,164-228` (`checkFrontmatterField()`), `engine/validate_test.ts:225-351` (6 tests)
       - [x] **For all stages:** verify the expected output artifact exists and is non-empty. Evidence: `engine/validate.ts:60-88` (`file_exists`, `file_not_empty` rules), `.flowai-workflow/workflow.yaml` (per-node `validate` config)
    3. [x] If validation fails: re-invoke the runtime in the same session (`claude --resume <session-id>` or `opencode run --session <session-id>`) with the validation error output appended as context. Evidence: `engine/agent.ts`, `engine/opencode-process.ts`
    4. [x] Repeat until validation passes or the continuation limit is reached. Evidence: `engine/agent.ts:75-91` (loop with `continuations < settings.max_continuations`)
  - **Continuation limits:**
    - [x] Maximum continuations per stage: configurable (default 3). Evidence: `.flowai-workflow/workflow.yaml:9` (`max_continuations: 3`), `engine/agent.ts:82-91`
    - [x] If limit reached: stage is marked as failed, workflow stops, Meta-Agent is triggered (FR-S9, FR-E11). Evidence: `engine/engine.ts:96-109,613-619` (`collectRunOnNodes()`), `engine/types.ts:56-57` (`run_on` field), `engine/agent.ts:110-120` (continuation limit check)
  - **Session persistence:**
    - [x] Runtime session resume ensures the agent retains full conversation context from the initial invocation. Evidence: `engine/claude-process.ts`, `engine/opencode-process.ts`
    - [x] Each continuation adds only the validation error to the context, not the full prompt. Evidence: `engine/agent.ts:94-97` (resume prompt = failures only)
  - **Secret detection (moved to `deno task check`):**
    - [x] `gitleaks detect --no-git` runs as part of `scripts/check.ts` (after lint, before tests). `allowFailure=true` — skips if gitleaks binary not found. Evidence: `scripts/check.ts:87`
    - Scope check (`allowed_paths`) and engine-level `safetyCheckDiff()` removed. Rationale: engine no longer commits per-node; scope enforcement via agent prompts and QA validation.
    - [x] Scope-based file modification detection implemented via FR-E37 (`allowed_paths` per-node config, pre/post snapshot using `git diff`, violations as continuation-triggering validation failures). Evidence: `engine/scope-check.ts`, `engine/agent.ts:155-211`.
  - **Stage script responsibilities (legacy path — `.flowai-workflow/scripts/`):**
    - [x] Legacy shell implementation in `lib.sh`: `continuation_loop()`, `safety_check_diff()`, `run_agent()`, `retry_with_backoff()`. Evidence: `.flowai-workflow/scripts/lib.sh:59-233`
- **Quality metrics:**
  - Continuation success rate: percentage of continuations that resolve the issue (target > 70%).
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
  - [x] Workflow config path configurable via `--config <path>` flag (default: `.flowai-workflow/workflow.yaml`). Engine is config-path-agnostic — no hardcoded root assumption. Evidence: `engine/cli.ts:7,37` (`--config` flag definition and handling), `engine/config.ts:37` (`loadConfig(path)` accepts any path)
  - [x] Run artifacts in gitignored `.flowai-workflow/runs/` directory; `.gitignore` updated. Evidence: `.gitignore:3` (`.flowai-workflow/runs/` entry)
  - ~~`[ ] Legacy shell scripts in a scripts/ directory (not .flowai-workflow/scripts/)`~~ — SDLC workflow convention, not engine constraint. Legacy scripts remain at `.flowai-workflow/scripts/` (SDLC scope, outside engine boundary).
  - [x] `deno.json` tasks (`run`, `check`, `test`) updated to reference `engine/cli.ts` and `scripts/`. Evidence: `deno.json:7,19` (`check`, `run` tasks referencing `engine/cli.ts`)
  - [x] All existing engine tests pass after restructuring. Evidence: `deno task check` passes.
  - [x] SDS (`documents/design-engine.md`) updated to reflect implemented layout. Evidence: `documents/design-engine.md` §3.1 (engine modules), §3.2 (Phase Registry — IMPLEMENTED with evidence)



### 3.9 FR-E9: Run Artifacts Folder Structure

- **Description:** Run artifacts under `.flowai-workflow/runs/<run-id>/` must follow a
  hierarchical layout that groups node output directories by workflow phase,
  separating agent output artifacts from runtime metadata (logs, state).
- **Motivation:** Current flat layout intermixes planning nodes, implementation
  loop nodes, commit nodes, and infrastructure files (`logs/`, `state.json`)
  at the same level. This hinders navigability and does not reflect the
  workflow execution flow.
- **Layout:** Node output directories grouped into phase subdirectories
  reflecting the DAG execution flow. Runtime metadata (`state.json`, `logs/`)
  at the run root level (not inside phase groups).
- **Acceptance criteria:**
  - [x] Node output directories are grouped by workflow phase under
    `.flowai-workflow/runs/<run-id>/` (e.g., `plan/`, `impl/`, `report/`). Phase derived
    from exactly one mechanism per FR-E33 (canonical: top-level `phases:` block;
    alternate: per-node `phase:` field). Evidence: `engine/state.ts:28-45`
    (`setPhaseRegistry()` — builds nodeId→phase map via exclusive if/else),
    `engine/state.ts:98-104` (`getNodeDir()` — phase-aware path resolution),
    `engine/engine.ts:135` (`setPhaseRegistry(config)` at engine init)
  - [x] `state.json` and `logs/` remain at the run root level
    (`.flowai-workflow/runs/<run-id>/state.json`, `.flowai-workflow/runs/<run-id>/logs/`). Phase
    registry applies only to node artifact dirs; `getRunDir()` is
    phase-independent. Evidence: `engine/state.ts:44-46` (`getPhaseForNode()`
    — used only in `getNodeDir()`, not in state/log path resolution)
  - [x] `{{node_dir}}` and `{{input.<node-id>}}` template variables resolve
    correctly to phase-aware hierarchical paths. Evidence:
    `engine/state.ts:98-104` (`getNodeDir()` returns
    `${runDir}/${phase}/${nodeId}` when phase registered, `${runDir}/${nodeId}`
    otherwise — backward-compatible)
  - [x] Engine's state manager, log saver, and artifact validator work with
    the new directory structure.
  - [x] Existing workflow.yaml node definitions require minimal changes (phase
    grouping derived from config or convention, not hardcoded per-node paths).
  - [x] All existing engine tests pass after restructuring.



### 3.14 FR-E14: Engine-Workflow Separation Invariant

- **Description:** The workflow engine (`engine/`) is a domain-agnostic DAG executor. It MUST be physically separated from workflow-specific concerns (config, agents, run artifacts) by directory structure, not only by convention. This constraint is structural and must be enforced by the project layout.
- **Rationale:** Issue #12 — collocating engine source with workflow data under `.flowai-workflow/` obscures boundaries, hinders tooling, and blocks future engine reuse.
- **Rules:**
  - Engine source lives in a dedicated top-level directory (e.g., `engine/` or a standardized path); no workflow, agent, git, or GitHub-specific logic inside.
  - Workflow config (`workflow.yaml`), agent prompts (`.claude/skills/`), and run artifacts (`runs/`) are domain-specific — must not be nested under the engine directory.
  - `deno.json` tasks and imports reference the new layout consistently.
- **Acceptance criteria:**
  - [x] Engine source directory contains only domain-agnostic DAG executor code. Evidence: `engine/git.ts` and `engine/git_test.ts` deleted; `engine/mod.ts` git exports removed; `engine/types.ts` `HitlConfig` fields renamed to domain-neutral names (`artifact_source`, `exclude_login`).
  - [x] Engine source contains zero references to concrete artifact filenames
    (e.g., `failed-node.txt`) or concrete node names (e.g., `meta-agent`).
  - [x] No `workflow.yaml`, agent skill files, or run artifacts reside inside
    the engine directory.
  - [x] `deno task run` and `deno task test:engine` reference the new engine
    path.
  - [x] `deno task check` passes after restructure.



### 3.25 FR-E25: Graceful Shutdown (Signal Handling)

- **Description:** Engine kills spawned child processes and releases resources on SIGINT/SIGTERM. Global process registry tracks long-running `Deno.ChildProcess` instances. On signal: SIGTERM all registered processes, wait up to 5s, SIGKILL survivors, run shutdown callbacks (lock release, state save), exit with 130 (SIGINT) or 143 (SIGTERM).
- **Motivation:** Without signal propagation, Ctrl+C leaves orphaned `claude` processes consuming resources and stale lock files blocking subsequent runs. Critical in Docker environments.
- **Acceptance criteria:**
  - [x] `process-registry.ts` singleton: `register()`, `unregister()`, `onShutdown()`, `killAll()`, `installSignalHandlers()`. Evidence: `engine/process-registry.ts:17-112`
  - [x] `onShutdown()` returns disposer function to prevent callback leak in loops. Evidence: `engine/process-registry.ts:28-34`
  - [x] `agent.ts:executeClaudeProcess()` registers/unregisters process in try/finally. Evidence: `engine/agent.ts:430-574`
  - [x] `cli.ts` calls `installSignalHandlers()` at startup. Evidence: `engine/cli.ts:139`
  - [x] `engine.ts` registers shutdown callbacks for lock release and state save after lock acquisition; disposes in finally. Evidence: `engine/engine.ts:139-153`
  - [x] `self-runner.ts` calls `Engine.run()` directly (no subprocess), `installSignalHandlers()` at startup. Evidence: `scripts/self-runner.ts:5-7,57-64,135`
  - [x] `loop-in-claude.ts` registers/unregisters claude child, `installSignalHandlers()` at startup. Evidence: `scripts/loop-in-claude.ts:7-11,80,100,106,152`
  - [x] 9 unit tests cover registry operations, killAll, shutdown callbacks, error resilience. Evidence: `engine/process-registry_test.ts`
  - [x] All 474 existing tests pass. Evidence: `deno task check` output



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
  - [x] Config containing both `phases:` block and any node-level `phase:`
    field is rejected at parse time with a diagnostic error. Evidence:
    `engine/config.ts:133-149`
  - [x] Config with `phases:` block only is accepted. Evidence:
    `engine/config_test.ts:694-708`
  - [x] Config with per-node `phase:` fields only is accepted. Evidence:
    `engine/config_test.ts:710-726`
  - [x] Config with neither mechanism is accepted. Evidence:
    `engine/config_test.ts:728-732`
  - [x] Diagnostic error names both mechanisms and lists at least one affected
    node ID. Evidence: `engine/config.ts:137-148`
  - [x] Unit tests cover all 4 scenarios. Evidence: `engine/config_test.ts:669-732`



### 3.34 FR-E34: Error Handling Precedence (`on_error` vs `on_failure_script`)

- **Description:** Two error-handling mechanisms coexist in workflow config.
  `settings.on_error: continue` (per-node) marks a node `failed` and continues
  workflow without triggering `on_failure_script` at node level.
  `defaults.on_failure_script` (workflow-end hook) runs once, only when
  `workflowSuccess === false` after all DAG levels complete. Their interaction
  is deterministic and governed by 4 rules.
- **Rationale:** Without formal definition, workflow authors cannot predict
  whether the failure hook fires when a node is `continue`-d. Deterministic
  rules prevent silent unexpected hook invocations.
- **Interaction rules:**
  1. `on_error: continue` → emits info log, continues workflow. Hook not triggered.
  2. All failures suppressed → `workflowSuccess === true` → hook does NOT run.
  3. Any unsuppressed failure → `workflowSuccess === false` → hook runs once.
  4. Hook failure does not affect `on_error: continue` semantics (FR-E19 applies).
- **Acceptance criteria:**
  - [x] `on_error: continue` branch emits info log:
    `node <id>: failure suppressed by on_error: continue`. Evidence:
    `engine/engine.ts:384-390` (status call in if-block before `return true`),
    `engine/engine_test.ts` (FR-E34 test 5: log message format).
  - [x] `on_error: continue` does NOT trigger `on_failure_script` at node level.
    Evidence: `engine/engine_test.ts` (FR-E34 test 1: hook not called when
    `workflowSuccess=true`).
  - [x] All failures suppressed → `workflowSuccess === true` → hook NOT run.
    Evidence: `engine/engine_test.ts` (FR-E34 test 2: all continue-d,
    `workflowSuccess` derivation via loop pattern).
  - [x] Any unsuppressed failure → `workflowSuccess === false` → hook runs once
    via `runFailureHook()`. Evidence: `engine/engine_test.ts` (FR-E34 test 3:
    one fatal failure, hook called exactly once).
  - [x] Hook failure does not affect `on_error: continue` semantics (no
    re-trigger, WARN emitted). Evidence: `engine/engine_test.ts` (FR-E34 test 4:
    hook script fails, WARN emitted, no second invocation).


