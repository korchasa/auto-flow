<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Config and Validation


### 3.4 FR-E4: Configuration

- **Description:** Workflow configuration via environment variables and `workflow.yaml`. Env vars override YAML defaults.
- **Variables:**
  - `SDLC_MAX_CONTINUATIONS` — maximum continuations per stage (default: `3`).
  - `SDLC_MAX_QA_ITERATIONS` — maximum Developer+QA loop iterations (default: `3`).
  - `SDLC_STAGE_TIMEOUT_MINUTES` — default timeout per stage in minutes (default: `30`).
- **Acceptance criteria:**
  - All variables have sensible defaults in `lib.sh` (legacy) and engine config (`engine/config.ts`).
  - Engine and stage scripts read configuration from environment, falling back to defaults.



### 3.7 FR-E7: Workflow Config Drift Detection

- **Description:** Automated verification that workflow YAML configs (`workflow.yaml`, `workflow-task.yaml`) remain consistent with engine expectations and SRS requirements. Detects mismatches in node declarations, required fields, hook syntax, and validation rules.
- **Acceptance criteria:**
  - ~~`[ ] A deno task check:workflow standalone command`~~ — SDLC workflow convenience, not engine constraint. Implemented as `workflowIntegrity()` in `scripts/check.ts` (SDLC scope). See FR-S24 in `documents/requirements-sdlc.md`.
  - [x] Engine validates all node types on `loadConfig()`: must be one of `agent`, `loop`, `merge`, `human`. Evidence: `engine/config.ts:43` (`validateSchema()`), `engine/config.ts:71` (type check per node)
  - [x] Config validation verifies all `{{...}}` patterns in `before`/`after` hook commands resolve to known variables (`input.<nodeId>`, `env.*`, `args.*`, `run_dir`, `run_id`, `node_dir`). Evidence: `engine/config.ts:324-344` (`validateTemplateVars()` called for both hooks inside `validateNode()`), `engine/template.ts:121` (`validateTemplateVars()` definition)
  - [x] Unresolvable template variables cause validation error at config load time (fail-fast, not runtime). Evidence: `engine/config.ts:326-333`, `engine/config.ts:336-343` (throws synchronously on `errors.length > 0`); tests at `engine/config_test.ts:1240-1345` (`assertThrows` for invalid hook vars)
  - [x] Validation error message identifies hook type (`before`/`after`), node ID, and unresolved variable name. Evidence: `engine/config.ts:329` (`Node '${id}' before hook has invalid template variables: ...`), `engine/config.ts:339` (`after hook`); tests at `engine/config_test.ts:1241-1301`
  - [x] Validation runs as part of `deno task check` via `workflowIntegrity()` → `loadConfig()` → `parseConfig()` → `validateNode()`. Evidence: 569 tests pass including 8 new hook validation tests in `engine/config_test.ts:1240-1345`
  - [x] Engine validates loop nodes reference valid body nodes and `condition_node` within `nodes` sub-object. Evidence: `engine/config.ts:105-249` (`validateNode()` loop section)
  - [x] Config validation runs as part of `deno task check` via `workflowIntegrity()` → `loadConfig()`. Evidence: `scripts/check.ts:84-96` (`workflowIntegrity()`), `engine/config.ts:32,43` (`validateSchema()` called on every `parseConfig()`)
  - [x] Validation failures throw descriptive errors with node ID and field context. Evidence: `engine/config.ts:71-103` (error messages include node ID and field name)



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
  - [x] `--dry-run` output excludes `run_on`-configured nodes from regular level display. Evidence: `engine/engine.ts:78-80` (dry-run filters out `postWorkflowNodeIds` from levels before display)
  - [x] `--dry-run` output includes a "Post-workflow" section listing `run_on` nodes in topological order. Evidence: `engine/engine.ts:73-91` (`collectPostWorkflowNodes` + `sortPostWorkflowNodes` + `dryRunPlan` call), `engine/output.ts:190-197` (`dryRunPlan` renders "Post-workflow" section)
  - [x] Dry-run applies the same `collectRunOnNodes()` filtering logic as normal execution. Evidence: `engine/engine.ts:73-91` (same `collectPostWorkflowNodes()` + `sortPostWorkflowNodes()` calls in both dry-run and normal paths)
  - [x] `OutputManager.dryRunPlan()` accepts and displays post-workflow nodes separately. Evidence: `engine/output.ts:173-199` (`dryRunPlan` signature with `postWorkflowNodeIds?: string[]` + `runOnMap?`, renders "Post-workflow" section)
  - [x] Engine unit tests cover dry-run output with `run_on` nodes present. Evidence: `engine/engine_test.ts:678` ("dry-run — post-workflow nodes excluded from regular levels filtering logic")
  - [x] `deno task check` passes. Evidence: 490 passed, 0 failed



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
  - [x] Config load throws an error if any non-template `prompt` path does not exist.
    Evidence: `engine/config.ts:336` (`validatePromptPaths()`).
  - [x] Error message lists all missing paths (batch, not fail-on-first).
    Evidence: `engine/config.ts:365-367` (accumulates into `missing[]`, throws once).
  - [x] Paths containing `{{` are skipped (unresolvable at load time).
    Evidence: `engine/config.ts:340` (`!node.prompt.includes("{{")`).
  - [x] Validation covers loop body node `prompt` paths (recursion into `nodes`).
    Evidence: `engine/config.ts:350-362` (nested loop over `node.nodes`).
  - [x] `validatePromptPaths()` called at end of `mergeDefaults()` on fully-resolved config.
    Evidence: `engine/config.ts:327` (call in `mergeDefaults()` before return).
  - [x] Tests: missing file, existing file, template skip, multiple missing, loop body miss.
    Evidence: `engine/config_test.ts:568-659`.
  - [x] `deno task check` passes.



### 3.30 FR-E30: Workflow Prepare Command (`prepare_command`)

- **Description:** `WorkflowDefaults` supports optional `prepare_command` (string). Executed as a shell command once, after config validation and run directory creation, before any node starts. Skipped on `--resume`. Failure (non-zero exit) is fatal: workflow aborts immediately. Supports template interpolation: `{{run_dir}}`, `{{run_id}}`, `{{env.*}}`, `{{args.*}}`. Completes the hook lifecycle: worktree creation → config load → `prepare_command` (pre-node) → node execution → `on_failure_script` (post-failure).
- **Motivation:** Workflow-level environment preparation (e.g., repo reset to clean state) belongs before node execution, not inside a node's `before` hook. Node hooks are unreliable for env prep: with `--skip`, `--only`, or `--resume`, the first node may be bypassed, leaving the environment unprepared.
- **Acceptance criteria:**
  - [x] `WorkflowDefaults.prepare_command` is an optional string field;
    validated at config load.
  - [x] Executed once after config validation and run-dir creation, before
    first node starts.
  - [x] Skipped when `--resume` flag is active.
  - [x] Non-zero exit aborts workflow immediately with clear error message.
  - [x] Template variables `{{run_dir}}`, `{{run_id}}`, `{{env.*}}`,
    `{{args.*}}` interpolated before execution.
  - [x] Logged at normal verbosity level.
  - [x] Unit tests cover: skip on resume, failure abort, template
    interpolation.



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
  - [x] Optional `allowed_paths?: string[]` field added to `NodeConfig`; scope check
    skipped entirely when field is absent. Evidence: `engine/types.ts:124`,
    `engine/agent.ts:157`.
  - [x] Pre-invocation snapshot via `snapshotModifiedFiles()` called before first
    invocation; stores set of already-modified files as baseline. Evidence:
    `engine/scope-check.ts:19-41`, `engine/agent.ts:155-158`.
  - [x] Post-invocation comparison via `findViolations()` pure function; called after
    each invocation to detect new out-of-scope modifications. Evidence:
    `engine/scope-check.ts:55-68`, `engine/agent.ts:194-211`.
  - [x] Out-of-scope detection injects synthetic `ValidationResult` (type `scope_check`,
    failed, message listing violation paths) into validation results; continuation
    triggered by FR-E1 mechanism. Evidence: `engine/agent.ts:200-208`.
  - [x] Pre-existing uncommitted modifications excluded from violation detection
    (baseline subtracted before comparing). Evidence: `engine/scope-check.ts:62`
    (`if (before.has(path)) continue`), `engine/scope-check_test.ts:20-25`.
  - [x] Sub-second latency — `git diff --name-only HEAD` and
    `git ls-files --others --exclude-standard` run in parallel via `Promise.all`.
    Evidence: `engine/scope-check.ts:30-33`.
  - [x] Continuation limit exhaustion applies to scope violations same as artifact
    validation failures (shared continuation budget). Evidence: `engine/agent.ts:225-236`.
  - [x] Unit tests: `findViolations()` pure function (no violations, violations detected,
    glob matching, empty sets); `snapshotModifiedFiles()` with git fixture; `agent.ts`
    integration (snapshot injection, shared continuation budget). Evidence:
    `engine/scope-check_test.ts`, `engine/agent_test.ts`; 549 tests pass, 0 failed.
  - [x] `deno task check` green: 549 tests, 0 failures. Evidence: run `20260320T094502`.



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
  - [x] AC1: Optional `fields?: string[]` on `artifact` rule; skipped when absent/empty.
    Evidence: `engine/types.ts:164`.
  - [x] AC2: Fail-fast order: absent file → empty file → missing sections →
    missing/empty fields. Evidence: `engine/validate.ts:261-337`.
  - [x] AC3: Missing/empty fields aggregated into one validation error.
    Evidence: `engine/validate.ts:314-332`.
  - [x] AC4: Config-load rejects `artifact` rule with non-string or empty-string entries
    in `fields`. Evidence: `engine/config.ts:452-460`.
  - [x] AC5: `frontmatter_field` rule unchanged (covers value constraints; `artifact`
    covers presence only). Evidence: `engine/validate.ts:187-251`.
  - [x] AC6: Unit tests: no-fields (skip), all present, one missing, one empty-valued,
    bad entry rejected. Evidence: `engine/validate_test.ts:469,485,508,533`,
    `engine/config_test.ts:1137,1148`; 576 tests pass, 0 failed.
  - [x] `deno task check` green: 576 tests, 0 failures. Evidence: run `20260320T213059`.


