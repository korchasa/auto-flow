<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Config and Validation


### 3.4 FR-E4: Configuration

- **Description:** Workflow configuration via environment variables and `workflow.yaml`. Env vars override YAML defaults.

  **Variables:**
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

  **Inside a fork branch the scope is derived, not optional.** A node that
  belongs to a branch of a group (FR-E95) and declares no `allowed_paths` gets
  the empty scope `[]` — it may write nothing — instead of "no check". A branch
  exists to keep its writes apart from its siblings', so silence there means
  the author forgot to say what the branch owns, and an unchecked branch is the
  one case where the check matters most. Outside a branch the field stays
  optional and absent still means unchecked.

  **The check forgives what the node did not write.** The snapshots are
  repository-wide, so they also catch the engine's own writes into the run
  directory (stream log, answers, state) and, while more than one node runs in
  one tree, a sibling's writes. Neither is the node's edit and neither can be
  told apart from one, so the check compares against the node's
  `allowed_paths` plus the run directory plus the scopes of every other node
  that has been inside the current bracket — the same answer the FR-E50
  guardrail gives to the same problem. A write outside all of them still fails
  every node in the bracket.

  **Sibling scopes must not overlap.** When two branches of one group both
  declare `allowed_paths`, config load rejects the pair unless the two glob
  sets are provably disjoint. The comparison is conservative — a pattern it
  cannot prove disjoint counts as overlapping — because a false rejection costs
  the author one edit and a false acceptance costs a silent clobber.
- **Tasks:** [explicit-fork-join](../tasks/2026-08-30-explicit-fork-join.md)
- **Motivation:** Without scope enforcement, agents can silently modify out-of-scope files
  during continuation loops — undetected until QA stage, wasting continuation budget.
  `allowed_paths` provides a lightweight, optional per-node safeguard without violating
  the domain-agnostic invariant.
- **Acceptance criteria:**
  - **Tests:** `scope-check_test.ts`, `agent_test.ts`, `guardrail_test.ts`,
    `branch-scope_test.ts`
    (FR-E37; regression-locked; `findViolations` pure function,
    `snapshotModifiedFiles` baseline, agent integration, shared
    continuation budget, the empty scope derived inside a branch,
    overlap rejection between sibling branch scopes, and two shared-tree nodes
    running together that are not failed for each other's in-scope writes).



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



### 3.67 FR-E67: Git Repository State Validation Rules

- **Description:** Workflow validation supports parameterless Git repository
  state rules:
  - `git_worktree_clean`: fails when the worktree has any tracked changes or
    untracked non-ignored files relative to `HEAD`.
  - `git_default_branch_checked_out`: fails when the current branch is not
    the repository default branch recorded in `refs/remotes/origin/HEAD`.
  - `git_no_unpushed_commits`: fails when the current branch is ahead of its
    upstream.
- **Motivation:** Workflows need concise post-stage repository gates without
  embedding shell snippets in YAML. `.gitignore` remains the source of truth
  for ignored files; validation does not add a second ignore mechanism.
- **Acceptance criteria:**
  - **Tests:** `validate_test.ts`, `config_test.ts` (FR-E67;
    regression-locked; config accepts all three parameterless rules; runtime
    checks clean/dirty worktree, ignored files, default/non-default branch,
    and pushed/unpushed branch states).



### 3.101 FR-E101: Config Migration Layer (`migrateWorkflow`)

- **Description:** The engine normalizes parsed workflow configs through a
  versioned migration chain BEFORE validation. `workflow.yaml` MAY declare
  `schemaVersion: <int>`; an absent field means "oldest known version", so
  unversioned legacy configs migrate too. On every `loadConfig`,
  `migrateWorkflow(parsed)` applies the ordered registry of migration steps
  `v<N> → v<N+1>` until the config reaches the engine's current schema
  version, then stamps the resolved `schemaVersion` onto the parsed config.
  Each applied step is logged to run output (`config: migrated schema
  v<N> → v<N+1>`), making schema evolution explicit and auditable. A config
  stamped with a version NEWER than the engine supports fails fast at load
  with a clear error — silent forward-incompatibility is forbidden. Because
  migration runs before validation, old shapes are normalized into the
  current schema and never surface as opaque errors deep in execution.

  **Stored run state is out of this chain.** The originating issue's
  resume-path clause predates the journal architecture: no `state.json`
  exists (FR-E69). Journal records already carry per-record `schema_version`
  under the FR-E69 replay contract, so stored run state needs no config
  migration chain; journal schema evolution belongs to the replay contract,
  not to `migrateWorkflow`.
- **Motivation:** The FR-E52 incident proved schema drift silently breaks old
  `workflow.yaml` files and run-resume assumptions — mismatches surface as
  opaque errors deep in execution. Schema evolution must be explicit,
  versioned, and logged.
- **Dep:** FR-E4, FR-E7, FR-E69.
- **Acceptance criteria:**
  - **Tests:** `config_test.ts` (FR-E101; regression-locked; no-op at
    current version, single bump, multi-step chain, absent
    `schemaVersion` default, newer-version fail-fast).
  - [ ] Applied migrations visible in run output at default verbosity.
