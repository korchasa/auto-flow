<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Execution Model


### 3.1 FR-E1: Continuation Mechanism

- **Description:** Each stage script wraps the selected agent runtime invocation and validates the agent's output before considering the stage complete. If validation fails, the script re-invokes the agent in the same session using the runtime's session-resume mechanism (`claude --resume`, `opencode run --session`) with a description of the problem, giving the agent a chance to fix its output without starting from scratch. This is continuation WITHIN one attempt; continuing a session across attempts (the next loop iteration, a later node) is FR-E100 (`session:`), which reuses the same resume invoke shape.
- **Tasks:** [session-continuation-across-attempts](../tasks/2026-09-07-session-continuation-across-attempts.md)
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
  - [x] Engine source code lives under a standard `src/` or dedicated top-level directory (not `.flowai-workflow/engine/`). Evidence: `src/` (top-level directory, grouped by domain — `src/engine/`, `src/config/`, `src/state/`, `src/isolation/`, `src/hitl/`, `src/mcp/`)
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
  - [x] Claude system prompt interpolation is persisted as a per-node
    runtime artifact at `<node-dir>/system-prompt.md` before the fresh
    invocation, while resume invocations do not rewrite or resend it.
    Evidence: `agent.ts::prepareSystemPromptDelivery`,
    `agent_test.ts::runAgent writes interpolated system prompt artifact`.



### 3.14 FR-E14: Engine-Workflow Separation Invariant

- **Description:** The workflow engine (`src/`) is a domain-agnostic DAG executor. It MUST be physically separated from workflow-specific concerns (config, agents, run artifacts) by directory structure, not only by convention. This constraint is structural and must be enforced by the project layout.

  **Rules:**
  - Engine source lives in a dedicated top-level directory (e.g., `src/` or a standardized path); no workflow, agent, git, or GitHub-specific logic inside.
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
  5. The hook fires on the workflow outcome alone. A workflow that declares no
     `run_on` node at all still runs it on failure — it used to return before
     the hook, because the hook lived inside the post-workflow scheduler
     (FR-E99).

  The hook runs once per engine invocation, between the graph and the outcome
  wave, so a resumed run that fails again fires it again.
- **Tasks:** [one-scheduler-run-outcome](../tasks/2026-08-30-one-scheduler-run-outcome.md)
- **Motivation:** Without formal definition, workflow authors cannot predict
  whether the failure hook fires when a node is `continue`-d. Deterministic
  rules prevent silent unexpected hook invocations.
- **Acceptance criteria:**
  - **Tests:** `engine_test.ts` (FR-E34; regression-locked; 5 cases
    cover the 4 interaction rules + log-message format).




### 3.86 FR-E86: Runtime Adapter Injection Seam

- **Description:** `EngineOptions.runtimeAdapter?: RuntimeAdapter` substitutes
  the runtime for EVERY agent invocation of a run — top-level agent nodes
  (`node-dispatch.ts`), loop-body nodes (`LoopRunOptions.runtimeAdapter` →
  `loop.ts`), and HITL resume turns (`hitl-handler.ts`). Omitting it keeps
  production behaviour: each node resolves its real adapter through
  `resolveRuntimeConfig` + `getRuntimeAdapter`. The seam carries no workflow
  config surface — `workflow.yaml` cannot select it, so a real run cannot
  silently execute against a fake.

  **Test runtime (`src/testing/fake-runtime.ts`).** `createFakeRuntime(handler)`
  builds an adapter driven by a TypeScript handler rather than a scripted data
  file: the handler asserts on the `RuntimeInvokeOptions` it receives and
  generates the reply, with full control over timing (`call.sleep()` rejects on
  the FR-E80 abort signal), artifacts (`call.write()`), replies
  (`call.reply()`), output-less runtime death (`call.fail()`), and adapter
  crashes (throw). `adapter.calls` exposes the invocation history, making the
  engine↔`@korchasa/ai-ide-cli` contract (pinned `transport: "acp"`,
  `resumeSessionId`, injected `mcpServers`, tool filters, budget signal)
  directly assertable. Capabilities default to the REAL adapter's vector for
  the same runtime id, so a library capability change surfaces in fakes instead
  of drifting. The module is excluded from the JSR tarball
  (`deno.json#publish.exclude`).
- **Motivation:** The engine's own logic — validation, continuation, resume,
  scope guardrail, HITL routing, state, journal, cost aggregation — sat above
  `adapter.invoke()` with no way to exercise it end-to-end: `Engine.run()` and
  `runLoop()` had no adapter seam, so integration tests "required the claude
  CLI" and were never written. Every engine-side failure closed in the ACP
  transport report (`stream.log` ownership, degraded-options WARN, FR-E80
  runaway retries) lived in exactly that band. Emulating the ACP front instead
  was rejected: a fake front can only encode our beliefs about the protocol,
  and the observed front-level defects (`-32700`, silently dropped
  `resumeSessionId`) were precisely where those beliefs were wrong.
- **Dep:** FR-E60
- **Acceptance criteria:**
  - **Tests:** `fake-runtime_test.ts`, `engine_test.ts`, `loop_test.ts`
    (FR-E86; regression-locked). Locks the helper contract, the top-level
    agent-node injection site and the loop-body one; the three
    `handleAgentHitl` sites and the `runLoop` dispatch site in
    `executeLoopNode` are wired but NOT yet regression-locked — see
    design-engine §3.8 for the mutation evidence.
