# SRS: Engine

## 0. Resolved Design Decisions

- **Cost limits:** Not tracked. No budget constraints.
- **Rollback:** Manual operation (no automated rollback).
- **Retry logic:** 3 attempts with exponential backoff for external API calls (`claude`, `gh`) in `lib.sh`.
- **Target project:** Engine is domain-agnostic; no project-specific logic. Pipeline configs define domain workflows.
- **Concurrent pipelines:** Single local execution assumed. No concurrent locking.

## 1. Introduction

- **Document purpose:** Define the specification for the domain-agnostic DAG executor engine that orchestrates AI agent workflows.
- **Scope:** A locally-run Deno/TypeScript engine that reads YAML pipeline configs, resolves node dependencies via topological sort, executes nodes sequentially (agent, loop, merge, human types), manages validation/continuation, and persists run state. Entry: `deno task run [--prompt "..."]`.
- **Audience:** Engine developers, pipeline authors.
- **Definitions and abbreviations:**
  - **Node:** A single unit in the DAG pipeline (agent, loop, merge, or human type).
  - **Agent:** An isolated Claude Code CLI invocation with a dedicated system prompt.
  - **Continuation:** Re-invoking an agent within the same session (via `--resume`) to fix issues detected by validation (see FR-E1).
  - **HITL:** Human-in-the-loop — agent-initiated request for human input.
  - **DAG:** Directed acyclic graph defining node execution order.

## 2. General Description

- **System context:** Operates as a local Deno engine process triggered by CLI command (`deno task run [--prompt "..."]`). Reads pipeline DAG config (YAML), executes nodes sequentially via `claude` CLI, validates outputs, manages continuations and resume. Domain-agnostic: no git, GitHub, or SDLC logic in engine code.
- **Assumptions and constraints:**
  - Each agent is stateless between runs — all context comes from input artifacts and its system prompt.
  - Engine is pipeline-independent: MUST NOT depend on any specific pipeline config. One engine, many pipelines.
  - Engine MUST NOT contain references to concrete artifact filenames, node names, or domain-specific logic.

## 3. Functional Requirements

### 3.1 FR-E1 (ex FR-8): Continuation Mechanism

- **Description:** Each stage script wraps the Claude Code CLI invocation and validates the agent's output before considering the stage complete. If validation fails, the script re-invokes the agent in the same session using `--resume` with a description of the problem, giving the agent a chance to fix its output without starting from scratch.
- **Acceptance criteria:**
  - **Stage script responsibilities (engine path — `engine/`):**
    1. [x] Invoke `claude` CLI with the stage prompt and input artifacts. Evidence: `engine/agent.ts:208-230` (`buildClaudeArgs`), `engine/agent.ts:75-117` (invocation loop)
    2. After the agent exits, run stage-specific validation checks:
       - [x] **For Developer stage:** run `deno task check` via `custom_script` validation rule. If it fails, continuation is triggered. Evidence: `engine/validate.ts:49-50,127-162` (`checkCustomScript()`), `.sdlc/pipeline.yaml` (developer node `custom_script` config)
       - [x] **For QA stage:** (1) verify `05-qa-report-N.md` exists and is non-empty, (2) extract verdict via frontmatter parsing, (3) if verdict is not exactly `PASS` or `FAIL` — treat as validation failure, trigger continuation on QA agent. Evidence: `engine/validate.ts:51-52,164-228` (`checkFrontmatterField()`), `engine/validate_test.ts:225-351` (6 tests)
       - [x] **For all stages:** verify the expected output artifact exists and is non-empty. Evidence: `engine/validate.ts:60-88` (`file_exists`, `file_not_empty` rules), `.sdlc/pipeline.yaml` (per-node `validate` config)
    3. [x] If validation fails: re-invoke `claude --resume <session-id>` with the validation error output appended as context. Evidence: `engine/agent.ts:94-116` (resume prompt construction + `invokeClaudeCli` with `resumeSessionId`)
    4. [x] Repeat until validation passes or the continuation limit is reached. Evidence: `engine/agent.ts:75-91` (loop with `continuations < settings.max_continuations`)
  - **Continuation limits:**
    - [x] Maximum continuations per stage: configurable (default 3). Evidence: `.sdlc/pipeline.yaml:9` (`max_continuations: 3`), `engine/agent.ts:82-91`
    - [x] If limit reached: stage is marked as failed, pipeline stops, Meta-Agent is triggered (FR-11, FR-E11). Evidence: `engine/engine.ts:96-109,613-619` (`collectRunOnNodes()`), `engine/types.ts:56-57` (`run_on` field), `engine/agent.ts:110-120` (continuation limit check)
  - **Session persistence:**
    - [x] The `--resume` flag ensures the agent retains full conversation context from the initial invocation. Evidence: `engine/agent.ts:208-230` (`--resume` flag in `buildClaudeArgs`)
    - [x] Each continuation adds only the validation error to the context, not the full prompt. Evidence: `engine/agent.ts:94-97` (resume prompt = failures only)
  - **Secret detection (moved to `deno task check`):**
    - [x] `gitleaks detect --no-git` runs as part of `scripts/check.ts` (after lint, before tests). `allowFailure=true` — skips if gitleaks binary not found. Evidence: `scripts/check.ts:87`
    - Scope check (`allowed_paths`) and engine-level `safetyCheckDiff()` removed. Rationale: engine no longer commits per-node; scope enforcement via agent prompts and QA validation.
    - [ ] Future: simplified safety checks via `git diff` + file hash comparison
  - **Stage script responsibilities (legacy path — `.sdlc/scripts/`):**
    - [x] Legacy shell implementation in `lib.sh`: `continuation_loop()`, `safety_check_diff()`, `run_agent()`, `retry_with_backoff()`. Evidence: `.sdlc/scripts/lib.sh:59-233`
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
    - `.sdlc/pipeline/<issue-number>/logs/stage-<N>-<role>.json` — the JSON output from `claude` CLI (metadata: cost, duration, session ID, result).
    - `.sdlc/pipeline/<issue-number>/logs/stage-<N>-<role>.jsonl` — copy of the JSONL transcript from `~/.claude/projects/` for the session.
  - Logs are committed to the feature branch after each stage.
  - Stage script locates the JSONL transcript by session ID extracted from the JSON output.
- **Acceptance criteria (Deno engine path):**
  - [x] After each non-loop agent node completes successfully, the engine saves two files to `.sdlc/runs/<run-id>/logs/`:
    - `<node-id>.json` — full `ClaudeCliOutput` JSON object (`result`, `session_id`, `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `is_error`).
    - `<node-id>.jsonl` — copy of the JSONL session transcript from `~/.claude/projects/<project-hash>/`, located by matching `session_id` in filenames.
    - Evidence: `engine/engine.ts:266-270`, `engine/log.ts:18-47`
  - [x] If the JSONL transcript file is not found: engine logs a warning and continues — pipeline does NOT fail. Evidence: `engine/log.ts:43-45`
  - [x] Loop body nodes (developer, qa) must have logs saved after each iteration. Log files use iteration-qualified names: `<node-id>-iter-<N>.json` and `<node-id>-iter-<N>.jsonl`. `runLoop()` calls `saveAgentLog()` for each body node after successful completion. Evidence: `engine/engine.ts:574-582` (onNodeComplete callback in executeLoopNode saves logs using `${id}-iter-${iteration}` node ID)
  - [x] `LoopResult` includes per-iteration `AgentResult` references (with `ClaudeCliOutput`) to enable log extraction by the engine. Evidence: `engine/loop.ts:18-26` (`LoopResult.bodyResults: AgentResult[]`), `engine/loop.ts:69,99` (initialized, pushed per body node per iteration)
  - [x] Log-saving logic has unit tests covering: successful save, JSONL-not-found warning path. Evidence: `engine/log_test.ts:29-124` (5 tests)

### 3.3 FR-E3 (ex FR-13): Artifact Versioning

- **Description:** Defines how pipeline artifacts are managed on repeated runs for the same issue.
- **Acceptance criteria:**
  - On re-run, artifacts in `.sdlc/pipeline/<issue-number>/` are overwritten.
  - Previous versions are preserved in git history of the feature branch.
  - QA reports use iteration suffix (`05-qa-report-1.md`, `05-qa-report-2.md`) within a single run; on re-run, iteration numbering restarts from 1.
  - Log files are overwritten on re-run (previous logs preserved in git history).

### 3.4 FR-E4 (ex FR-15): Configuration

- **Description:** Pipeline configuration via environment variables and `pipeline.yaml`. Env vars override YAML defaults.
- **Variables:**
  - `SDLC_MAX_CONTINUATIONS` — maximum continuations per stage (default: `3`).
  - `SDLC_MAX_QA_ITERATIONS` — maximum Developer+QA loop iterations (default: `3`).
  - `SDLC_STAGE_TIMEOUT_MINUTES` — default timeout per stage in minutes (default: `30`).
- **Acceptance criteria:**
  - All variables have sensible defaults in `lib.sh` (legacy) and engine config (`engine/config.ts`).
  - Engine and stage scripts read configuration from environment, falling back to defaults.

### 3.5 FR-E5 (ex FR-17): Project Directory Structure

- **Description:** Project directory layout must reflect application structure, not be buried under a single `.sdlc/` prefix. Engine code, agent prompts, pipeline config, and run artifacts should be organized at the top level as distinct concerns.
- **Motivation:** Current `.sdlc/` prefix conflates engine source code, configuration, runtime data, and legacy scripts. This hinders navigation, IDE support, and standard tooling (test runners, linters).
- **Acceptance criteria:**
  - [x] Engine source code lives under a standard `src/` or dedicated top-level directory (not `.sdlc/engine/`). Evidence: `engine/` (top-level directory, 30 files moved via `git mv .sdlc/engine/ engine/`)
  - ~~`[ ] Agent prompts in a top-level agents/ directory`~~ — superseded by FR-36/FR-19: canonical location is `.claude/skills/agent-<name>/`.
  - [x] Pipeline config path configurable via `--config <path>` flag (default: `.sdlc/pipeline.yaml`). Engine is config-path-agnostic — no hardcoded root assumption. Evidence: `engine/cli.ts:7,37` (`--config` flag definition and handling), `engine/config.ts:37` (`loadConfig(path)` accepts any path)
  - [x] Run artifacts in gitignored `.sdlc/runs/` directory; `.gitignore` updated. Evidence: `.gitignore:3` (`.sdlc/runs/` entry)
  - ~~`[ ] Legacy shell scripts in a scripts/ directory (not .sdlc/scripts/)`~~ — SDLC pipeline convention, not engine constraint. Legacy scripts remain at `.sdlc/scripts/` (SDLC scope, outside engine boundary).
  - [x] `deno.json` tasks (`run`, `check`, `test`) updated to reference `engine/cli.ts` and `scripts/`. Evidence: `deno.json:7,19` (`check`, `run` tasks referencing `engine/cli.ts`)
  - [x] All existing engine tests pass after restructuring. Evidence: `deno task check` passes.
  - [x] SDS (`documents/design-engine.md`) updated to reflect implemented layout. Evidence: `documents/design-engine.md` §3.1 (engine modules), §3.2 (Phase Registry — IMPLEMENTED with evidence)

### 3.6 FR-E6 (ex FR-18): Verbose Output (`-v`)

- **Description:** With `-v` flag, engine output must provide full transparency into what is happening at every step — not just node start/stop, but the reasoning context: what input is being passed, what prompt is constructed, what validation is run, what the result is.
- **Motivation:** Current verbose mode shows only lifecycle events (started/completed/failed). Debugging pipeline issues or understanding agent behavior requires reading log files after the fact.
- **Acceptance criteria:**
  - [x] `-v` shows the full task prompt text sent to each agent (after template interpolation). Evidence: `engine/output.ts:109-114` (`verbosePrompt()`), `engine/agent.ts:67-69`
  - [x] `-v` shows the list of input artifacts resolved for each node (file paths + sizes). Evidence: `engine/output.ts:117-123` (`verboseInputs()`), `engine/engine.ts:280`
  - [x] `-v` shows validation rule execution: which rules ran, pass/fail per rule, failure details. Evidence: `engine/output.ts:126-137` (`verboseValidation()`), `engine/agent.ts:98-104`
  - [x] `-v` shows continuation context: why continuation was triggered, what error text is appended. Evidence: `engine/output.ts:140-151` (`verboseContinuation()`), `engine/agent.ts:126-135`
  - [x] `-v` streams agent stdout in real-time (not buffered until completion). Evidence: `engine/output.ts` (`nodeOutput()` method — pre-existing)
  - ~~`-v` shows safety check results~~ — `verboseSafety()` removed (FR-56: engine domain-agnostic refactor; safety output now via agent stdout).
  - ~~`-v` shows commit details~~ — `verboseCommit()` removed (FR-56: engine no longer commits; git operations delegated to agent nodes).
  - [x] Default mode (no `-v`) remains concise: node start/complete/fail + summary. Evidence: `engine/output_test.ts:175-197` (all 6 verbose methods produce zero output in default mode)

### 3.7 FR-E7 (ex FR-20): Pipeline Config Drift Detection

- **Description:** Automated verification that pipeline YAML configs (`pipeline.yaml`, `pipeline-task.yaml`) remain consistent with engine expectations and SRS requirements. Detects mismatches in node declarations, required fields, hook syntax, and validation rules.
- **Acceptance criteria:**
  - ~~`[ ] A deno task check:pipeline standalone command`~~ — SDLC pipeline convenience, not engine constraint. Implemented as `pipelineIntegrity()` in `scripts/check.ts` (SDLC scope). See FR-S24 in `documents/requirements-sdlc.md`.
  - [x] Engine validates all node types on `loadConfig()`: must be one of `agent`, `loop`, `merge`, `human`. Evidence: `engine/config.ts:43` (`validateSchema()`), `engine/config.ts:71` (type check per node)
  - [ ] Check verifies `after`/`before` hook commands use valid template variables (no unresolved `{{...}}` patterns after interpolation context is known).
  - [x] Engine validates loop nodes reference valid body nodes and `condition_node` within `nodes` sub-object. Evidence: `engine/config.ts:105-249` (`validateNode()` loop section)
  - [x] Config validation runs as part of `deno task check` via `pipelineIntegrity()` → `loadConfig()`. Evidence: `scripts/check.ts:84-96` (`pipelineIntegrity()`), `engine/config.ts:32,43` (`validateSchema()` called on every `parseConfig()`)
  - [x] Validation failures throw descriptive errors with node ID and field context. Evidence: `engine/config.ts:71-103` (error messages include node ID and field name)

### 3.8 FR-E8 (ex FR-21): Human-in-the-Loop (Agent-Initiated)

- **Description:** Any pipeline agent can request human input mid-task by calling the built-in `AskUserQuestion` tool. The engine detects this call (denied in `-p` mode but visible in JSON output as `permission_denials`), delegates question delivery and reply polling to external pipeline scripts, and resumes the agent session with the human's answer via `--resume`.
- **Mechanism:**
  1. Agent calls `AskUserQuestion` → Claude CLI denies it in `-p` mode (no terminal) → structured question visible in `permission_denials` field of JSON `result` event.
  2. Engine extracts question (`{question, header, options[], multiSelect}`) and `session_id`.
  3. Engine invokes configurable `ask_script` (pipeline script, not engine code) to deliver question (e.g., `gh issue comment`).
  4. Engine enters poll loop: `sleep poll_interval` → invoke `check_script` → if exit 0 (reply found), read reply from stdout.
  5. Engine resumes agent: `claude --resume <session_id> -p "<reply>"`. Agent continues with full session context.
- **Key constraint:** Engine contains zero GitHub/Slack/email-specific code. All delivery/polling logic lives in pipeline scripts (`.sdlc/scripts/`).
- **Acceptance criteria:**
  - [x] Engine detects `AskUserQuestion` in `permission_denials` of Claude CLI JSON output after agent node completes. Evidence: `engine/hitl.ts:61-93` (`detectHitlRequest()`), `engine/engine.ts:316-319` (call in `executeAgentNode`)
  - [x] Engine saves `session_id`, question JSON, and node status `waiting` to `state.json`. Evidence: `engine/state.ts:93-103` (`markNodeWaiting()`), `engine/engine.ts:324-325` (call + saveState), `engine/types.ts:104` (`question_json` field)
  - [x] Engine invokes `ask_script` (path from `pipeline.yaml` `defaults.hitl`) with args: `--run-dir`, `--artifact-source`, `--run-id`, `--node-id`, `--question-json`. Evidence: `engine/hitl.ts:111-125` (`buildScriptArgs("ask")`), `engine/hitl.ts:127-134` (ask invocation)
  - [x] Engine enters poll loop calling `check_script` with args: `--run-dir`, `--artifact-source`, `--run-id`, `--node-id`, `--exclude-login`. Exit 0 = reply in stdout; exit 1 = no reply yet. Evidence: `engine/hitl.ts:137-175` (poll loop), `engine/hitl_test.ts:184-214` (poll test)
  - [x] On reply: engine resumes agent via `claude --resume <session_id> -p "<reply>"`. Evidence: `engine/hitl.ts:158-172` (claudeRun with resumeSessionId)
  - [x] Configurable `poll_interval` (default 60s) and `timeout` (default 7200s) per pipeline. Evidence: `engine/types.ts:170-175` (`HitlConfig`), `.sdlc/pipeline.yaml:16-20` (defaults.hitl)
  - [x] On timeout: node fails, Meta-Agent triggered. Evidence: `engine/hitl.ts:183-188` (timeout return), `engine/engine.ts:342-347` (markNodeFailed on HITL failure), `engine/hitl_test.ts:216-230` (timeout test)
  - [x] `deno task run` on a pipeline with `waiting` nodes auto-resumes polling (no manual `--resume` needed). Evidence: `engine/engine.ts:278-310` (wasWaiting resume path in executeAgentNode)
  - [x] Pipeline scripts `hitl-ask.sh` and `hitl-check.sh` exist in `.sdlc/scripts/`. Evidence: `.sdlc/scripts/hitl-ask.sh`, `.sdlc/scripts/hitl-check.sh`
  - [x] `hitl-ask.sh` renders question JSON → markdown with HTML marker `<!-- hitl:<run-id>:<node-id> -->`, posts via `gh issue comment`. Evidence: `.sdlc/scripts/hitl-ask.sh:52-76` (markdown render + marker + gh post)
  - [x] `hitl-check.sh` finds first non-bot comment after marker, outputs body to stdout (exit 0) or exits 1 if no reply. Evidence: `.sdlc/scripts/hitl-check.sh:39-54` (jq filter + exit codes)

### 3.9 FR-E9 (ex FR-23): Run Artifacts Folder Structure

- **Description:** Run artifacts under `.sdlc/runs/<run-id>/` must follow a
  hierarchical layout that groups node output directories by pipeline phase,
  separating agent output artifacts from runtime metadata (logs, state).
- **Motivation:** Current flat layout intermixes planning nodes, implementation
  loop nodes, commit nodes, and infrastructure files (`logs/`, `state.json`)
  at the same level. This hinders navigability and does not reflect the
  pipeline execution flow.
- **Layout:** Node output directories grouped into phase subdirectories
  reflecting the DAG execution flow. Runtime metadata (`state.json`, `logs/`)
  at the run root level (not inside phase groups).
- **Acceptance criteria:**
  - [x] Node output directories are grouped by pipeline phase under
    `.sdlc/runs/<run-id>/` (e.g., `plan/`, `impl/`, `report/`). Phase derived
    from top-level `phases:` config declaration (authoritative) or per-node
    `phase:` field (fallback). Evidence: `engine/state.ts:20-36`
    (`setPhaseRegistry()` — builds nodeId→phase map from config),
    `engine/state.ts:98-104` (`getNodeDir()` — phase-aware path resolution),
    `engine/engine.ts:135` (`setPhaseRegistry(config)` at engine init)
  - [x] `state.json` and `logs/` remain at the run root level
    (`.sdlc/runs/<run-id>/state.json`, `.sdlc/runs/<run-id>/logs/`). Phase
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
  - [ ] Existing pipeline.yaml node definitions require minimal changes (phase
    grouping derived from config or convention, not hardcoded per-node paths).
  - [ ] All existing engine tests pass after restructuring.

### 3.10 FR-E10 (ex FR-24): Loop Body Node Nesting

- **Description:** Loop nodes in `pipeline.yaml` must define their body nodes
  inline as nested objects, not reference top-level node IDs. This makes the
  parent-child relationship explicit, prevents body nodes from being executed
  outside their loop context, and aligns config structure with execution model.
- **Motivation:** Current config declares loop body nodes (`developer`, `qa`) at
  the top level alongside pipeline-level nodes. Body nodes use loop-scoped
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
        prompt: ".claude/skills/agent-developer/SKILL.md"
        inputs: [architect, sds-update]
        ...
      qa:
        type: agent
        prompt: ".claude/skills/agent-qa/SKILL.md"
        inputs: [pm, architect, developer]
        ...
  ```
- **Acceptance criteria:**
  - [x] Loop nodes define body nodes inline via `nodes` sub-object in
    `pipeline.yaml`. Evidence: `.sdlc/pipeline.yaml:120-158` (`implementation` loop node with inline `nodes:` containing `build` and `verify`)
  - [x] Body node IDs in `nodes` are not registered as top-level DAG nodes. Evidence: `engine/dag.ts:17-19` (`collectLoopBodyNodes()`), `engine/dag.ts:36-45` (body nodes filtered from main DAG in `buildLevels()`)
  - [x] Body nodes can reference external (top-level) nodes in their `inputs`. Evidence: `engine/config.ts:204` (`validInputIds = [...allNodeIds, ...bodyNodeIds]`), `.sdlc/pipeline.yaml:124` (`build` inputs `[decision]` — top-level node)
  - [x] Body nodes can reference sibling body nodes (within the same loop) in
    their `inputs`. Evidence: `engine/config.ts:190-195` (validates internal inputs for ordering), `.sdlc/pipeline.yaml:144` (`verify` inputs `[specification, decision, build]` — `build` is a sibling body node)
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
  - [x] `pipeline.yaml` and any other pipeline configs updated to use nested
    body node definitions. Evidence: `.sdlc/pipeline.yaml:120-158` (`implementation` loop with inline `nodes:` sub-object)
  - [x] All existing engine tests pass after restructuring. Evidence: `deno task check` — 490 passed, 0 failed
  - [x] `deno task check` passes. Evidence: 490 passed, 0 failed

### 3.11 FR-E11 (ex FR-25): Conditional Post-Pipeline Node Execution (`run_on`)

- **Description:** Replace the binary `run_always: boolean` flag with a
  `run_on: always | success | failure` enum on `NodeConfig`. Engine collects
  post-pipeline nodes (those with `run_on` set) and executes them after all DAG
  levels complete, filtering by pipeline outcome. This prevents committer nodes
  from creating PRs/merging when the pipeline failed, while allowing meta-agent
  to always run.
- **Motivation:** `run_always: true` causes committer nodes to run on failure,
  creating PRs with `Closes #N` that merge broken code. Prompt-level guards are
  unreliable (LLM can ignore them). Engine-level gating is required.
- **Enum semantics:**
  - `run_on: always` — execute regardless of pipeline outcome (current
    `run_always: true` behavior).
  - `run_on: success` — execute only when all regular DAG nodes passed.
  - `run_on: failure` — execute only when pipeline failed.
  - Nodes without `run_on` execute in normal DAG order (no change).
- **Backward compatibility:** `run_always: true` in config is normalized to
  `run_on: "always"` during config loading. `run_always: false` (or absent) is
  unchanged (no `run_on` set).
- **Acceptance criteria:**
  - [x] `NodeConfig` in `types.ts` has `run_on?: "always" | "success" | "failure"` field. `run_always` deprecated. Evidence: `engine/types.ts:66-69` (`run_on?` field, `run_always?: boolean` with `@deprecated` tag)
  - [x] `config.ts` normalizes `run_always: true` → `run_on: "always"` for backward compat. Evidence: `engine/config.ts:341-347` (normalizes `run_always: true` → `run_on: "always"`, deletes `run_always`)
  - [x] Engine filters post-pipeline nodes: skips `run_on: success` nodes when pipeline failed, skips `run_on: failure` nodes when pipeline succeeded. Evidence: `engine/engine.ts:182-199` (skip logic with `markNodeSkipped`)
  - [x] Meta-agent runs on every outcome (`run_on: always`). Evidence: `.sdlc/pipeline.yaml:174` (`optimize` node `run_on: always`), `engine/engine.ts:182-199` (`run_on: always` bypasses skip filter)
  - [x] `pipeline.yaml` migrated from `run_always: true` to appropriate `run_on` values. Evidence: `.sdlc/pipeline.yaml:174` (`optimize: run_on: always`), `.sdlc/pipeline.yaml:200` (`tech-lead-review: run_on: always`)
  - [x] Engine remains domain-agnostic — no git/PR/GitHub logic in engine code. Evidence: `engine/git.ts` deleted; `engine/engine.ts` uses generic `on_failure_script` hook; `engine/mod.ts` git re-exports removed.
  - [x] All existing engine tests pass; new tests cover `run_on` filtering logic. Evidence: `engine/engine_test.ts:211-506` (collectPostPipelineNodes and run_on tests), `engine/config_test.ts:446-564` (run_on validation + run_always normalization tests); 490 passed, 0 failed
  - [x] `deno task check` passes. Evidence: 490 passed, 0 failed

### 3.12 FR-E12 (ex FR-27): Per-Node Model Configuration

- **Description:** Add `model` field to `PipelineDefaults` and `NodeConfig` in
  pipeline config. Engine emits `--model <value>` flag when invoking Claude CLI
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
  - [x] `PipelineDefaults` in `types.ts` has `model?: string` field. Evidence: `engine/types.ts:21`
  - [x] `NodeConfig` in `types.ts` has `model?: string` field. Evidence: `engine/types.ts:39`
  - [x] `config.ts` parses `model` from defaults and node configs. Evidence: `engine/config.ts:26-33` (YAML pass-through via structural typing; `PipelineDefaults`/`NodeConfig` types carry `model?`)
  - [x] `agent.ts` `buildClaudeArgs()` emits `--model <value>` when model is set. Evidence: `engine/agent.ts:309-311`
  - [x] `agent.ts` does NOT emit `--model` on `--resume` invocations. Evidence: `engine/agent.ts:309` (`&& !opts.resumeSessionId` guard)
  - [x] Loop body nodes resolve model from: own config > loop node config > defaults. Evidence: `engine/loop.ts:76`
  - [x] `pipeline.yaml` updated: default model + per-node overrides for complex stages. Evidence: `.sdlc/pipeline.yaml:15` (default), `.sdlc/pipeline.yaml:65,84,147` (overrides)
  - [x] All existing engine tests pass; new tests cover model flag emission and resolution. Evidence: `engine/agent_test.ts:207-233` (3 model tests); 434 tests pass.
  - [x] `deno task check` passes. Evidence: validated — 434 passed, 0 failed.

### 3.13 FR-E13 (ex FR-28): Accurate Dry-Run Output

- **Description:** `--dry-run` flag displays execution plan that mirrors actual
  engine execution order: regular levels (without `run_on` post-pipeline nodes)
  shown first, followed by a separate "Post-pipeline" section listing `run_on`
  nodes in topological order. Eliminates misleading display of post-pipeline
  nodes intermixed with regular levels.
- **Motivation:** Current dry-run path uses raw `buildLevels()` output, bypassing
  the `run_on` collection and filtering applied in normal execution. This causes
  operators to misread the execution order (e.g., `meta-agent` appears to run in
  parallel with `pm`, `commit` appears as a regular level node).
- **Acceptance criteria:**
  - [x] `--dry-run` output excludes `run_on`-configured nodes from regular level display. Evidence: `engine/engine.ts:78-80` (dry-run filters out `postPipelineNodeIds` from levels before display)
  - [x] `--dry-run` output includes a "Post-pipeline" section listing `run_on` nodes in topological order. Evidence: `engine/engine.ts:73-91` (`collectPostPipelineNodes` + `sortPostPipelineNodes` + `dryRunPlan` call), `engine/output.ts:190-197` (`dryRunPlan` renders "Post-pipeline" section)
  - [x] Dry-run applies the same `collectRunOnNodes()` filtering logic as normal execution. Evidence: `engine/engine.ts:73-91` (same `collectPostPipelineNodes()` + `sortPostPipelineNodes()` calls in both dry-run and normal paths)
  - [x] `OutputManager.dryRunPlan()` accepts and displays post-pipeline nodes separately. Evidence: `engine/output.ts:173-199` (`dryRunPlan` signature with `postPipelineNodeIds?: string[]` + `runOnMap?`, renders "Post-pipeline" section)
  - [x] Engine unit tests cover dry-run output with `run_on` nodes present. Evidence: `engine/engine_test.ts:678` ("dry-run — post-pipeline nodes excluded from regular levels filtering logic")
  - [x] `deno task check` passes. Evidence: 490 passed, 0 failed

### 3.14 FR-E14 (ex FR-29): Engine-Pipeline Separation Invariant

- **Description:** The pipeline engine (`engine/`) is a domain-agnostic DAG executor. It MUST be physically separated from pipeline-specific concerns (config, agents, run artifacts) by directory structure, not only by convention. This constraint is structural and must be enforced by the project layout.
- **Rationale:** Issue #12 — collocating engine source with pipeline data under `.sdlc/` obscures boundaries, hinders tooling, and blocks future engine reuse.
- **Rules:**
  - Engine source lives in a dedicated top-level directory (e.g., `engine/` or a standardized path); no pipeline, agent, git, or GitHub-specific logic inside.
  - Pipeline config (`pipeline.yaml`), agent prompts (`.claude/skills/`), and run artifacts (`runs/`) are domain-specific — must not be nested under the engine directory.
  - `deno.json` tasks and imports reference the new layout consistently.
- **Acceptance criteria:**
  - [x] Engine source directory contains only domain-agnostic DAG executor code. Evidence: `engine/git.ts` and `engine/git_test.ts` deleted; `engine/mod.ts` git exports removed; `engine/types.ts` `HitlConfig` fields renamed to domain-neutral names (`artifact_source`, `exclude_login`).
  - [ ] Engine source contains zero references to concrete artifact filenames (e.g., `failed-node.txt`) or concrete node names (e.g., `meta-agent`).
  - [ ] No `pipeline.yaml`, agent skill files, or run artifacts reside inside the engine directory.
  - [ ] `deno task run` and `deno task test:engine` reference the new engine path.
  - [ ] `deno task check` passes after restructure.

### 3.15 FR-E15 (ex FR-30): Node Result Summary

- **Description:** After each agent node completes, the engine displays a one-line
  result summary in the terminal output. Summary includes the first line of the
  agent result (truncated to 120 chars), cost, duration, and turn count. Provides
  at-a-glance pipeline progress without requiring verbose mode.
- **Acceptance criteria:**
  - [x] `OutputManager.nodeResult(nodeId, output)` displays one-line summary.
    Evidence: `engine/output.ts` (`nodeResult()` method).
  - [x] Format: `[HH:MM:SS] <nodeId>  RESULT: <first line ≤120 chars> | cost=$X.XXXX | duration=Xs | turns=N`.
    Evidence: `engine/output.ts` (`nodeResult()` formatting).
  - [x] Shown in default and verbose modes; suppressed in quiet mode.
    Evidence: `engine/output.ts` (`verbosity !== "quiet"` guard).
  - [x] Called for top-level agent nodes in `executeNode()` and for loop body
    nodes in `executeLoopNode()` `onNodeComplete` callback.
    Evidence: `engine/engine.ts` (two call sites).
  - [x] `deno task check` passes.

### 3.16 FR-E16 (ex FR-31): Prompt Path Validation at Config Load

- **Description:** Pipeline engine validates that all `prompt` file paths declared
  in `pipeline.yaml` exist on the filesystem before any node executes. Validation
  runs once at config load time, accumulates all missing paths, and throws a single
  error listing every missing file. Paths containing `{{` (template variables) are
  skipped — they cannot be resolved at load time.
- **Motivation:** Misconfigured `prompt` paths cause silent agent failures 30+ min
  into a pipeline run (incident: run `20260313T025203`). Early batch validation
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

- **Description:** Pipeline engine persists per-node cost and pipeline-level total
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
  (`.sdlc/runs/<run-id>/logs/<node-id>.jsonl`) is prefixed with a wall-clock
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

### 3.19 FR-E19 (ex FR-34): Generic Pipeline Failure Hook (`on_failure_script`)

- **Description:** Engine supports a configurable `on_failure_script` field in `PipelineDefaults` (YAML: `defaults.on_failure_script`). When the pipeline fails, the engine executes the specified script via `Deno.Command`. Replaces the former hard-wired `rollbackUncommitted()` git call, which violated the domain-agnostic invariant (FR-E14).
- **Rationale:** Domain-specific failure recovery (e.g., git rollback) belongs in pipeline scripts, not engine code. The engine provides a generic hook; the pipeline wires it to the appropriate script.
- **Acceptance criteria:**
  - [x] `PipelineDefaults` in `engine/types.ts` includes `on_failure_script?: string`. Evidence: `engine/types.ts:23` (`on_failure_script?: string`)
  - [x] Engine executes `on_failure_script` via `Deno.Command` on pipeline failure (if configured). Evidence: `engine/engine.ts:171-175` (`runFailureHook` called when `!pipelineSuccess`), `engine/engine.ts:808-831` (`runFailureHook` using `new Deno.Command(script, ...)`)
  - [x] Engine does NOT import or call any git functions on failure. Evidence: `engine/engine.ts` — no git imports; failure path uses generic `runFailureHook` only
  - [x] `.sdlc/pipeline.yaml` sets `on_failure_script: .sdlc/scripts/rollback-uncommitted.sh`. Evidence: `.sdlc/pipeline.yaml:18` (`on_failure_script: .sdlc/scripts/rollback-uncommitted.sh`)
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

- **Description:** Pipeline engine must support a `semi-verbose` verbosity level
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

## 4. Non-Functional Requirements

- **Isolation:** Each agent runs in its own Claude Code process with no shared state except file artifacts. Single local execution assumed (one pipeline at a time). Concurrent execution is not supported.
- **Fault tolerance:** If a node fails (agent error, timeout, continuation limit exhausted), the pipeline stops. Post-pipeline nodes with `run_on` config execute based on outcome. Manual restart via `--resume <run-id>`.
- **Timeouts:** Each node has a configurable timeout (default: 30 min). Engine enforces timeout per node. On timeout, node is treated as failed.
- **Observability:** 3 verbosity levels (`-q`/default/`-v`/`-s`); status lines with timestamps; per-node result summaries; full logs stored per node in `<run-dir>/logs/`.
- **Domain-agnostic:** Engine MUST NOT contain git, GitHub, branch, PR, or any domain-specific logic. All domain workflows implemented via agent nodes wired in pipeline YAML configs.
- **Pipeline-independent:** Engine MUST NOT depend on any specific pipeline config. One engine, many pipelines. No references to concrete node names, artifact filenames, or pipeline structure.

## 5. Interfaces

- **CLI entry:** `deno task run [--prompt "..."]`. Flags: `--resume <run-id>`, `--dry-run`, `-v` (verbose), `-q` (quiet), `-s` (semi-verbose), `--config <path>`, `--skip <node>`, `--only <node>`, `--env <K=V>`.
- **Agent runtime:** `claude` CLI invoked by engine. Key flags:
  - `--append-system-prompt` — role-specific instructions inline (content cached from prompt file at startup). Fallback: `--append-system-prompt-file` for template-path prompts.
  - `--output-format stream-json` — streams JSON events; `result` event contains `result`, `session_id`, `total_cost_usd`, `duration_ms`, `num_turns`, `is_error`.
  - `--resume <session-id>` — re-invokes agent in same session for continuations (FR-E1).
  - `-p "<prompt>"` — non-interactive mode.
  - `--model <model>` — per-node model override (FR-E12).
- **Config format:** YAML pipeline config with `defaults` (global settings) and `nodes` (DAG definition). Node types: `agent`, `loop`, `merge`, `human`. Fields per type: `prompt`, `inputs`, `validate`, `model`, `run_on`, `after`/`before` hooks.
- **State:** `<run-dir>/state.json` — node statuses (`pending`/`running`/`completed`/`failed`/`waiting`/`skipped`), session IDs, cost data, timing, HITL question JSON.
- **Template variables:** `{{input.<node-id>}}` (node output dir), `{{node_dir}}` (current node output dir), `{{run_dir}}` (run root), `{{run_id}}`, `{{loop.iteration}}` (loop body only), `{{env.<KEY>}}`.

## Appendix: FR Cross-Reference

| Old ID | New ID | Title |
|--------|--------|-------|
| FR-8   | FR-E1  | Continuation Mechanism |
| FR-10  | FR-E2  | Agent Log Storage |
| FR-13  | FR-E3  | Artifact Versioning |
| FR-15  | FR-E4  | Configuration |
| FR-17  | FR-E5  | Project Directory Structure |
| FR-18  | FR-E6  | Verbose Output (`-v`) |
| FR-20  | FR-E7  | Pipeline Config Drift Detection |
| FR-21  | FR-E8  | Human-in-the-Loop (Agent-Initiated) |
| FR-23  | FR-E9  | Run Artifacts Folder Structure |
| FR-24  | FR-E10 | Loop Body Node Nesting |
| FR-25  | FR-E11 | Conditional Post-Pipeline Node Execution (`run_on`) |
| FR-27  | FR-E12 | Per-Node Model Configuration |
| FR-28  | FR-E13 | Accurate Dry-Run Output |
| FR-29  | FR-E14 | Engine-Pipeline Separation Invariant |
| FR-30  | FR-E15 | Node Result Summary |
| FR-31  | FR-E16 | Prompt Path Validation at Config Load |
| FR-32  | FR-E17 | Aggregate Cost Data in state.json |
| FR-33  | FR-E18 | Stream Log Timestamps |
| FR-34  | FR-E19 | Generic Pipeline Failure Hook (`on_failure_script`) |
| FR-39  | FR-E20 | Repeated File Read Warning |
| FR-41  | FR-E21 | Semi-Verbose Output Mode (`-s`) |
