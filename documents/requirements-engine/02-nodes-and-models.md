<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Nodes and Models


### 3.10 FR-E10: Loop Body Node Nesting

- **Description:** Loop nodes in `workflow.yaml` must define their body nodes
  inline as nested objects, not reference top-level node IDs. This makes the
  parent-child relationship explicit, prevents body nodes from being executed
  outside their loop context, and aligns config structure with execution model.

  **Config structure:** Loop node gains a `nodes` sub-object containing inline
  body node definitions. The `body` field references IDs within `nodes`.
  Example:
  ```yaml
  impl-loop:
    type: loop
    body: [developer, qa]
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    max_iterations: 3
    nodes:
      developer:
        type: agent
        prompt: ".flowai-workflow/agents/agent-developer/SKILL.md"
        inputs: [architect, sds-update]
        ...
      qa:
        type: agent
        prompt: ".flowai-workflow/agents/agent-qa/SKILL.md"
        inputs: [pm, architect, developer]
        ...
  ```
- **Motivation:** Current config declares loop body nodes (`developer`, `qa`) at
  the top level alongside workflow-level nodes. Body nodes use loop-scoped
  template variables (`{{loop.iteration}}`) but nothing in their declaration
  indicates loop scope. This creates namespace pollution, implicit coupling,
  and misconfiguration risk.
- **Acceptance criteria:**
  - **Tests:** `dag_test.ts`, `config_test.ts`, `loop_test.ts`,
    `template_test.ts` (regression-locked; loop body parsing, DAG
    exclusion, intra/external input refs, `{{loop.iteration}}`
    scoping).



### 3.11 FR-E11: Conditional Post-Workflow Node Execution (`run_on`)

- **Description:** Replace the binary `run_always: boolean` flag with a
  `run_on: always | success | failure` enum on `NodeConfig`. Engine collects
  post-workflow nodes (those with `run_on` set) and executes them after all DAG
  levels complete, filtering by workflow outcome. This prevents committer nodes
  from creating PRs/merging when the workflow failed, while allowing meta-agent
  to always run.

  **Enum semantics:**
  - `run_on: always` — execute regardless of workflow outcome (current
    `run_always: true` behavior).
  - `run_on: success` — execute only when all regular DAG nodes passed.
  - `run_on: failure` — execute only when workflow failed.
  - Nodes without `run_on` execute in normal DAG order (no change).

  **Backward compatibility:** `run_always: true` in config is normalized to
  `run_on: "always"` during config loading. `run_always: false` (or absent) is
  unchanged (no `run_on` set).
- **Motivation:** `run_always: true` causes committer nodes to run on failure,
  creating PRs with `Closes #N` that merge broken code. Prompt-level guards are
  unreliable (LLM can ignore them). Engine-level gating is required.
- **Acceptance criteria:**
  - **Tests:** `engine_test.ts`, `config_test.ts` (regression-locked;
    `run_on` filter, `run_always` → `run_on: always` normalization,
    `collectPostWorkflowNodes`).
  - [x] `workflow.yaml` migrated from `run_always: true` to appropriate
    `run_on` values. Evidence: `.flowai-workflow/workflow.yaml:174`
    (`optimize: run_on: always`), `.flowai-workflow/workflow.yaml:200`
    (`tech-lead-review: run_on: always`).
  - [x] Engine remains domain-agnostic — no git/PR/GitHub logic in
    engine code. Evidence: `git.ts` deleted; `engine.ts` uses generic
    `on_failure_script` hook; `mod.ts` git re-exports removed.



### 3.12 FR-E12: Per-Node Model Configuration

- **Description:** Add `model` field to `WorkflowDefaults` and `NodeConfig` in
  workflow config. Engine emits `--model <value>` flag when invoking Claude CLI
  for agent nodes. Node-level `model` overrides default; absent = CLI default.
  Enables cost optimization (cheap model for simple stages) and quality
  optimization (strong model for complex stages).

  **Config schema:**
  ```yaml
  defaults:
    model: "claude-sonnet-4-6"  # default for all nodes
  nodes:
    architect:
      model: "claude-opus-4-6"    # override for complex stages
  ```

  **Engine behavior:**
  - On fresh invocation: if `model` resolved (node-level or default), append
    `--model <value>` to Claude CLI args.
  - On `--resume`: do NOT emit `--model`. Session inherits model from original
    invocation.
  - Loop body nodes: inherit loop node's `model` unless overridden in inline
    `nodes` config.
- **Motivation:** All nodes currently use the same model. Simple stages (PM, QA)
  don't need expensive reasoning models. Complex stages (architect, tech-lead,
  meta-agent) benefit from stronger models. Static per-node config is the
  simplest approach.
- **Acceptance criteria:**
  - **Tests:** `agent_test.ts`, `loop_test.ts` (FR-E12; regression-locked;
    `--model` flag emission, resume guard, loop body cascade).
  - [x] `workflow.yaml` updated: default model + per-node overrides
    for complex stages. Evidence: `.flowai-workflow/workflow.yaml:15`
    (default), `.flowai-workflow/workflow.yaml:65,84,147` (overrides).



### 3.35 FR-E35: Loop Input Forwarding Validation

- **Description:** A loop body node MAY reference external (top-level) node
  outputs via the enclosing loop node's `inputs` list, which implicitly
  forwards those outputs to all inner nodes. At parse time the engine MUST
  validate that every external input referenced by a body node is listed in
  the enclosing loop node's own `inputs`. Sibling body node references are
  excluded from this check (intra-body refs are always valid).
- **Motivation:** The forwarding mechanism was undocumented and unvalidated.
  Omitting an external node from the loop's `inputs` produced no error at
  parse time — failure was silent or surfaced as a runtime-level opaque
  message. Parse-time rejection with a clear diagnostic upholds the
  fail-fast principle and gives workflow authors a reliable contract.
- **Acceptance criteria:**
  - **Tests:** `config_test.ts` (FR-E35; regression-locked; missing
    external-input rejection, sibling-body-ref valid path, error
    message format).
  - [x] Forwarding mechanism and validation algorithm documented in
    SDS (`documents/design-engine.md`). Evidence:
    `documents/design-engine.md:109-116` (§3.1 `config.ts`),
    `documents/design-engine.md:569-581` (§5 Logic).



### 3.36 FR-E36: Loop Condition Field Validation

- **Description:** The engine MUST validate that a loop node's `condition_field` is
  consistent with the condition node's `validate` block at two points: (1) parse time —
  if the condition node has a `validate` block, the block MUST contain a `frontmatter_field`
  rule whose `field` matches `condition_field`; (2) runtime — before reading the field
  from the condition node's output, the engine MUST verify the field is present and throw
  a descriptive error if absent.
- **Motivation:** Without parse-time validation, mismatches between `condition_field` and
  the condition node's validate contract are silently ignored until runtime. Without a
  runtime presence check, a missing field causes undefined behavior (spurious loop
  iteration or opaque failure). Both checks enforce the fail-fast principle and give
  workflow authors actionable diagnostics.
- **Acceptance criteria:**
  - **Tests:** `config_test.ts`, `loop_test.ts` (FR-E36;
    regression-locked; parse-time rule check, runtime field
    presence, error messages).



### 3.42 FR-E42: Per-Node Effort Level (`effort`)

- **Description:** Optional `effort` field on `WorkflowDefaults` and `NodeConfig`
  that maps to a runtime-neutral reasoning-effort dial (Claude `--effort`,
  Codex `--config model_reasoning_effort=…`, OpenCode `--variant`; Cursor
  warns and ignores). Supported values: `minimal`, `low`, `medium`, `high`
  (mirrors `ReasoningEffort` enum from `@korchasa/ai-ide-cli`). Per-node
  override cascades: node → enclosing loop → defaults → omit (CLI default).
  Skipped on `--resume` for Claude (session inherits the original effort
  level, symmetric with `--model`). The `max` level was rejected during
  implementation — it does not exist in the Claude CLI nor in the library
  enum.
  **Config schema:**
  ```yaml
  defaults:
    effort: medium          # default for all nodes
  nodes:
    architect:
      effort: high          # override for complex stages
    pm:
      effort: low           # override for simple stages
  ```

  **Engine behavior:**
  - On fresh invocation: if `effort` resolved (node-level or default), the
    engine forwards the typed `reasoningEffort` field to the runtime adapter,
    which appends `--effort <value>` (Claude) or the equivalent native control
    on other runtimes.
  - On `--resume`: engine still forwards the typed field; the library skips
    `--effort` emission when `resumeSessionId` is set (Claude). Same pattern
    as `--model`, FR-E12.
  - Loop body nodes: inherit loop node's `effort` unless overridden in inline
    `nodes` config (handled by library `resolveRuntimeConfig`'s
    node → parent → defaults cascade).
- **Motivation:** Simple nodes (PM triage, merge) don't benefit from deep
  reasoning. Complex nodes (architect, developer) do. `--effort low` reduces
  thinking tokens and latency on simple tasks; `--effort high` improves quality
  on complex ones. Experimentally verified: `claude --effort low -p ...` works
  in headless `-p` mode (Claude Code v2.1.92).
- **Acceptance criteria:**
  - **Tests:** `agent_effort_test.ts`, `config_test.ts` (FR-E42;
    regression-locked; flag forwarding, invalid-value rejection,
    cascade resolution, library skip-on-resume).



### 3.43 FR-E43: Runtime Fallback (`fallback`)

- **Description:** Optional `fallback` block on `WorkflowDefaults` that
  switches the entire runtime (and its model/effort/runtime_args/transport)
  when the primary runtime invocation fails with a classifiable
  overload / quota / availability error. Supersedes the original
  `fallback_model` scope: the failover unit is the whole runtime
  (e.g. `claude` → `codex`, `codex` → `opencode`), not a sibling model
  within the same runtime. Workflow-level only — failover policy is a
  workflow concern, not a node concern (AC4 carries over).

  **Config schema:**
  ```yaml
  defaults:
    runtime: claude
    model: claude-opus-4-6
    fallback:
      runtime: codex              # mandatory; must differ from primary
      model: gpt-5-codex          # optional; falls back to adapter default
      effort: medium              # optional
      runtime_args: {}            # optional
      transport: cli              # optional
      # Set of engine-classified error categories that trigger fallback.
      # Default: ["overloaded", "rate_limit", "quota_exhausted",
      #           "provider_unavailable"]. Other categories propagate
      # unchanged so the existing retry / on_failure_script /
      # continuation paths still apply.
      on: [overloaded, rate_limit]
  ```

  **Engine behavior:**
  - On fresh invocation: invoke the primary runtime as configured.
  - If the invocation returns a `RuntimeInvokeResult` whose
    `error_category` (FR-L36) is in `fallback.on`, the engine performs
    ONE additional invocation against the fallback runtime with a
    fresh session (cross-runtime resume is not supported — sessions
    are runtime-scoped).
  - The fallback invocation reuses the node's prompt, system prompt,
    permission mode, allowed/disallowed tools, MCP servers, HITL
    config, budget, and cwd. Model / effort / runtime_args / transport
    come from `fallback.*` if set; otherwise from the resolved
    primary node config (model is reset only if the primary value is
    not understood by the fallback runtime — engine emits a clear
    warning instead of silently dropping).
  - On continuation (`--resume`) and re-runs after `on_failure_script`
    completes: do NOT re-trigger fallback. The first invocation owns
    the fallback decision; subsequent continuations stay on whichever
    runtime answered the initial call.
  - Single attempt: if the fallback runtime also returns an
    `error_category` in `fallback.on`, the node fails through the
    normal error precedence path (FR-E34). No oscillation or
    exponential ladder of fallbacks.
  - Workflow-level only (`WorkflowDefaults`). Not per-node — failover
    policy is global. Per-node `runtime` override stays valid and
    silently disables fallback for that node when it diverges from
    `defaults.runtime` (only the primary runtime declared in
    `defaults` is eligible to fall back).
  - `fallback.runtime` MUST differ from `defaults.runtime`. Config
    validation rejects equality at load time.

  **Failure-category contract:** engine-classified categories live in
  `RuntimeInvokeResult.error_category` (FR-L36). FR-E43 consumes the
  pre-existing taxonomy — it does NOT introduce new categories. The
  initial reasonable set: `overloaded`, `rate_limit`,
  `quota_exhausted`, `provider_unavailable`. If `fallback.on` lists
  an unknown category, config validation rejects it with the full
  list of supported names.

  **Out of scope (future FRs):**
  - Chained fallbacks (`fallback.fallback`).
  - Per-node `fallback` override.
  - Adaptive policies (sticky-fallback for the rest of the run, time
    windows, breaker patterns).

- **Tasks:** [fr-e43-runtime-fallback](../tasks/2026/06/fr-e43-runtime-fallback.md)
- **Status:** Re-scoped 2026-06-02 from per-model fallback
  (`fallback_model`) to whole-runtime fallback. Implementation
  deferred — task `fr-e43-runtime-fallback` carries the open plan.


