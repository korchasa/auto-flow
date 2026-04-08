# SRS: Engine

## 0. Resolved Design Decisions

- **Cost limits:** Not tracked. No budget constraints.
- **Rollback:** Manual operation (no automated rollback).
- **Retry logic:** 3 attempts with exponential backoff for external API calls (`claude`, `gh`) in `lib.sh`.
- **Target project:** Engine is domain-agnostic; no project-specific logic. Workflow configs define domain workflows.
- **Concurrent workflows:** Single local execution assumed. No concurrent locking.

## 1. Introduction

- **Document purpose:** Define the specification for the domain-agnostic DAG executor engine that orchestrates AI agent workflows.
- **Scope:** A locally-run Deno/TypeScript engine that reads YAML workflow configs, resolves node dependencies via topological sort, executes nodes sequentially (agent, loop, merge, human types), manages validation/continuation, and persists run state. Entry: `deno task run [--prompt "..."]`.
- **Audience:** Engine developers, workflow authors.
- **Definitions and abbreviations:**
  - **Node:** A single unit in the DAG workflow (agent, loop, merge, or human type).
  - **Agent:** An isolated Claude Code CLI invocation with a dedicated system prompt.
  - **Continuation:** Re-invoking an agent within the same session (via `--resume`) to fix issues detected by validation (see FR-E1).
  - **HITL:** Human-in-the-loop — agent-initiated request for human input.
  - **DAG:** Directed acyclic graph defining node execution order.

## 2. General Description

- **System context:** Operates as a local Deno engine process triggered by CLI command (`deno task run [--prompt "..."]`). Reads workflow DAG config (YAML), executes nodes sequentially via `claude` CLI, validates outputs, manages continuations and resume. Domain-agnostic: no git, GitHub, or SDLC logic in engine code.
- **Assumptions and constraints:**
  - Each agent is stateless between runs — all context comes from input artifacts and its system prompt.
  - Engine is workflow-independent: MUST NOT depend on any specific workflow config. One engine, many workflows.
  - Engine MUST NOT contain references to concrete artifact filenames, node names, or domain-specific logic.

## 3. Functional Requirements

### 3.1 FR-E1 (ex FR-8): Continuation Mechanism

- **Description:** Each stage script wraps the Claude Code CLI invocation and validates the agent's output before considering the stage complete. If validation fails, the script re-invokes the agent in the same session using `--resume` with a description of the problem, giving the agent a chance to fix its output without starting from scratch.
- **Acceptance criteria:**
  - **Stage script responsibilities (engine path — `engine/`):**
    1. [x] Invoke `claude` CLI with the stage prompt and input artifacts. Evidence: `engine/agent.ts:208-230` (`buildClaudeArgs`), `engine/agent.ts:75-117` (invocation loop)
    2. After the agent exits, run stage-specific validation checks:
       - [x] **For Developer stage:** run `deno task check` via `custom_script` validation rule. If it fails, continuation is triggered. Evidence: `engine/validate.ts:49-50,127-162` (`checkCustomScript()`), `.flowai-workflow/workflow.yaml` (developer node `custom_script` config)
       - [x] **For QA stage:** (1) verify `05-qa-report-N.md` exists and is non-empty, (2) extract verdict via frontmatter parsing, (3) if verdict is not exactly `PASS` or `FAIL` — treat as validation failure, trigger continuation on QA agent. Evidence: `engine/validate.ts:51-52,164-228` (`checkFrontmatterField()`), `engine/validate_test.ts:225-351` (6 tests)
       - [x] **For all stages:** verify the expected output artifact exists and is non-empty. Evidence: `engine/validate.ts:60-88` (`file_exists`, `file_not_empty` rules), `.flowai-workflow/workflow.yaml` (per-node `validate` config)
    3. [x] If validation fails: re-invoke `claude --resume <session-id>` with the validation error output appended as context. Evidence: `engine/agent.ts:94-116` (resume prompt construction + `invokeClaudeCli` with `resumeSessionId`)
    4. [x] Repeat until validation passes or the continuation limit is reached. Evidence: `engine/agent.ts:75-91` (loop with `continuations < settings.max_continuations`)
  - **Continuation limits:**
    - [x] Maximum continuations per stage: configurable (default 3). Evidence: `.flowai-workflow/workflow.yaml:9` (`max_continuations: 3`), `engine/agent.ts:82-91`
    - [x] If limit reached: stage is marked as failed, workflow stops, Meta-Agent is triggered (FR-11, FR-E11). Evidence: `engine/engine.ts:96-109,613-619` (`collectRunOnNodes()`), `engine/types.ts:56-57` (`run_on` field), `engine/agent.ts:110-120` (continuation limit check)
  - **Session persistence:**
    - [x] The `--resume` flag ensures the agent retains full conversation context from the initial invocation. Evidence: `engine/agent.ts:208-230` (`--resume` flag in `buildClaudeArgs`)
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

### 3.2 FR-E2 (ex FR-10): Agent Log Storage

- **Description:** Every agent's full session transcript is stored for analysis and prompt improvement.
- **Log sources:**
  - **JSON output:** Claude CLI with `--output-format json` returns a structured JSON object with `result`, `session_id`, `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `is_error`. This is captured by the stage script or engine.
  - **JSONL transcript:** Claude CLI automatically stores full session transcripts as JSONL files in `~/.claude/projects/`. Each line is a JSON event (messages, tool calls, responses).
- **Acceptance criteria (legacy shell script path):**
  - Each stage script saves two log files:
    - `.flowai-workflow/workflow/<issue-number>/logs/stage-<N>-<role>.json` — the JSON output from `claude` CLI (metadata: cost, duration, session ID, result).
    - `.flowai-workflow/workflow/<issue-number>/logs/stage-<N>-<role>.jsonl` — copy of the JSONL transcript from `~/.claude/projects/` for the session.
  - Logs are committed to the feature branch after each stage.
  - Stage script locates the JSONL transcript by session ID extracted from the JSON output.
- **Acceptance criteria (Deno engine path):**
  - [x] After each non-loop agent node completes successfully, the engine saves two files to `.flowai-workflow/runs/<run-id>/logs/`:
    - `<node-id>.json` — full `ClaudeCliOutput` JSON object (`result`, `session_id`, `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `is_error`).
    - `<node-id>.jsonl` — copy of the JSONL session transcript from `~/.claude/projects/<project-hash>/`, located by matching `session_id` in filenames.
    - Evidence: `engine/engine.ts:266-270`, `engine/log.ts:18-47`
  - [x] If the JSONL transcript file is not found: engine logs a warning and continues — workflow does NOT fail. Evidence: `engine/log.ts:43-45`
  - [x] Loop body nodes (developer, qa) must have logs saved after each iteration. Log files use iteration-qualified names: `<node-id>-iter-<N>.json` and `<node-id>-iter-<N>.jsonl`. `runLoop()` calls `saveAgentLog()` for each body node after successful completion. Evidence: `engine/engine.ts:574-582` (onNodeComplete callback in executeLoopNode saves logs using `${id}-iter-${iteration}` node ID)
  - [x] `LoopResult` includes per-iteration `AgentResult` references (with `ClaudeCliOutput`) to enable log extraction by the engine. Evidence: `engine/loop.ts:18-26` (`LoopResult.bodyResults: AgentResult[]`), `engine/loop.ts:69,99` (initialized, pushed per body node per iteration)
  - [x] Log-saving logic has unit tests covering: successful save, JSONL-not-found warning path. Evidence: `engine/log_test.ts:29-124` (5 tests)

### 3.3 FR-E3 (ex FR-13): Artifact Versioning

- **Description:** Defines how workflow artifacts are managed on repeated runs for the same issue.
- **Acceptance criteria:**
  - On re-run, artifacts in `.flowai-workflow/workflow/<issue-number>/` are overwritten.
  - Previous versions are preserved in git history of the feature branch.
  - QA reports use iteration suffix (`05-qa-report-1.md`, `05-qa-report-2.md`) within a single run; on re-run, iteration numbering restarts from 1.
  - Log files are overwritten on re-run (previous logs preserved in git history).

### 3.4 FR-E4 (ex FR-15): Configuration

- **Description:** Workflow configuration via environment variables and `workflow.yaml`. Env vars override YAML defaults.
- **Variables:**
  - `SDLC_MAX_CONTINUATIONS` — maximum continuations per stage (default: `3`).
  - `SDLC_MAX_QA_ITERATIONS` — maximum Developer+QA loop iterations (default: `3`).
  - `SDLC_STAGE_TIMEOUT_MINUTES` — default timeout per stage in minutes (default: `30`).
- **Acceptance criteria:**
  - All variables have sensible defaults in `lib.sh` (legacy) and engine config (`engine/config.ts`).
  - Engine and stage scripts read configuration from environment, falling back to defaults.

### 3.5 FR-E5 (ex FR-17): Project Directory Structure

- **Description:** Project directory layout must reflect application structure, not be buried under a single `.flowai-workflow/` prefix. Engine code, agent prompts, workflow config, and run artifacts should be organized at the top level as distinct concerns.
- **Motivation:** Current `.flowai-workflow/` prefix conflates engine source code, configuration, runtime data, and legacy scripts. This hinders navigation, IDE support, and standard tooling (test runners, linters).
- **Acceptance criteria:**
  - [x] Engine source code lives under a standard `src/` or dedicated top-level directory (not `.flowai-workflow/engine/`). Evidence: `engine/` (top-level directory, 30 files moved via `git mv .flowai-workflow/engine/ engine/`)
  - ~~`[ ] Agent prompts in a top-level agents/ directory`~~ — superseded by FR-36/FR-19: canonical location is `.flowai-workflow/agents/agent-<name>/`.
  - [x] Workflow config path configurable via `--config <path>` flag (default: `.flowai-workflow/workflow.yaml`). Engine is config-path-agnostic — no hardcoded root assumption. Evidence: `engine/cli.ts:7,37` (`--config` flag definition and handling), `engine/config.ts:37` (`loadConfig(path)` accepts any path)
  - [x] Run artifacts in gitignored `.flowai-workflow/runs/` directory; `.gitignore` updated. Evidence: `.gitignore:3` (`.flowai-workflow/runs/` entry)
  - ~~`[ ] Legacy shell scripts in a scripts/ directory (not .flowai-workflow/scripts/)`~~ — SDLC workflow convention, not engine constraint. Legacy scripts remain at `.flowai-workflow/scripts/` (SDLC scope, outside engine boundary).
  - [x] `deno.json` tasks (`run`, `check`, `test`) updated to reference `engine/cli.ts` and `scripts/`. Evidence: `deno.json:7,19` (`check`, `run` tasks referencing `engine/cli.ts`)
  - [x] All existing engine tests pass after restructuring. Evidence: `deno task check` passes.
  - [x] SDS (`documents/design-engine.md`) updated to reflect implemented layout. Evidence: `documents/design-engine.md` §3.1 (engine modules), §3.2 (Phase Registry — IMPLEMENTED with evidence)

### 3.6 FR-E6 (ex FR-18): Verbose Output (`-v`)

- **Description:** With `-v` flag, engine output must provide full transparency into what is happening at every step — not just node start/stop, but the reasoning context: what input is being passed, what prompt is constructed, what validation is run, what the result is.
- **Motivation:** Current verbose mode shows only lifecycle events (started/completed/failed). Debugging workflow issues or understanding agent behavior requires reading log files after the fact.
- **Acceptance criteria:**
  - [x] `-v` shows the full task prompt text sent to each agent (after template interpolation). Evidence: `engine/output.ts:109-114` (`verbosePrompt()`), `engine/agent.ts:67-69`
  - [x] `-v` shows the list of input artifacts resolved for each node (file paths + sizes). Evidence: `engine/output.ts:117-123` (`verboseInputs()`), `engine/engine.ts:280`
  - [x] `-v` shows validation rule execution: which rules ran, pass/fail per rule, failure details. Evidence: `engine/output.ts:126-137` (`verboseValidation()`), `engine/agent.ts:98-104`
  - [x] `-v` shows continuation context: why continuation was triggered, what error text is appended. Evidence: `engine/output.ts:140-151` (`verboseContinuation()`), `engine/agent.ts:126-135`
  - [x] `-v` streams agent stdout in real-time (not buffered until completion). Evidence: `engine/output.ts` (`nodeOutput()` method — pre-existing)
  - ~~`-v` shows safety check results~~ — `verboseSafety()` removed (FR-56: engine domain-agnostic refactor; safety output now via agent stdout).
  - ~~`-v` shows commit details~~ — `verboseCommit()` removed (FR-56: engine no longer commits; git operations delegated to agent nodes).
  - [x] Default mode (no `-v`) remains concise: node start/complete/fail + summary. Evidence: `engine/output_test.ts:175-197` (all 6 verbose methods produce zero output in default mode)

### 3.7 FR-E7 (ex FR-20): Workflow Config Drift Detection

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

### 3.8 FR-E8 (ex FR-21): Human-in-the-Loop (Agent-Initiated)

- **Description:** Any workflow agent can request human input mid-task by calling the built-in `AskUserQuestion` tool. The engine detects this call (denied in `-p` mode but visible in JSON output as `permission_denials`), delegates question delivery and reply polling to external workflow scripts, and resumes the agent session with the human's answer via `--resume`.
- **Mechanism:**
  1. Agent calls `AskUserQuestion` → Claude CLI denies it in `-p` mode (no terminal) → structured question visible in `permission_denials` field of JSON `result` event.
  2. Engine extracts question (`{question, header, options[], multiSelect}`) and `session_id`.
  3. Engine invokes configurable `ask_script` (workflow script, not engine code) to deliver question (e.g., `gh issue comment`).
  4. Engine enters poll loop: `sleep poll_interval` → invoke `check_script` → if exit 0 (reply found), read reply from stdout.
  5. Engine resumes agent: `claude --resume <session_id> -p "<reply>"`. Agent continues with full session context.
- **Key constraint:** Engine contains zero GitHub/Slack/email-specific code. All delivery/polling logic lives in workflow scripts (`.flowai-workflow/scripts/`).
- **Acceptance criteria:**
  - [x] Engine detects `AskUserQuestion` in `permission_denials` of Claude CLI JSON output after agent node completes. Evidence: `engine/hitl.ts:61-93` (`detectHitlRequest()`), `engine/engine.ts:316-319` (call in `executeAgentNode`)
  - [x] Engine saves `session_id`, question JSON, and node status `waiting` to `state.json`. Evidence: `engine/state.ts:93-103` (`markNodeWaiting()`), `engine/engine.ts:324-325` (call + saveState), `engine/types.ts:104` (`question_json` field)
  - [x] Engine invokes `ask_script` (path from `workflow.yaml` `defaults.hitl`) with args: `--run-dir`, `--artifact-source`, `--run-id`, `--node-id`, `--question-json`. Evidence: `engine/hitl.ts:111-125` (`buildScriptArgs("ask")`), `engine/hitl.ts:127-134` (ask invocation)
  - [x] Engine enters poll loop calling `check_script` with args: `--run-dir`, `--artifact-source`, `--run-id`, `--node-id`, `--exclude-login`. Exit 0 = reply in stdout; exit 1 = no reply yet. Evidence: `engine/hitl.ts:137-175` (poll loop), `engine/hitl_test.ts:184-214` (poll test)
  - [x] On reply: engine resumes agent via `claude --resume <session_id> -p "<reply>"`. Evidence: `engine/hitl.ts:158-172` (claudeRun with resumeSessionId)
  - [x] Configurable `poll_interval` (default 60s) and `timeout` (default 7200s) per workflow. Evidence: `engine/types.ts:170-175` (`HitlConfig`), `.flowai-workflow/workflow.yaml:16-20` (defaults.hitl)
  - [x] On timeout: node fails, Meta-Agent triggered. Evidence: `engine/hitl.ts:183-188` (timeout return), `engine/engine.ts:342-347` (markNodeFailed on HITL failure), `engine/hitl_test.ts:216-230` (timeout test)
  - [x] `deno task run` on a workflow with `waiting` nodes auto-resumes polling (no manual `--resume` needed). Evidence: `engine/engine.ts:278-310` (wasWaiting resume path in executeAgentNode)
  - [x] Workflow scripts `hitl-ask.sh` and `hitl-check.sh` exist in `.flowai-workflow/scripts/`. Evidence: `.flowai-workflow/scripts/hitl-ask.sh`, `.flowai-workflow/scripts/hitl-check.sh`
  - [x] `hitl-ask.sh` renders question JSON → markdown with HTML marker `<!-- hitl:<run-id>:<node-id> -->`, posts via `gh issue comment`. Evidence: `.flowai-workflow/scripts/hitl-ask.sh:52-76` (markdown render + marker + gh post)
  - [x] `hitl-check.sh` finds first non-bot comment after marker, outputs body to stdout (exit 0) or exits 1 if no reply. Evidence: `.flowai-workflow/scripts/hitl-check.sh:39-54` (jq filter + exit codes)

### 3.9 FR-E9 (ex FR-23): Run Artifacts Folder Structure

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
  - [ ] Engine's state manager, log saver, and artifact validator work with
    the new directory structure.
  - [ ] Existing workflow.yaml node definitions require minimal changes (phase
    grouping derived from config or convention, not hardcoded per-node paths).
  - [ ] All existing engine tests pass after restructuring.

### 3.10 FR-E10 (ex FR-24): Loop Body Node Nesting

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
  - [x] Body node IDs in `nodes` are not registered as top-level DAG nodes. Evidence: `engine/dag.ts:17-19` (`collectLoopBodyNodes()`), `engine/dag.ts:36-45` (body nodes filtered from main DAG in `buildLevels()`)
  - [x] Body nodes can reference external (top-level) nodes in their `inputs`. Evidence: `engine/config.ts:204` (`validInputIds = [...allNodeIds, ...bodyNodeIds]`), `.flowai-workflow/workflow.yaml:124` (`build` inputs `[decision]` — top-level node)
  - [x] Body nodes can reference sibling body nodes (within the same loop) in
    their `inputs`. Evidence: `engine/config.ts:190-195` (validates internal inputs for ordering), `.flowai-workflow/workflow.yaml:144` (`verify` inputs `[specification, decision, build]` — `build` is a sibling body node)
  - [x] `{{loop.iteration}}` template variable resolves only inside loop body
    node contexts. Evidence: `engine/engine.ts:651-653` (`loop` context only when `loopIteration !== undefined`), `engine/engine.ts:559-560` (loop body nodes receive iteration via `buildCtx`)
  - [x] Engine config loader (`config.ts`) parses nested node definitions from
    loop nodes. Evidence: `engine/config.ts:325-338` (merges defaults into inline loop body nodes)
  - [x] Engine DAG builder (`dag.ts`) excludes loop body nodes from top-level
    topological sort. Evidence: `engine/dag.ts:36-45` (`collectLoopBodyNodes()` filter applied in `buildLevels()`)
  - [x] Engine loop executor (`loop.ts`) resolves body node configs from the
    loop node's `nodes` sub-object. Evidence: `engine/loop.ts:76` (`loopNode.nodes![bodyNodeId]`), `engine/loop.ts:66` (`buildLoopBodyOrder(config, loopNodeId)`)
  - [x] Template resolver handles `{{input.<node-id>}}` for both body-to-body
    and body-to-external references. Evidence: `engine/engine.ts:637-639` (resolves all `inputs` via `findNodeConfig` which searches top-level and loop body nodes)
  - [x] `workflow.yaml` and any other workflow configs updated to use nested
    body node definitions. Evidence: `.flowai-workflow/workflow.yaml:120-158` (`implementation` loop with inline `nodes:` sub-object)
  - [x] All existing engine tests pass after restructuring. Evidence: `deno task check` — 490 passed, 0 failed
  - [x] `deno task check` passes. Evidence: 490 passed, 0 failed

### 3.11 FR-E11 (ex FR-25): Conditional Post-Workflow Node Execution (`run_on`)

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
  - [x] `NodeConfig` in `types.ts` has `run_on?: "always" | "success" | "failure"` field. `run_always` deprecated. Evidence: `engine/types.ts:66-69` (`run_on?` field, `run_always?: boolean` with `@deprecated` tag)
  - [x] `config.ts` normalizes `run_always: true` → `run_on: "always"` for backward compat. Evidence: `engine/config.ts:341-347` (normalizes `run_always: true` → `run_on: "always"`, deletes `run_always`)
  - [x] Engine filters post-workflow nodes: skips `run_on: success` nodes when workflow failed, skips `run_on: failure` nodes when workflow succeeded. Evidence: `engine/engine.ts:182-199` (skip logic with `markNodeSkipped`)
  - [x] Meta-agent runs on every outcome (`run_on: always`). Evidence: `.flowai-workflow/workflow.yaml:174` (`optimize` node `run_on: always`), `engine/engine.ts:182-199` (`run_on: always` bypasses skip filter)
  - [x] `workflow.yaml` migrated from `run_always: true` to appropriate `run_on` values. Evidence: `.flowai-workflow/workflow.yaml:174` (`optimize: run_on: always`), `.flowai-workflow/workflow.yaml:200` (`tech-lead-review: run_on: always`)
  - [x] Engine remains domain-agnostic — no git/PR/GitHub logic in engine code. Evidence: `engine/git.ts` deleted; `engine/engine.ts` uses generic `on_failure_script` hook; `engine/mod.ts` git re-exports removed.
  - [x] All existing engine tests pass; new tests cover `run_on` filtering logic. Evidence: `engine/engine_test.ts:211-506` (collectPostWorkflowNodes and run_on tests), `engine/config_test.ts:446-564` (run_on validation + run_always normalization tests); 490 passed, 0 failed
  - [x] `deno task check` passes. Evidence: 490 passed, 0 failed

### 3.12 FR-E12 (ex FR-27): Per-Node Model Configuration

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
  - [x] `WorkflowDefaults` in `types.ts` has `model?: string` field. Evidence: `engine/types.ts:21`
  - [x] `NodeConfig` in `types.ts` has `model?: string` field. Evidence: `engine/types.ts:39`
  - [x] `config.ts` parses `model` from defaults and node configs. Evidence: `engine/config.ts:26-33` (YAML pass-through via structural typing; `WorkflowDefaults`/`NodeConfig` types carry `model?`)
  - [x] `agent.ts` `buildClaudeArgs()` emits `--model <value>` when model is set. Evidence: `engine/agent.ts:309-311`
  - [x] `agent.ts` does NOT emit `--model` on `--resume` invocations. Evidence: `engine/agent.ts:309` (`&& !opts.resumeSessionId` guard)
  - [x] Loop body nodes resolve model from: own config > loop node config > defaults. Evidence: `engine/loop.ts:76`
  - [x] `workflow.yaml` updated: default model + per-node overrides for complex stages. Evidence: `.flowai-workflow/workflow.yaml:15` (default), `.flowai-workflow/workflow.yaml:65,84,147` (overrides)
  - [x] All existing engine tests pass; new tests cover model flag emission and resolution. Evidence: `engine/agent_test.ts:207-233` (3 model tests); 434 tests pass.
  - [x] `deno task check` passes. Evidence: validated — 434 passed, 0 failed.

### 3.13 FR-E13 (ex FR-28): Accurate Dry-Run Output

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

### 3.14 FR-E14 (ex FR-29): Engine-Workflow Separation Invariant

- **Description:** The workflow engine (`engine/`) is a domain-agnostic DAG executor. It MUST be physically separated from workflow-specific concerns (config, agents, run artifacts) by directory structure, not only by convention. This constraint is structural and must be enforced by the project layout.
- **Rationale:** Issue #12 — collocating engine source with workflow data under `.flowai-workflow/` obscures boundaries, hinders tooling, and blocks future engine reuse.
- **Rules:**
  - Engine source lives in a dedicated top-level directory (e.g., `engine/` or a standardized path); no workflow, agent, git, or GitHub-specific logic inside.
  - Workflow config (`workflow.yaml`), agent prompts (`.claude/skills/`), and run artifacts (`runs/`) are domain-specific — must not be nested under the engine directory.
  - `deno.json` tasks and imports reference the new layout consistently.
- **Acceptance criteria:**
  - [x] Engine source directory contains only domain-agnostic DAG executor code. Evidence: `engine/git.ts` and `engine/git_test.ts` deleted; `engine/mod.ts` git exports removed; `engine/types.ts` `HitlConfig` fields renamed to domain-neutral names (`artifact_source`, `exclude_login`).
  - [ ] Engine source contains zero references to concrete artifact filenames (e.g., `failed-node.txt`) or concrete node names (e.g., `meta-agent`).
  - [ ] No `workflow.yaml`, agent skill files, or run artifacts reside inside the engine directory.
  - [ ] `deno task run` and `deno task test:engine` reference the new engine path.
  - [ ] `deno task check` passes after restructure.

### 3.15 FR-E15 (ex FR-30): Node Result Summary

- **Description:** After each agent node completes, the engine displays a
  one-line result summary in the terminal. Summary includes a multi-line
  extract of the agent result (up to 3 non-empty lines, total ≤400 chars,
  collapsed to a single line via ` | ` separator), cost, duration, and turn
  count. Provides at-a-glance workflow progress without requiring verbose mode.
- **Motivation:** Prior single-line truncation (`split("\n")[0].slice(0, 120)`)
  captured only the first line of result text, which is typically a generic
  header ("Done. Here's what I did:"). Substantive details — artifact paths,
  decisions, actions — appear in lines 2–5 (avg result: 626 chars, 6–15 lines).
- **Acceptance criteria:**
  - [x] `OutputManager.nodeResult(nodeId, output)` displays one-line summary.
    Evidence: `engine/output.ts` (`nodeResult()` method).
  - [ ] Result text extract: up to 3 non-empty lines from `output.result`, each
    truncated to 120 chars, joined with ` | ` separator, total excerpt ≤400
    chars. Empty lines skipped. Single-line results unchanged.
  - [ ] Format: `[HH:MM:SS] <nodeId>  RESULT: <excerpt> | cost=$X.XXXX | duration=Xs | turns=N`.
    (excerpt = collapsed multi-line extract; no literal newlines in output)
  - [x] Shown in default and verbose modes; suppressed in quiet mode.
    Evidence: `engine/output.ts` (`verbosity !== "quiet"` guard).
  - [x] Called for top-level agent nodes in `executeNode()` and for loop body
    nodes in `executeLoopNode()` `onNodeComplete` callback.
    Evidence: `engine/engine.ts` (two call sites).
  - [ ] `extractResultExcerpt(result: string): string` — pure function in
    `output.ts`: filters empty lines, takes first 3, truncates each to 120
    chars, joins with ` | `, trims total to 400 chars. Unit-testable without I/O.
  - [ ] `deno task check` passes.

### 3.16 FR-E16 (ex FR-31): Prompt Path Validation at Config Load

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

### 3.17 FR-E17 (ex FR-32): Aggregate Cost Data in state.json

- **Description:** Workflow engine persists per-node cost and workflow-level total
  cost in `state.json`, eliminating the need to read N+1 separate log files to
  build a cost summary. Per-node `cost_usd` is sourced from
  `ClaudeCliOutput.total_cost_usd`; top-level `total_cost_usd` is the sum across
  all completed nodes.
- **Motivation:** Dashboards and external tooling currently must open one log file
  per node to compute cost. A single `state.json` read is sufficient with this
  change.
- **Acceptance criteria:**
  - [x] `NodeState.cost_usd?: number` field written at node completion time.
    Evidence: `engine/types.ts` (`NodeState.cost_usd`), `engine/state.ts`
    (`markNodeCompleted()` optional `costUsd` param).
  - [x] `RunState.total_cost_usd?: number` is the sum of all `nodes[*].cost_usd`.
    Evidence: `engine/state.ts` (`updateRunCost()` / `recomputeTotalCost()`).
  - [x] Fields written alongside existing fields at node completion.
    Evidence: `engine/engine.ts` and `engine/loop.ts` — both pass
    `result.output?.total_cost_usd` to `markNodeCompleted()`.
  - [x] Loop iteration nodes also report cost.
    Evidence: `engine/loop.ts` loop body call site.
  - [x] Backward-compatible: fields are optional; existing state files without
    cost fields remain valid.
  - [x] Unit tests cover: cost present, cost absent, mixed multi-node, all-undefined.
    Evidence: `engine/state_test.ts`.

### 3.18 FR-E18 (ex FR-33): Stream Log Timestamps

- **Description:** Each non-empty line written to the stream log file
  (`.flowai-workflow/runs/<run-id>/logs/<node-id>.jsonl`) is prefixed with a wall-clock
  timestamp in `[HH:MM:SS]` format (24-hour, zero-padded). Empty lines pass
  through without prefix. Terminal output via `onOutput` callback is NOT
  prefixed — timestamps appear in persisted logs only.
- **Motivation:** Raw JSONL log files lack temporal context, making it hard to
  correlate log entries with real-world events during post-incident analysis.
- **Acceptance criteria:**
  - [x] Each non-empty line in the stream log file is prefixed with `[HH:MM:SS]`.
    Evidence: `engine/agent.ts:606-611` (`stampLines()`),
    `engine/agent_test.ts:400-407` (single-line test),
    `engine/agent_test.ts:409-424` (multi-line test).
  - [x] Timestamp reflects wall-clock time when the event was received (not batch time).
    Evidence: `engine/agent.ts:594-600` (`tsPrefix()` calls `new Date()` at call time),
    `engine/agent.ts:384,402` (`stampLines` called inside stream processing loop).
  - [x] Terminal output via `onOutput` callback is NOT prefixed with timestamps.
    Evidence: `engine/agent.ts:386,404` (`onOutput` receives raw `summary` without `stampLines`).
  - [x] Timestamp format is `[HH:MM:SS] <content>` (24-hour, zero-padded, space before content).
    Evidence: `engine/agent.ts:594-600` (format construction),
    `engine/agent_test.ts:391-398` (format regex test).
  - [x] Empty lines pass through to stream log without timestamp prefix.
    Evidence: `engine/agent.ts:609` (identity branch in `stampLines` map),
    `engine/agent_test.ts:426-442` (empty-line test).
  - [x] `deno task check` passes.

### 3.19 FR-E19 (ex FR-34): Generic Workflow Failure Hook (`on_failure_script`)

- **Description:** Engine supports a configurable `on_failure_script` field in `WorkflowDefaults` (YAML: `defaults.on_failure_script`). When the workflow fails, the engine executes the specified script via `Deno.Command`. Replaces the former hard-wired `rollbackUncommitted()` git call, which violated the domain-agnostic invariant (FR-E14).
- **Rationale:** Domain-specific failure recovery (e.g., git rollback) belongs in workflow scripts, not engine code. The engine provides a generic hook; the workflow wires it to the appropriate script.
- **Acceptance criteria:**
  - [x] `WorkflowDefaults` in `engine/types.ts` includes `on_failure_script?: string`. Evidence: `engine/types.ts:23` (`on_failure_script?: string`)
  - [x] Engine executes `on_failure_script` via `Deno.Command` on workflow failure (if configured). Evidence: `engine/engine.ts:171-175` (`runFailureHook` called when `!workflowSuccess`), `engine/engine.ts:808-831` (`runFailureHook` using `new Deno.Command(script, ...)`)
  - [x] Engine does NOT import or call any git functions on failure. Evidence: `engine/engine.ts` — no git imports; failure path uses generic `runFailureHook` only
  - [x] `.flowai-workflow/workflow.yaml` sets `on_failure_script: .flowai-workflow/scripts/rollback-uncommitted.sh`. Evidence: `.flowai-workflow/workflow.yaml:18` (`on_failure_script: .flowai-workflow/scripts/rollback-uncommitted.sh`)
  - [x] If script path not found: engine logs warning and continues (no hard failure). Evidence: `engine/engine.ts:828-829` (catch block logs warning, does not throw)
  - [x] Unit test covers `on_failure_script` execution path. Evidence: `engine/engine_test.ts:776-822` (4 `runFailureHook` tests: no-op, success, script failure, nonexistent script)
  - [x] `deno task check` passes. Evidence: 490 passed, 0 failed

### 3.20 FR-E20 (ex FR-39): Repeated File Read Warning

- **Description:** Stream log emits a `[WARN]` line when the same file path is read more than 2 times within one agent session (`executeClaudeProcess()` invocation). Warning includes the file path and read count. Informational only — does not block execution. Enables meta-agent to detect and diagnose repeated-read anti-patterns from log analysis.
- **Motivation:** Agents were silently re-reading the same file 3-4 times per session (run `20260313T025203`: PM agent read `documents/requirements-sdlc.md` 4 times consecutively), wasting tokens. The pattern was invisible to logging and prompt optimization tooling.
- **Implementation:** `FileReadTracker` class in `engine/agent.ts`. Instantiated per `executeClaudeProcess()` call (counters reset per invocation). In event loop: for `tool_use` blocks with `name === "Read"`, calls `tracker.track(block.input.file_path)`. Non-null result written to log via `stampLines()`. Terminal `onOutput` callback unchanged (log-file-only).
- **Warning format:** `[WARN] repeated file read: <path> (<N> times)`.
- **Acceptance criteria:**
  - [x] Stream log emits `[WARN] repeated file read: <path> (<N> times)` when same path is read >2 times in one session. Evidence: `engine/agent.ts:332` (`FileReadTracker` class), `engine/agent.ts:346` (`track()` method), commit `ebe7cb2`.
  - [x] Warning includes file path and read count. Evidence: `engine/agent.ts:346` (`FileReadTracker.track()` return value format).
  - [x] Warning is log-file-only — terminal `onOutput` callback unchanged. Evidence: `engine/agent.ts:410` (`tracker` used in `executeClaudeProcess()`, warning written via `stampLines()` to logFile only).
  - [x] Counter resets per `executeClaudeProcess()` invocation (not cross-continuation). Evidence: `engine/agent.ts:410` (`FileReadTracker` instantiated inside `executeClaudeProcess()`).
  - [x] Execution not blocked by warning. Evidence: `engine/agent.ts:346` (`track()` returns warning string; engine continues normally).
  - [x] `FileReadTracker` is a pure-logic class — unit-testable without I/O. Evidence: `engine/agent_test.ts:790-855` (FileReadTracker unit tests).
  - [x] `deno task check` passes. Evidence: QA PASS — all tests pass (run `20260314T060523`).

### 3.21 FR-E21 (ex FR-41): Semi-Verbose Output Mode (`-s`)

- **Description:** Workflow engine must support a `semi-verbose` verbosity level
  (`-s` CLI flag) that shows agent text output but suppresses tool-call lines
  (e.g., `Read`, `Write`, `Bash` invocations). Sits between `normal` (silent)
  and `verbose` (full tool output).
- **Motivation:** `verbose` mode is too noisy for monitoring (hundreds of tool
  lines per node). `normal` shows nothing. Operators need intermediate view:
  agent reasoning + results without tool-call noise.
- **Acceptance criteria:**
  - [x] `Verbosity` type includes `"semi-verbose"` value alongside `"quiet"`,
    `"normal"`, `"verbose"`. Evidence: `engine/types.ts` (`Verbosity` union).
  - [x] `-s` CLI flag maps to `semi-verbose` verbosity. Evidence: `engine/cli.ts`.
  - [x] In semi-verbose mode, `formatEventForOutput()` skips `tool_use` content
    blocks in `assistant` events — emits only `text` blocks. Evidence:
    `engine/agent.ts` (`formatEventForOutput()` with `verbosity` param).
  - [x] Log file writes are unaffected — full output preserved. Evidence:
    `engine/agent.ts` (log path calls `formatEventForOutput()` without verbosity).
  - [x] `nodeOutput()` gate shows in both `verbose` and `semi-verbose`. Evidence:
    `engine/output.ts` (`nodeOutput()` condition).
  - [x] `deno task check` passes. Evidence: design.md (FR-41 referenced as implemented).

### 3.22 FR-E22: Workflow Final Summary with Node Results

- **Description:** The workflow final summary block (printed after all nodes
  complete) must include per-node result text alongside existing metadata
  (Workflow name, Run ID, Status, Duration, Nodes count). Eliminates the need
  to scroll back through interleaved logs to find what each agent produced after
  a 30+ minute run.
- **Motivation:** Current `summary()` output (`engine/output.ts:98-111`) renders
  only aggregate metadata. Per-node result text is available in
  `.flowai-workflow/runs/<run-id>/logs/<node-id>.json` but not in `state.json`, forcing
  operators to read N log files after the run. Issue #109: "After a 30+ minute
  run, the operator has to scroll back through interleaved logs to find what
  each agent produced."
- **Acceptance criteria:**
  - [ ] `NodeState` in `types.ts` gains `result?: string` field — first 400
    chars of agent `ClaudeCliOutput.result` text, persisted to `state.json`
    at node completion.
  - [ ] `markNodeCompleted()` in `state.ts` accepts optional `result?: string`
    param; writes it to `NodeState.result` when provided.
  - [ ] Engine passes `result` text to `markNodeCompleted()` for all agent node
    completions (top-level nodes in `executeNode()` and loop body nodes in
    `executeLoopNode()` `onNodeComplete` callback).
  - [ ] `OutputManager.summary()` renders per-node result lines below the
    existing aggregate block. One line per completed agent node:
    `  <nodeId padded>  <excerpt>` where excerpt = `extractResultExcerpt()`
    output (FR-E15). Skips nodes with no result (merge, human, skipped nodes).
  - [ ] Node results section is shown in default and verbose modes; suppressed
    in quiet mode. Consistent with `nodeResult()` visibility guard.
  - [ ] `RunSummary` interface in `types.ts` gains
    `nodeResults?: Record<string, string>` — map from nodeId → result excerpt.
    Populated by engine before calling `printSummary()`.
  - [ ] Backward-compatible: existing `state.json` files without `result`
    fields remain valid; missing results render as absent (not error).
  - [ ] Unit tests cover: result present, result absent, quiet suppression,
    mixed node types (agent + merge).
  - [ ] `deno task check` passes.

### 3.23 FR-E23: CLI Help for `deno task check`

- **Description:** `scripts/check.ts` (`deno task check`) must respond to `--help` / `-h` with a usage synopsis describing what checks are run and exit 0. Unknown flags must produce an error message referencing `--help` and exit non-zero. Output format follows the pattern established by `engine/cli.ts`.
- **Motivation:** Users must read source code to discover what `deno task check` does and whether any options exist. No help text forces unnecessary source inspection.
- **Acceptance criteria:**
  - [ ] `--help` / `-h` prints usage synopsis (`<Tool name> — <description>`, `Usage:`, `Options:`, `Examples:`) and exits 0.
  - [ ] Usage text documents all checks performed (type-check, tests, lint, workflow integrity, secret detection) and any flags.
  - [ ] Unknown flags print an error message referencing `--help` and exit non-zero.
  - [ ] `deno task check` (no args) continues to run all checks unchanged (backward-compatible).
  - [ ] `deno task check` passes (self-check).

### 3.24 FR-E24: Worktree Isolation (replaces pre_run)

- **Description:** ~~Pre-run script (`pre_run`)~~ **Superseded.** Engine now
  creates a git worktree per run for execution isolation, eliminating destructive
  `git reset --hard`. Two-phase loading: (1) read raw YAML, extract
  `defaults.worktree_disabled`; (2) if not disabled, create worktree from
  `origin/main`; (3) load full config from worktree. All subprocesses, file I/O,
  and template `{{file()}}` resolution use the worktree path (`cwd`/`workDir`).
  On success, worktree removed; on failure, preserved for `--resume`. State
  copied to original repo before cleanup.
- **Motivation:** `pre_run` relied on destructive git operations that could lose
  work. Worktree isolation provides clean execution environment without modifying
  the original working tree.
- **Acceptance criteria:**
  - [x] `pre_run` field rejected with migration error at config validation. Evidence: `engine/config.ts:220-224`
  - [x] `extractWorktreeDisabled(yaml)` extracts `defaults.worktree_disabled` without full parsing. Evidence: `engine/config.ts:51-57`
  - [x] `worktree.ts` module: `createWorktree()`, `removeWorktree()`, `worktreeExists()`, `copyToOriginalRepo()`. Evidence: `engine/worktree.ts`
  - [x] Engine creates worktree for new runs, reuses existing for resume, skips when `worktree_disabled: true`. Evidence: `engine/engine.ts:120-136`
  - [x] `workPath()` utility centralizes workDir prefix logic. Evidence: `engine/state.ts:126-128`
  - [x] All subprocess-spawning functions accept `cwd` parameter (agent, claude-process, hitl, validate, scope-check, loop). Evidence: `engine/agent.ts`, `engine/claude-process.ts`, `engine/hitl.ts`, `engine/validate.ts`, `engine/scope-check.ts`, `engine/loop.ts`
  - [x] Template `interpolate()` and config `validateFileReferences()` accept `workDir` for `{{file()}}` resolution. Evidence: `engine/template.ts`, `engine/config.ts`
  - [x] Tests: worktree lifecycle, path computation, error handling, config validation. Evidence: `engine/worktree_test.ts`, `engine/config_test.ts`

### 3.25 FR-E25: Graceful Shutdown (Signal Handling)

- **Description:** Engine kills spawned child processes and releases resources on SIGINT/SIGTERM. Global process registry tracks long-running `Deno.ChildProcess` instances. On signal: SIGTERM all registered processes, wait up to 5s, SIGKILL survivors, run shutdown callbacks (lock release, state save), exit with 130 (SIGINT) or 143 (SIGTERM).
- **Motivation:** Without signal propagation, Ctrl+C leaves orphaned `claude` processes consuming resources and stale lock files blocking subsequent runs. Critical in Docker environments.
- **Acceptance criteria:**
  - [x] `process-registry.ts` singleton: `register()`, `unregister()`, `onShutdown()`, `killAll()`, `installSignalHandlers()`. Evidence: `engine/process-registry.ts:17-112`
  - [x] `onShutdown()` returns disposer function to prevent callback leak in loops. Evidence: `engine/process-registry.ts:28-34`
  - [x] `agent.ts:executeClaudeProcess()` registers/unregisters process in try/finally. Evidence: `engine/agent.ts:430-574`
  - [x] `cli.ts` calls `installSignalHandlers()` at startup. Evidence: `engine/cli.ts:139`
  - [x] `engine.ts` registers shutdown callbacks for lock release and state save after lock acquisition; disposes in finally. Evidence: `engine/engine.ts:139-153`
  - [x] `self_runner.ts` calls `Engine.run()` directly (no subprocess), `installSignalHandlers()` at startup. Evidence: `scripts/self_runner.ts:5-7,57-64,135`
  - [x] `loop_in_claude.ts` registers/unregisters claude child, `installSignalHandlers()` at startup. Evidence: `scripts/loop_in_claude.ts:7-11,80,100,106,152`
  - [x] 9 unit tests cover registry operations, killAll, shutdown callbacks, error resilience. Evidence: `engine/process-registry_test.ts`
  - [x] All 474 existing tests pass. Evidence: `deno task check` output

### 3.26 FR-E26: Engine Codebase Housekeeping

- **Description:** Engine source tree must remain free of dead code and stale documentation. Barrel export files with no runtime or test consumers must be removed. Pre-implementation research docs in `documents/rnd/` superseded by implemented FRs must be deleted or archived. Empty run artifact directories must not be tracked in version control.
- **Motivation:** `engine/mod.ts` is a barrel re-export not imported by runtime code or tests (only referenced as a type-check target in `deno task check`). Retaining it without a clear owner creates confusion about the engine's public API surface. `documents/rnd/human-in-the-loop.md` (18KB, Russian, 2026-03-11) predates the HITL implementation (FR-E8) and may be superseded by it. Empty `.flowai-workflow/runs/*/implementation` directories accumulate from loop iterations; `.gitignore` covers `.flowai-workflow/runs/` but stale tracked entries must be purged.
- **Acceptance criteria:**
  - [x] `engine/mod.ts` purpose documented via module-level JSDoc: barrel re-export for `deno doc --lint`. Evidence: `engine/mod.ts:1`
  - [x] `documents/rnd/human-in-the-loop.md` deleted — superseded by `engine/hitl.ts` + SDS §5 HITL documentation. Evidence: file removed from repo.
  - [x] Empty `.flowai-workflow/runs/*/implementation` directories are not git-tracked; `.gitignore` covers `runs/` directory.
  - [x] All existing engine tests pass after changes. Evidence: `deno task check` PASS

### 3.27 FR-E27: Test Suite Integrity

- **Description:** Every test function in `engine/` test files must contain ≥1 explicit assertion. Tests with no assertions pass trivially, provide zero coverage value, and mask implementation errors.
- **Motivation:** `engine/lock_test.ts:143` — test "releaseLock - no error if lock file already removed" contained no assertions, silently passing while verifying nothing.
- **Acceptance criteria:**
  - [ ] Test "releaseLock - no error if lock file already removed" in `engine/lock_test.ts` includes `assertEquals(await releaseLock(lockPath), undefined)`. Evidence: `engine/lock_test.ts:143`
  - [ ] All engine tests pass after change. Evidence: `deno task check` PASS

### 3.28 FR-E28: Shared Backoff Utility (`nextPause()`)

- **Description:** `nextPause()` function is duplicated in `scripts/self_runner.ts` and `scripts/loop_in_claude.ts`. Extract into a shared `scripts/backoff.ts` module to eliminate duplication.
- **Motivation:** DRY violation — backoff logic changes must be applied in multiple places; shared module ensures consistency.
- **Acceptance criteria:**
  - [ ] `scripts/backoff.ts` exists and exports `nextPause()`. Evidence: `scripts/backoff.ts`.
  - [ ] `scripts/self_runner.ts` imports `nextPause` from `scripts/backoff.ts`; no local `nextPause` definition remains. Evidence: `scripts/self_runner.ts`.
  - [ ] `scripts/loop_in_claude.ts` imports `nextPause` from `scripts/backoff.ts`; no local `nextPause` definition remains. Evidence: `scripts/loop_in_claude.ts`.
  - [ ] All tests pass. Evidence: `deno task check` PASS.

### 3.29 FR-E29: Legacy Test Task Removal

- **Description:** `deno.json` contains legacy test tasks (`test:pm`, `test:tech-lead`, etc.) referencing obsolete `.flowai-workflow/scripts/stage-*_test.ts` files superseded by the engine test suite. These tasks must be removed to keep the task list accurate.
- **Motivation:** Stale tasks reference non-existent or inactive test files, pollute `deno task` output, and create false confidence that stage-level tests are running.
- **Acceptance criteria:**
  - [x] All `test:*` tasks in `deno.json` referencing `.flowai-workflow/scripts/stage-*_test.ts` paths are identified. Evidence: `deno.json` — no such tasks exist; active test tasks are `test`, `test:lib`, `test:engine` only.
  - [x] All identified obsolete tasks are removed from `deno.json`. Evidence: `deno.json:6-18` — no `.flowai-workflow/scripts/stage-*_test.ts` references present.
  - [x] All remaining active tests pass. Evidence: `deno task check` PASS (run 20260315T155429).

### 3.30 FR-E30: Workflow Prepare Command (`prepare_command`)

- **Description:** `WorkflowDefaults` supports optional `prepare_command` (string). Executed as a shell command once, after config validation and run directory creation, before any node starts. Skipped on `--resume`. Failure (non-zero exit) is fatal: workflow aborts immediately. Supports template interpolation: `{{run_dir}}`, `{{run_id}}`, `{{env.*}}`, `{{args.*}}`. Completes the hook lifecycle: worktree creation → config load → `prepare_command` (pre-node) → node execution → `on_failure_script` (post-failure).
- **Motivation:** Workflow-level environment preparation (e.g., repo reset to clean state) belongs before node execution, not inside a node's `before` hook. Node hooks are unreliable for env prep: with `--skip`, `--only`, or `--resume`, the first node may be bypassed, leaving the environment unprepared.
- **Acceptance criteria:**
  - [ ] `WorkflowDefaults.prepare_command` is an optional string field; validated at config load. Evidence: `engine/types.ts`
  - [ ] Executed once after config validation and run-dir creation, before first node starts. Evidence: `engine/engine.ts`
  - [ ] Skipped when `--resume` flag is active. Evidence: `engine/engine.ts`
  - [ ] Non-zero exit aborts workflow immediately with clear error message. Evidence: `engine/engine.ts`
  - [ ] Template variables `{{run_dir}}`, `{{run_id}}`, `{{env.*}}`, `{{args.*}}` interpolated before execution. Evidence: `engine/engine.ts`
  - [ ] Logged at normal verbosity level. Evidence: `engine/engine.ts`
  - [ ] Unit tests cover: execution on fresh run, skip on resume, failure abort, template interpolation. Evidence: `engine/engine_test.ts`

### 3.31 FR-E31: Stale Path Reference Cleanup in Engine Artifacts

- **Description:** Engine documentation and test fixtures must be free of deprecated `.flowai-workflow/` path references and hardcoded `.flowai-workflow/agents/agent-*` paths. Physical migration to `.flowai-workflow/` completed in #111; ~30 stale `.flowai-workflow/` refs remain in `requirements-engine.md` evidence fields, ~12 in `design-engine.md`, and engine test fixtures reference `.flowai-workflow/agents/agent-*` paths.
- **Motivation:** Stale path references in evidence fields cause navigation failures (paths no longer exist), undermine documentation trustworthiness, and create onboarding confusion. Test fixtures with hardcoded `.flowai-workflow/agents/agent-*` paths are brittle if symlinks change.
- **Acceptance criteria:**
  - [ ] Zero `.flowai-workflow/` path references in `documents/requirements-engine.md`. Evidence: grep result = 0.
  - [ ] Zero `.flowai-workflow/` path references in `documents/design-engine.md`. Evidence: grep result = 0.
  - [ ] Zero `.flowai-workflow/agents/agent-*` hardcoded path references in `documents/requirements-engine.md`. Evidence: grep result = 0.
  - [ ] Engine test fixtures (`engine/hitl_test.ts`, `engine/agent_test.ts`, `engine/config_test.ts`, `engine/workflow_integrity_test.ts`) use `.flowai-workflow/agents/` paths only. Evidence: file contents.
  - [ ] `deno task check` passes. Evidence: `deno task check` exit 0.

### 3.32 FR-E32: `{{file()}}` Template Function

- **Description:** Template engine (`engine/template.ts`) supports `{{file("path/to/file.md")}}` function syntax. Reads named file content and inserts it inline at the call site. Paths resolved relative to repo root. Inserted content NOT re-interpolated (prevents recursion, ensures predictable behavior). Fail-fast: throws descriptive error if file not found.
- **Motivation:** Two separate mechanisms for file content injection (`prompt` field via `--system-prompt-file`; `task_template` via `{{variable}}` substitution) prevent composition of shared instructions across nodes without duplication. `{{file()}}` unifies inline file injection into the existing template system.
- **Acceptance criteria:**
  - [ ] `{{file("path")}}` resolves path relative to repo root and inserts file content inline. Evidence: `engine/template.ts`
  - [ ] Inserted content is NOT re-interpolated (no nested `{{...}}` processing of included text). Evidence: `engine/template.ts`
  - [ ] Missing file throws a fail-fast error with the missing path in the message. Evidence: `engine/template.ts`
  - [ ] `deno task check` validates `{{file()}}` references at load time by executing real file reads (not stub substitution). Evidence: `engine/config.ts`
  - [ ] Validation error identifies the missing file path for quick diagnosis. Evidence: `engine/config.ts`
  - [ ] Size warning emitted when included file content exceeds a threshold. Evidence: `engine/template.ts`
  - [ ] Unit tests: successful inclusion, missing file error, no re-interpolation of included content. Evidence: `engine/template_test.ts`
  - [ ] Config check tests: `deno task check` catches missing `{{file()}}` path in `task_template`. Evidence: `engine/config_test.ts`

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
    `engine/config.ts:273-289`.
  - [x] Error message identifies body node ID, loop node ID, and all missing
    external input IDs. Evidence: `engine/config.ts:284-288` — message:
    `"Loop '${id}' body node '${bodyId}' references external input(s) [${missing.join(", ")}] not listed in loop inputs"`.
  - [x] Body node referencing a sibling body node generates no error (intra-body
    refs are valid). Evidence: `engine/config.ts:279-280`
    (`!bodyNodeIds.includes(inp)` guard); `engine/config_test.ts:235-262`.
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
    `engine/config.ts:291-312`.
  - [x] Parse-time: if condition node has no `validate` block, skip check (no contract to
    enforce). Evidence: `engine/config.ts:300`
    (`if (Array.isArray(condNodeRaw.validate) && condNodeRaw.validate.length > 0)`).
  - [x] Parse-time error message identifies loop ID, field, and condition node. Evidence:
    `engine/config.ts:308-310` — message:
    `"Loop '${id}' condition_field '${node.condition_field}' is not declared as a frontmatter_field in condition node '${node.condition_node}' validate block"`.
  - [x] Runtime: `extractConditionValue()` throws descriptive error when field absent.
    Evidence: `engine/loop.ts:224-226` — message:
    `"Loop '${loopId}': condition_field '${field}' not found in condition node '${condNodeId}' output at '${nodeDir}'"`.
  - [x] Runtime: `loopId` and `condNodeId` threaded through `extractConditionValue()`
    signature (updated from 3 to 5 params); `runLoop()` passes them. Evidence:
    `engine/loop.ts:192-198` (signature), `engine/loop.ts:144-151` (call site).
  - [x] Parse-time tests (2): missing rule → throws (`engine/config_test.ts:1139-1173`),
    present rule → passes (`engine/config_test.ts:1175-1206`).
  - [x] Runtime tests (3): throws when field absent in output file
    (`engine/loop_test.ts:281-317`), throws when output dir empty
    (`engine/loop_test.ts:319-351`), returns value when field present
    (`engine/loop_test.ts:353-378`).
  - [x] `deno task check` green: 533 tests, 0 failures. Evidence: run `20260319T221833`.

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

### 3.39 FR-E39: Standalone Binary Distribution

- **Description:** The engine compiles to standalone platform binaries via `deno compile`,
  bundling all dependencies (including `npm:yaml`). A CI/CD release workflow triggers on
  version tags (`v*`), cross-compiles binaries for 4 targets using a single `ubuntu-latest`
  runner, and publishes them as GitHub Release assets. The `VERSION` env var is embedded at
  compile time; leading `v` prefix is stripped before embedding (e.g., tag `v1.2.3` embeds
  as `1.2.3`).
- **Motivation:** Lowers adoption barrier — users run `flowai-workflow --config <path>` without
  installing Deno, eliminating runtime dependency friction.
- **Acceptance criteria:**
  - [x] AC1: Standalone binary produced by `deno compile --allow-all engine/cli.ts` with
    all deps bundled. Evidence: `scripts/compile.ts`.
  - [x] AC2: Cross-platform builds for linux-x86_64, linux-arm64, darwin-x86_64,
    darwin-arm64. Evidence: `scripts/compile.ts:TARGETS` (4 entries);
    `scripts/compile_test.ts` (4 target name tests).
  - [x] AC3: Version-tag-triggered CI release workflow.
    Evidence: `.github/workflows/release.yml:4-6` (on push tags `v*`).
  - [x] AC4: Binary naming convention `flowai-workflow-<os>-<arch>`
    (e.g., `flowai-workflow-linux-x86_64`). Evidence: `scripts/compile.ts:TARGETS`;
    `scripts/compile_test.ts` (naming convention test).
  - [x] AC5: README installation docs with binary download instructions.
    Evidence: `README.md` §Installation.
  - [x] AC6: Config-only CLI entry: `flowai-workflow --config <path>`. No Deno runtime required.
    Evidence: `engine/cli.ts:parseArgs` (`--config` flag); `deno compile` bundles all deps.
  - [x] AC7: VERSION embedded at compile time; `v` prefix stripped to avoid double-v output.
    Evidence: `scripts/compile.ts:stripVersionPrefix`; `engine/cli.ts:getVersionString`.
  - [x] `deno task check` green: 587 tests, 0 failures. Evidence: run `20260320T223114` iter 2.

### 3.40 FR-E40: Permission Mode Configuration

- **Description:** First-class `permission_mode` field in `WorkflowDefaults` and
  `NodeConfig` that maps to Claude Code's `--permission-mode` CLI flag. Replaces
  raw `--dangerously-skip-permissions` in `claude_args`. Supported values:
  `acceptEdits`, `bypassPermissions`, `default`, `dontAsk`, `plan`, `auto`.
  Per-node override cascades: node → defaults → omit. Config validation rejects
  invalid values and detects conflicts with permission-related flags in
  `claude_args`.
- **Motivation:** Declarative, type-safe permission control. Eliminates raw CLI
  arg strings, enables per-node granularity, validates at config load time.
- **Acceptance criteria:**
  - [x] AC1: `PermissionMode` type and `permission_mode` field on
    `WorkflowDefaults` + `NodeConfig`. Evidence: `engine/types.ts:9-24,55,90`.
  - [x] AC2: `buildClaudeArgs()` emits `--permission-mode <value>` when set.
    Evidence: `engine/claude-process.ts:88-90`.
  - [x] AC3: Config validation rejects invalid values. Evidence:
    `engine/config.ts:138-149`; `engine/config_test.ts` (invalid mode tests).
  - [x] AC4: Conflict detection: error if `claude_args` contains
    `--dangerously-skip-permissions` or `--permission-mode` AND
    `permission_mode` field is also set. Evidence: `engine/config.ts:150-162`;
    `engine/config_test.ts` (conflict tests).
  - [x] AC5: Per-node override resolution (node → defaults → omit) in
    `node-dispatch.ts` and `loop.ts`. Evidence: `engine/node-dispatch.ts:54`,
    `engine/loop.ts:93-94`.
  - [x] AC6: `deno task check` green: 590 tests, 0 failures.

### 3.41 FR-E41: CLI Auto-Update and Automated Release Pipeline

- **Description:** CLI binary checks GitHub Releases API for newer versions and
  can self-update by downloading the matching platform binary. Automated CI
  pipeline on `main` push detects releasable conventional commits, bumps version
  via `standard-version`, tags, and triggers the release workflow. Version source
  of truth: `deno.json` `version` field. Update check is fail-open (network
  errors never block CLI). `GITHUB_TOKEN` env var used for authenticated API
  requests when available.
- **Motivation:** Eliminates manual version management and release process.
  Users get update notifications and one-command self-update.
- **Acceptance criteria:**
  - [x] AC1: `deno.json` has `version` field. Evidence: `deno.json:2`.
  - [x] AC2: `engine/update.ts` — `checkForUpdate()` queries GitHub Releases
    API, compares semver, returns update info or null. Evidence:
    `engine/update.ts:77-123`.
  - [x] AC3: `engine/update.ts` — `runUpdate()` downloads binary to same dir,
    chmod +x, atomic rename. Permission check with sudo hint. Evidence:
    `engine/update.ts:133-180`.
  - [x] AC4: `--version` flag checks for updates (unless `--skip-update-check`).
    Evidence: `engine/cli.ts:136-148`.
  - [x] AC5: `--update` flag performs self-update. Evidence:
    `engine/cli.ts:150-166`.
  - [x] AC6: `.versionrc.json` configures `standard-version` for conventional
    commit bumping. Evidence: `.versionrc.json`.
  - [x] AC7: `.github/workflows/ci.yml` auto-detects releasable commits on
    `main` push, bumps version, tags. Evidence: `.github/workflows/ci.yml:37-68`.
  - [x] AC8: `.github/workflows/release.yml` generates release notes via
    `scripts/generate-release-notes.ts`. Evidence:
    `.github/workflows/release.yml:62-73`.
  - [x] AC9: 22 tests for update module. Evidence: `engine/update_test.ts`.
  - [x] AC10: `deno task check` green: 612 tests, 0 failures.

### 3.42 FR-E42: Per-Node Effort Level (`effort`)

- **Description:** Optional `effort` field on `WorkflowDefaults` and `NodeConfig`
  that maps to Claude Code's `--effort` CLI flag. Controls reasoning depth per
  invocation. Supported values: `low`, `medium`, `high`, `max`. Per-node
  override cascades: node → defaults → omit (CLI default). Skipped on
  `--resume` (session inherits original effort level).
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
  - On fresh invocation: if `effort` resolved (node-level or default), append
    `--effort <value>` to Claude CLI args.
  - On `--resume`: do NOT emit `--effort`. Session inherits from original
    invocation (same pattern as `--model`, FR-E12).
  - Loop body nodes: inherit loop node's `effort` unless overridden in inline
    `nodes` config.
- **Acceptance criteria:**
  - [ ] AC1: `WorkflowDefaults` in `types.ts` has `effort?: string` field.
  - [ ] AC2: `NodeConfig` in `types.ts` has `effort?: string` field.
  - [ ] AC3: Config validation rejects invalid values (must be one of `low`,
    `medium`, `high`, `max`). Error message identifies node ID and invalid
    value.
  - [ ] AC4: `buildClaudeArgs()` emits `--effort <value>` when set AND
    `resumeSessionId` is NOT set.
  - [ ] AC5: Per-node override resolution (node → defaults → omit) in
    `node-dispatch.ts` and `loop.ts`. Same pattern as `model` (FR-E12).
  - [ ] AC6: Loop body nodes inherit effort from enclosing loop node unless
    overridden.
  - [ ] AC7: Unit tests: flag emission, skip on resume, invalid value
    rejection, cascade resolution.
  - [ ] AC8: `deno task check` passes.

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

## 4. Non-Functional Requirements

- **Isolation:** Each agent runs in its own Claude Code process with no shared state except file artifacts. Single local execution assumed (one workflow at a time). Concurrent execution is not supported.
- **Fault tolerance:** If a node fails (agent error, timeout, continuation limit exhausted), the workflow stops. Post-workflow nodes with `run_on` config execute based on outcome. Manual restart via `--resume <run-id>`.
- **Timeouts:** Each node has a configurable timeout (default: 30 min). Engine enforces timeout per node. On timeout, node is treated as failed.
- **Observability:** 3 verbosity levels (`-q`/default/`-v`/`-s`); status lines with timestamps; per-node result summaries; full logs stored per node in `<run-dir>/logs/`.
- **Domain-agnostic:** Engine MUST NOT contain git, GitHub, branch, PR, or any domain-specific logic. All domain workflows implemented via agent nodes wired in workflow YAML configs.
- **Workflow-independent:** Engine MUST NOT depend on any specific workflow config. One engine, many workflows. No references to concrete node names, artifact filenames, or workflow structure.

## 5. Interfaces

- **CLI entry:** `deno task run [--prompt "..."]`. Flags: `--resume <run-id>`, `--dry-run`, `-v` (verbose), `-q` (quiet), `-s` (semi-verbose), `--config <path>`, `--skip <node>`, `--only <node>`, `--env <K=V>`, `--update`, `--skip-update-check`.
- **Agent runtime:** `claude` CLI invoked by engine. Key flags:
  - `--system-prompt` — role-specific instructions inline (content cached from prompt file at startup). Replaces Claude Code base system prompt. Fallback: `--system-prompt-file` for template-path prompts.
  - `--output-format stream-json` — streams JSON events; `result` event contains `result`, `session_id`, `total_cost_usd`, `duration_ms`, `num_turns`, `is_error`.
  - `--resume <session-id>` — re-invokes agent in same session for continuations (FR-E1).
  - `-p "<prompt>"` — non-interactive mode.
  - `--model <model>` — per-node model override (FR-E12).
  - `--effort <level>` — reasoning depth: `low`|`medium`|`high`|`max` (FR-E42).
  - `--fallback-model <model>` — auto-fallback on primary model overload (FR-E43, `-p` only).
  - `--permission-mode <mode>` — permission mode override (FR-E40).
- **Config format:** YAML workflow config with `defaults` (global settings) and `nodes` (DAG definition). Node types: `agent`, `loop`, `merge`, `human`. Fields per type: `prompt`, `inputs`, `validate`, `model`, `effort`, `run_on`, `after`/`before` hooks.
- **State:** `<run-dir>/state.json` — node statuses (`pending`/`running`/`completed`/`failed`/`waiting`/`skipped`), session IDs, cost data, timing, HITL question JSON.
- **Template variables:** `{{input.<node-id>}}` (node output dir), `{{node_dir}}` (current node output dir), `{{run_dir}}` (run root), `{{run_id}}`, `{{loop.iteration}}` (loop body only), `{{env.<KEY>}}`, `{{file("path")}}` (inline file content, path relative to repo root; FR-E32).

## Appendix: FR Cross-Reference

| Old ID | New ID | Title |
|--------|--------|-------|
| FR-8   | FR-E1  | Continuation Mechanism |
| FR-10  | FR-E2  | Agent Log Storage |
| FR-13  | FR-E3  | Artifact Versioning |
| FR-15  | FR-E4  | Configuration |
| FR-17  | FR-E5  | Project Directory Structure |
| FR-18  | FR-E6  | Verbose Output (`-v`) |
| FR-20  | FR-E7  | Workflow Config Drift Detection |
| FR-21  | FR-E8  | Human-in-the-Loop (Agent-Initiated) |
| FR-23  | FR-E9  | Run Artifacts Folder Structure |
| FR-24  | FR-E10 | Loop Body Node Nesting |
| FR-25  | FR-E11 | Conditional Post-Workflow Node Execution (`run_on`) |
| FR-27  | FR-E12 | Per-Node Model Configuration |
| FR-28  | FR-E13 | Accurate Dry-Run Output |
| FR-29  | FR-E14 | Engine-Workflow Separation Invariant |
| FR-30  | FR-E15 | Node Result Summary |
| FR-31  | FR-E16 | Prompt Path Validation at Config Load |
| FR-32  | FR-E17 | Aggregate Cost Data in state.json |
| FR-33  | FR-E18 | Stream Log Timestamps |
| FR-34  | FR-E19 | Generic Workflow Failure Hook (`on_failure_script`) |
| FR-39  | FR-E20 | Repeated File Read Warning |
| FR-41  | FR-E21 | Semi-Verbose Output Mode (`-s`) |
| —      | FR-E22 | Workflow Final Summary with Node Results |
| —      | FR-E23 | CLI Help for `deno task check` |
| —      | FR-E24 | Worktree Isolation (replaces pre_run) |
| —      | FR-E25 | Graceful Shutdown (Signal Handling) |
| —      | FR-E26 | Engine Codebase Housekeeping |
| —      | FR-E27 | Test Suite Integrity |
| —      | FR-E28 | Shared Backoff Utility (`nextPause()`) |
| —      | FR-E29 | Legacy Test Task Removal |
| —      | FR-E30 | Workflow Prepare Command (`prepare_command`) |
| —      | FR-E31 | Stale Path Reference Cleanup in Engine Artifacts |
| —      | FR-E32 | `{{file()}}` Template Function |
| —      | FR-E33 | Phase Assignment Single-Mechanism Enforcement |
| —      | FR-E34 | Error Handling Precedence (`on_error` vs `on_failure_script`) |
| —      | FR-E35 | Loop Input Forwarding Validation |
| —      | FR-E36 | Loop Condition Field Validation |
| —      | FR-E37 | Scope-Based File Modification Detection |
| —      | FR-E38 | Artifact Rule Frontmatter Field Presence Checks |
| —      | FR-E39 | Standalone Binary Distribution |
| —      | FR-E40 | Permission Mode Configuration |
| —      | FR-E41 | CLI Auto-Update and Automated Release Pipeline |
| —      | FR-E42 | Per-Node Effort Level (`effort`) |
| —      | FR-E43 | Fallback Model (`fallback_model`) |
