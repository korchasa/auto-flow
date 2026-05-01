<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Config and Validation


### 3.4 FR-E4: Configuration

- **Description:** Workflow configuration via environment variables and `workflow.yaml`. Env vars override YAML defaults.
- **Variables:**
  - `SDLC_MAX_CONTINUATIONS` — maximum continuations per stage (default: `3`).
  - `SDLC_MAX_QA_ITERATIONS` — maximum Developer+QA loop iterations (default: `3`).
  - `SDLC_STAGE_TIMEOUT_MINUTES` — default timeout per stage in minutes (default: `30`).
- **Acceptance criteria:**
  - All variables have sensible defaults in `lib.sh` (legacy) and engine config (`config.ts`).
  - Engine and stage scripts read configuration from environment, falling back to defaults.



### 3.7 FR-E7: Workflow Config Drift Detection

- **Description:** Automated verification that workflow YAML configs (`workflow.yaml`, `workflow-task.yaml`) remain consistent with engine expectations and SRS requirements. Detects mismatches in node declarations, required fields, hook syntax, and validation rules.
- **Acceptance criteria:**
  - **Tests:** `config_test.ts`, `template_test.ts` (FR-E7;
    regression-locked; node-type validation, hook template-var
    resolution, error message format, loop body/condition_node
    refs).
  - ~~`[ ] A deno task check:workflow standalone command`~~ — SDLC
    workflow convenience, not engine constraint. Implemented as
    `workflowIntegrity()` in `scripts/check.ts` (SDLC scope). See
    FR-S24 in `documents/requirements-sdlc.md`.



### 3.13 FR-E13: Accurate Dry-Run Output

- **Description:** `--dry-run` flag displays execution plan that mirrors actual
  engine execution order: regular levels (without `run_on` post-workflow nodes)
  shown first, followed by a separate "Post-workflow" section listing `run_on`
  nodes in topological order. Eliminates misleading display of post-workflow
  nodes intermixed with regular levels.
- **Motivation:** Current dry-run path uses raw `buildLevels()` output, bypassing
  the `run_on` collection and filtering applied in normal execution. This causes
  operators to misread the execution order (e.g., `meta-agent` appears to run in
  parallel with `pm`, `commit` appears as a regular level node).
- **Acceptance criteria:**
  - **Tests:** `engine_test.ts`, `output_test.ts` (regression-locked;
    dry-run filters `run_on` nodes out of regular levels and emits a
    Post-workflow section).



### 3.16 FR-E16: Prompt Path Validation at Config Load

- **Description:** Workflow engine validates that all `prompt` file paths declared
  in `workflow.yaml` exist on the filesystem before any node executes. Validation
  runs once at config load time, accumulates all missing paths, and throws a single
  error listing every missing file. Paths containing `{{` (template variables) are
  skipped — they cannot be resolved at load time.
- **Motivation:** Misconfigured `prompt` paths cause silent agent failures 30+ min
  into a workflow run (incident: run `20260313T025203`). Early batch validation
  surfaces all misconfigurations in one error before any API compute is spent.
- **Acceptance criteria:**
  - **Tests:** `config_test.ts` (regression-locked;
    `validatePromptPaths` covers missing/existing/template-skip/
    multi-missing/loop-body-miss paths).



### 3.30 FR-E30: Workflow Prepare Command (`prepare_command`)

- **Description:** `WorkflowDefaults` supports optional `prepare_command` (string). Executed as a shell command once, after config validation and run directory creation, before any node starts. Skipped on `--resume`. Failure (non-zero exit) is fatal: workflow aborts immediately. Supports template interpolation: `{{run_dir}}`, `{{run_id}}`, `{{env.*}}`, `{{args.*}}`. Completes the hook lifecycle: worktree creation → config load → `prepare_command` (pre-node) → node execution → `on_failure_script` (post-failure).
- **Motivation:** Workflow-level environment preparation (e.g., repo reset to clean state) belongs before node execution, not inside a node's `before` hook. Node hooks are unreliable for env prep: with `--skip`, `--only`, or `--resume`, the first node may be bypassed, leaving the environment unprepared.
- **Acceptance criteria:**
  - **Tests:** `engine_test.ts` (FR-E30; regression-locked;
    skip-on-resume, failure-abort, template interpolation, logging).



### 3.37 FR-E37: Scope-Based File Modification Detection

- **Description:** The engine supports optional per-node `allowed_paths` configuration.
  When present, the engine snapshots the working-tree modified file set before each agent
  invocation and compares it after. Any new modifications outside `allowed_paths` are
  treated as a validation failure, triggering continuation via the existing FR-E1
  mechanism.
- **Motivation:** Without scope enforcement, agents can silently modify out-of-scope files
  during continuation loops — undetected until QA stage, wasting continuation budget.
  `allowed_paths` provides a lightweight, optional per-node safeguard without violating
  the domain-agnostic invariant.
- **Acceptance criteria:**
  - **Tests:** `scope-check_test.ts`, `agent_test.ts`, `guardrail_test.ts`
    (FR-E37; regression-locked; `findViolations` pure function,
    `snapshotModifiedFiles` baseline, agent integration, shared
    continuation budget).



### 3.38 FR-E38: Artifact Rule Frontmatter Field Presence Checks

- **Description:** The `artifact` validation rule accepts an optional `fields?: string[]`
  property listing required frontmatter field names. When present, the engine checks each
  named field exists in the artifact's YAML frontmatter and has a non-empty value.
  Missing or empty fields are aggregated into a single validation error. Skipped entirely
  when `fields` is absent or empty — fully backward compatible.
- **Motivation:** Without this feature, workflow authors must declare one `frontmatter_field`
  rule per required field, duplicating the artifact path and splitting one artifact contract
  across multiple rule declarations. `fields` on `artifact` consolidates presence checks
  alongside section checks in a single rule, reducing verbosity and error surface.
- **Acceptance criteria:**
  - **Tests:** `validate_test.ts`, `config_test.ts` (FR-E38;
    regression-locked; `fields` skip-when-absent, fail-fast order,
    aggregation, config-load rejection of bad entries).


