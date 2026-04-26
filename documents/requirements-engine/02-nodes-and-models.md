<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Nodes and Models


### 3.10 FR-E10: Loop Body Node Nesting

- **Description:** Loop nodes in `workflow.yaml` must define their body nodes
  inline as nested objects, not reference top-level node IDs. This makes the
  parent-child relationship explicit, prevents body nodes from being executed
  outside their loop context, and aligns config structure with execution model.
- **Motivation:** Current config declares loop body nodes (`developer`, `qa`) at
  the top level alongside workflow-level nodes. Body nodes use loop-scoped
  template variables (`{{loop.iteration}}`) but nothing in their declaration
  indicates loop scope. This creates namespace pollution, implicit coupling,
  and misconfiguration risk.
- **Config structure:** Loop node gains a `nodes` sub-object containing inline
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
- **Acceptance criteria:**
  - [x] Loop nodes define body nodes inline via `nodes` sub-object in
    `workflow.yaml`. Evidence: `.flowai-workflow/workflow.yaml:120-158` (`implementation` loop node with inline `nodes:` containing `build` and `verify`)
  - [x] Body node IDs in `nodes` are not registered as top-level DAG nodes. Evidence: `dag.ts:17-19` (`collectLoopBodyNodes()`), `dag.ts:36-45` (body nodes filtered from main DAG in `buildLevels()`)
  - [x] Body nodes can reference external (top-level) nodes in their `inputs`. Evidence: `config.ts:204` (`validInputIds = [...allNodeIds, ...bodyNodeIds]`), `.flowai-workflow/workflow.yaml:124` (`build` inputs `[decision]` — top-level node)
  - [x] Body nodes can reference sibling body nodes (within the same loop) in
    their `inputs`. Evidence: `config.ts:190-195` (validates internal inputs for ordering), `.flowai-workflow/workflow.yaml:144` (`verify` inputs `[specification, decision, build]` — `build` is a sibling body node)
  - [x] `{{loop.iteration}}` template variable resolves only inside loop body
    node contexts. Evidence: `engine.ts:651-653` (`loop` context only when `loopIteration !== undefined`), `engine.ts:559-560` (loop body nodes receive iteration via `buildCtx`)
  - [x] Engine config loader (`config.ts`) parses nested node definitions from
    loop nodes. Evidence: `config.ts:325-338` (merges defaults into inline loop body nodes)
  - [x] Engine DAG builder (`dag.ts`) excludes loop body nodes from top-level
    topological sort. Evidence: `dag.ts:36-45` (`collectLoopBodyNodes()` filter applied in `buildLevels()`)
  - [x] Engine loop executor (`loop.ts`) resolves body node configs from the
    loop node's `nodes` sub-object. Evidence: `loop.ts:76` (`loopNode.nodes![bodyNodeId]`), `loop.ts:66` (`buildLoopBodyOrder(config, loopNodeId)`)
  - [x] Template resolver handles `{{input.<node-id>}}` for both body-to-body
    and body-to-external references. Evidence: `engine.ts:637-639` (resolves all `inputs` via `findNodeConfig` which searches top-level and loop body nodes)
  - [x] `workflow.yaml` and any other workflow configs updated to use nested
    body node definitions. Evidence: `.flowai-workflow/workflow.yaml:120-158` (`implementation` loop with inline `nodes:` sub-object)
  - [x] All existing engine tests pass after restructuring. Evidence: `deno task check` — 490 passed, 0 failed
  - [x] `deno task check` passes. Evidence: 490 passed, 0 failed



### 3.11 FR-E11: Conditional Post-Workflow Node Execution (`run_on`)

- **Description:** Replace the binary `run_always: boolean` flag with a
  `run_on: always | success | failure` enum on `NodeConfig`. Engine collects
  post-workflow nodes (those with `run_on` set) and executes them after all DAG
  levels complete, filtering by workflow outcome. This prevents committer nodes
  from creating PRs/merging when the workflow failed, while allowing meta-agent
  to always run.
- **Motivation:** `run_always: true` causes committer nodes to run on failure,
  creating PRs with `Closes #N` that merge broken code. Prompt-level guards are
  unreliable (LLM can ignore them). Engine-level gating is required.
- **Enum semantics:**
  - `run_on: always` — execute regardless of workflow outcome (current
    `run_always: true` behavior).
  - `run_on: success` — execute only when all regular DAG nodes passed.
  - `run_on: failure` — execute only when workflow failed.
  - Nodes without `run_on` execute in normal DAG order (no change).
- **Backward compatibility:** `run_always: true` in config is normalized to
  `run_on: "always"` during config loading. `run_always: false` (or absent) is
  unchanged (no `run_on` set).
- **Acceptance criteria:**
  - [x] `NodeConfig` in `types.ts` has `run_on?: "always" | "success" | "failure"` field. `run_always` deprecated. Evidence: `types.ts:66-69` (`run_on?` field, `run_always?: boolean` with `@deprecated` tag)
  - [x] `config.ts` normalizes `run_always: true` → `run_on: "always"` for backward compat. Evidence: `config.ts:341-347` (normalizes `run_always: true` → `run_on: "always"`, deletes `run_always`)
  - [x] Engine filters post-workflow nodes: skips `run_on: success` nodes when workflow failed, skips `run_on: failure` nodes when workflow succeeded. Evidence: `engine.ts:182-199` (skip logic with `markNodeSkipped`)
  - [x] Meta-agent runs on every outcome (`run_on: always`). Evidence: `.flowai-workflow/workflow.yaml:174` (`optimize` node `run_on: always`), `engine.ts:182-199` (`run_on: always` bypasses skip filter)
  - [x] `workflow.yaml` migrated from `run_always: true` to appropriate `run_on` values. Evidence: `.flowai-workflow/workflow.yaml:174` (`optimize: run_on: always`), `.flowai-workflow/workflow.yaml:200` (`tech-lead-review: run_on: always`)
  - [x] Engine remains domain-agnostic — no git/PR/GitHub logic in engine code. Evidence: `git.ts` deleted; `engine.ts` uses generic `on_failure_script` hook; `mod.ts` git re-exports removed.
  - [x] All existing engine tests pass; new tests cover `run_on` filtering logic. Evidence: `engine_test.ts:211-506` (collectPostWorkflowNodes and run_on tests), `config_test.ts:446-564` (run_on validation + run_always normalization tests); 490 passed, 0 failed
  - [x] `deno task check` passes. Evidence: 490 passed, 0 failed



### 3.12 FR-E12: Per-Node Model Configuration

- **Description:** Add `model` field to `WorkflowDefaults` and `NodeConfig` in
  workflow config. Engine emits `--model <value>` flag when invoking Claude CLI
  for agent nodes. Node-level `model` overrides default; absent = CLI default.
  Enables cost optimization (cheap model for simple stages) and quality
  optimization (strong model for complex stages).
- **Motivation:** All nodes currently use the same model. Simple stages (PM, QA)
  don't need expensive reasoning models. Complex stages (architect, tech-lead,
  meta-agent) benefit from stronger models. Static per-node config is the
  simplest approach.
- **Config schema:**
  ```yaml
  defaults:
    model: "claude-sonnet-4-6"  # default for all nodes
  nodes:
    architect:
      model: "claude-opus-4-6"    # override for complex stages
  ```
- **Engine behavior:**
  - On fresh invocation: if `model` resolved (node-level or default), append
    `--model <value>` to Claude CLI args.
  - On `--resume`: do NOT emit `--model`. Session inherits model from original
    invocation.
  - Loop body nodes: inherit loop node's `model` unless overridden in inline
    `nodes` config.
- **Acceptance criteria:**
  - [x] `WorkflowDefaults` in `types.ts` has `model?: string` field. Evidence: `types.ts:21`
  - [x] `NodeConfig` in `types.ts` has `model?: string` field. Evidence: `types.ts:39`
  - [x] `config.ts` parses `model` from defaults and node configs. Evidence: `config.ts:26-33` (YAML pass-through via structural typing; `WorkflowDefaults`/`NodeConfig` types carry `model?`)
  - [x] `agent.ts` `buildClaudeArgs()` emits `--model <value>` when model is set. Evidence: `agent.ts:309-311`
  - [x] `agent.ts` does NOT emit `--model` on `--resume` invocations. Evidence: `agent.ts:309` (`&& !opts.resumeSessionId` guard)
  - [x] Loop body nodes resolve model from: own config > loop node config > defaults. Evidence: `loop.ts:76`
  - [x] `workflow.yaml` updated: default model + per-node overrides for complex stages. Evidence: `.flowai-workflow/workflow.yaml:15` (default), `.flowai-workflow/workflow.yaml:65,84,147` (overrides)
  - [x] All existing engine tests pass; new tests cover model flag emission and resolution. Evidence: `agent_test.ts:207-233` (3 model tests); 434 tests pass.
  - [x] `deno task check` passes. Evidence: validated — 434 passed, 0 failed.



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
  - [x] Body node referencing external input not listed in loop `inputs` is
    rejected at parse time with a config error. Evidence:
    `config.ts:273-289`.
  - [x] Error message identifies body node ID, loop node ID, and all missing
    external input IDs. Evidence: `config.ts:284-288` — message:
    `"Loop '${id}' body node '${bodyId}' references external input(s) [${missing.join(", ")}] not listed in loop inputs"`.
  - [x] Body node referencing a sibling body node generates no error (intra-body
    refs are valid). Evidence: `config.ts:279-280`
    (`!bodyNodeIds.includes(inp)` guard); `config_test.ts:235-262`.
  - [x] Forwarding mechanism and validation algorithm documented in SDS
    (`documents/design-engine.md`). Evidence: `documents/design-engine.md:109-116`
    (§3.1 `config.ts`), `documents/design-engine.md:569-581` (§5 Logic).
  - [x] `deno task check` green: 528 tests, 0 failures. Evidence: CI run
    on branch `sdlc/issue-153`.



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
  - [x] Parse-time: if condition node has a non-empty `validate` block, validate that a
    `frontmatter_field` rule with matching `field` exists. Evidence:
    `config.ts:291-312`.
  - [x] Parse-time: if condition node has no `validate` block, skip check (no contract to
    enforce). Evidence: `config.ts:300`
    (`if (Array.isArray(condNodeRaw.validate) && condNodeRaw.validate.length > 0)`).
  - [x] Parse-time error message identifies loop ID, field, and condition node. Evidence:
    `config.ts:308-310` — message:
    `"Loop '${id}' condition_field '${node.condition_field}' is not declared as a frontmatter_field in condition node '${node.condition_node}' validate block"`.
  - [x] Runtime: `extractConditionValue()` throws descriptive error when field absent.
    Evidence: `loop.ts:224-226` — message:
    `"Loop '${loopId}': condition_field '${field}' not found in condition node '${condNodeId}' output at '${nodeDir}'"`.
  - [x] Runtime: `loopId` and `condNodeId` threaded through `extractConditionValue()`
    signature (updated from 3 to 5 params); `runLoop()` passes them. Evidence:
    `loop.ts:192-198` (signature), `loop.ts:144-151` (call site).
  - [x] Parse-time tests (2): missing rule → throws (`config_test.ts:1139-1173`),
    present rule → passes (`config_test.ts:1175-1206`).
  - [x] Runtime tests (3): throws when field absent in output file
    (`loop_test.ts:281-317`), throws when output dir empty
    (`loop_test.ts:319-351`), returns value when field present
    (`loop_test.ts:353-378`).
  - [x] `deno task check` green: 533 tests, 0 failures. Evidence: run `20260319T221833`.



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
- **Motivation:** Simple nodes (PM triage, merge) don't benefit from deep
  reasoning. Complex nodes (architect, developer) do. `--effort low` reduces
  thinking tokens and latency on simple tasks; `--effort high` improves quality
  on complex ones. Experimentally verified: `claude --effort low -p ...` works
  in headless `-p` mode (Claude Code v2.1.92).
- **Config schema:**
  ```yaml
  defaults:
    effort: medium          # default for all nodes
  nodes:
    architect:
      effort: high          # override for complex stages
    pm:
      effort: low           # override for simple stages
  ```
- **Engine behavior:**
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
- **Acceptance criteria:**
  - [x] AC1: `WorkflowDefaults` in `types.ts` has `effort?: ReasoningEffort`
    field. Evidence: `types.ts:91-95`.
  - [x] AC2: `NodeConfig` in `types.ts` has `effort?: ReasoningEffort` field.
    Evidence: `types.ts:139-141`.
  - [x] AC3: Config validation rejects invalid values (must be one of
    `minimal`, `low`, `medium`, `high`). Error message identifies node ID and
    invalid value. Evidence: `config.ts:198-211` (defaults),
    `config.ts:472-485` (per-node), `config_test.ts:1421-1488`.
  - [x] AC4: Library `buildClaudeArgs()` emits `--effort <value>` when set
    AND `resumeSessionId` is NOT set. Evidence:
    `../ai-ide-cli/claude/process.ts:269-275`,
    `../ai-ide-cli/claude/process_test.ts` (FR-L25 tests).
  - [x] AC5: Per-node override resolution (node → parent → defaults) via
    library `resolveRuntimeConfig`. Engine forwards
    `runtimeConfig.reasoningEffort` from `node-dispatch.ts` and `loop.ts`.
    Evidence: `node-dispatch.ts:93,129,213`, `loop.ts:200`,
    `agent_effort_test.ts:131-178`.
  - [x] AC6: Loop body nodes inherit effort from enclosing loop node unless
    overridden. Evidence: `agent_effort_test.ts:152-167` (parent inherit +
    node override beats parent).
  - [x] AC7: Unit tests: flag emission, skip on resume (library), invalid
    value rejection, cascade resolution. Evidence:
    `agent_effort_test.ts:97-128` (forwarding on initial + continuation),
    `agent_effort_test.ts:130-178` (cascade), `config_test.ts:1421-1488`
    (validation), library tests in `../ai-ide-cli/claude/process_test.ts`.
  - [x] AC8: `deno task check` passes. Evidence: green run with
    `agent_effort_test.ts` (7/7) and updated `config_test.ts` (111/111).



### 3.43 FR-E43: Fallback Model (`fallback_model`)

- **Description:** Optional `fallback_model` field on `WorkflowDefaults` that
  maps to Claude Code's `--fallback-model` CLI flag. Enables automatic model
  fallback when primary model is overloaded (works only with `-p` mode, which
  is our execution mode). Applied globally — not per-node (failover policy is
  a workflow concern, not a node concern).
- **Motivation:** Long-running workflows (30+ min) are vulnerable to transient
  model overloads mid-execution. Without fallback, the node fails and the
  entire workflow stops. `--fallback-model` provides transparent retry on a
  cheaper model, keeping the workflow alive. Experimentally verified: flag
  accepted by Claude Code v2.1.92 in `-p` mode.
- **Config schema:**
  ```yaml
  defaults:
    model: claude-opus-4-6
    fallback_model: claude-sonnet-4-6   # auto-fallback on overload
  ```
- **Engine behavior:**
  - On fresh invocation: if `fallback_model` set, append
    `--fallback-model <value>` to Claude CLI args.
  - On `--resume`: do NOT emit `--fallback-model`. Session inherits model
    context from original invocation.
  - Workflow-level only (`WorkflowDefaults`). Not per-node — overload is
    transient and model-specific, not task-specific.
- **Acceptance criteria:**
  - [ ] AC1: `WorkflowDefaults` in `types.ts` has `fallback_model?: string`
    field.
  - [ ] AC2: `buildClaudeArgs()` emits `--fallback-model <value>` when set AND
    `resumeSessionId` is NOT set.
  - [ ] AC3: Config validation: if `fallback_model` set, `model` (defaults or
    node-level) must also be set (fallback without primary is meaningless).
    Error: `"fallback_model requires defaults.model to be set"`.
  - [ ] AC4: Not exposed on `NodeConfig` — workflow-level only. No per-node
    override.
  - [ ] AC5: Unit tests: flag emission, skip on resume, validation
    (fallback without model), absence (no flag).
  - [ ] AC6: `deno task check` passes.


