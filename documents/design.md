# SDS

## 1. Intro

- **Purpose:** Define implementation details for auto-flow: automated
  multi-agent SDLC pipeline.
- **Rel to SRS:** Implements all FRs from `documents/requirements.md`. Each
  component maps to one or more FRs.

## 2. Arch

- **Diagrams:**

### 2.1 Legacy: Shell Script Pipeline

```mermaid
graph LR
    Issue["GitHub Issue"] --> CLI["deno task run<br/>--issue N"]
    CLI --> S1["Stage 1: PM"]
    S1 --> S2["Stage 2: Tech Lead"]
    S2 --> S3["Stage 3: Reviewer"]
    S3 --> S4["Stage 4: Architect"]
    S4 --> S5["Stage 5: SDS Update"]
    S5 --> S6["Stage 6-7: Executor+QA Loop"]
    S6 --> S8["Stage 8: Presenter"]
    S8 --> S9["Stage 9: Meta-Agent"]
    S6 -->|"FAIL after max"| S9

    subgraph Devcontainer["Devcontainer"]
        S1; S2; S3; S4; S5; S6; S8; S9
    end
```

### 2.2 Current: Configurable Node Engine (Deno/TypeScript)

```mermaid
graph TD
    CLI["CLI<br/>deno task run"] --> Engine
    Engine --> Config["Config Loader<br/>.sdlc/pipeline.yaml"]
    Engine --> DAG["DAG Builder<br/>toposort → levels"]
    Engine --> State["State Manager<br/>state.json"]

    DAG --> L1["Level 1<br/>(parallel nodes)"]
    DAG --> L2["Level 2<br/>(parallel nodes)"]
    DAG --> LN["Level N<br/>(parallel nodes)"]

    L1 --> Dispatch
    L2 --> Dispatch
    LN --> Dispatch

    subgraph Dispatch["Node Dispatcher"]
        Agent["agent<br/>Claude CLI"]
        Loop["loop<br/>iterative body"]
        Human["human<br/>terminal prompt"]
        Merge["merge<br/>combine outputs"]
    end

    Dispatch --> Validate["Validation<br/>file checks"]
    Dispatch --> Git["Git<br/>commit per node"]
    Dispatch --> Output["Output<br/>3 verbosity levels"]
```

- **Subsystems:**
  - **Pipeline Engine** (`.sdlc/engine/`): Deno/TypeScript DAG-based executor
    with YAML config, template interpolation, parallel levels, loop nodes,
    human nodes, resume support
  - **Agent Runtime**: Claude Code CLI invocations with role-specific prompts
  - **Artifact Store**: Git-tracked files in `.sdlc/runs/<run-id>/<node-id>/`
  - **Validation Engine**: Rule-based checks (file_exists, file_not_empty,
    contains_section, custom_script, frontmatter_field)
  - **Continuation Engine**: `--resume` based re-invocation on validation
    failure or safety-check violation (shared `max_continuations` budget)
  - **Legacy Shell Scripts** (`.sdlc/scripts/`): Preserved for backward
    compatibility, superseded by engine

## 3. Components

### 3.1 Docker Image

- **Purpose:** Single runtime environment for all stages.
- **Interfaces:** Contains `claude` CLI, `deno`, `git`, `gh`, `gitleaks`.
- **Deps:** Node.js (for claude CLI install), Deno runtime.

### 3.2 Stage Scripts (`.sdlc/scripts/`)

- **Purpose:** Orchestrate each pipeline stage: prepare input, invoke agent,
  validate, continue, commit.
- **Interfaces:**
  - Input: `<issue-number>` as CLI argument.
  - Output: Committed artifacts + logs on feature branch.
- **Deps:** `lib.sh` (shared functions), `claude` CLI, `git`, `gh`.

### 3.3 Shared Library (`.sdlc/scripts/lib.sh`)

- **Purpose:** Common functions for all stage scripts.
- **Interfaces:** Functions: `log()`, `run_agent()`, `validate_artifact()`,
  `continuation_loop()`, `commit_artifacts()`, `report_status()`,
  `safety_check_diff()`, `retry_with_backoff()`.
  - `retry_with_backoff()`: Generic retry wrapper for external CLI calls
    (`claude`, `gh`). Max 3 attempts, 5s initial delay, 2x backoff. Retries on
    non-zero exit (network/rate-limit errors). Does not retry validation
    failures.
- **Deps:** `claude` CLI, `git`, `gh`.

### 3.4 Agent Prompts (`.sdlc/agents/`)

- **Purpose:** Versioned system prompts defining each agent's role and behavior.
- **Interfaces:** Markdown files consumed by `claude --system-prompt`.
- **Deps:** None (static content, versioned in git).

### 3.5 Pipeline Engine (`.sdlc/engine/`)

- **Purpose:** Configurable DAG-based pipeline executor. Replaces hardcoded
  shell script orchestration with YAML-driven node graph.
- **Modules:**
  - `types.ts` — type declarations (incl. `ValidationRule.type` union,
    `NodeConfig.run_always`)
  - `template.ts` — `{{var}}` interpolation for prompts/paths
  - `config.ts` — YAML parsing, schema validation, defaults merge
  - `dag.ts` — topological sort, cycle detection, level grouping
  - `validate.ts` — artifact validation rules (file_exists, not_empty,
    contains_section, custom_script, frontmatter_field)
  - `state.ts` — RunState persistence to `state.json`, resume logic
  - `agent.ts` — Claude CLI invocation, continuation loop, retry
  - `loop.ts` — loop node execution with condition extraction
  - `human.ts` — terminal user input, abort logic
  - `git.ts` — commit per node, diff safety checks (gitleaks CLI + regex
    fallback), branch query
  - `output.ts` — terminal output manager (quiet/normal/verbose), verbose
    methods for detailed agent-node diagnostics
  - `engine.ts` — main executor: level iteration, parallel dispatch, verbose
    input resolution
  - `cli.ts` — CLI entry point: argument parsing, .env loading
  - `mod.ts` — public API re-exports
- **Interfaces:**
  - CLI: `deno task run:{issue|text|file} <arg> [--config <path>] [--resume <run-id>]
    [--dry-run] [-v|-q] [--env KEY=VAL] [--skip nodes] [--only nodes]`
  - Config: `.sdlc/pipeline.yaml` (YAML, version "1")
  - State: `.sdlc/runs/<run-id>/state.json` (JSON)
- **Node types:** `agent`, `merge`, `loop`, `human`
- **Node flags:** `run_always?: boolean` — when `true`, node executes in a
  post-levels step after all DAG levels complete (including on pipeline
  failure). Used for Meta-Agent.
- **Config requirement:** Executor-role agent nodes MUST have `allowed_paths`
  configured in `pipeline.yaml` for safety check verbose output (AC6) to fire.
  Empty `allowed_paths` skips safety check entirely.
- **Verbose Output (Direct Injection pattern):**
  - `output.ts` exposes 6 verbose-guarded methods on `OutputManager`:
    `verbosePrompt(nodeId, prompt)`,
    `verboseInputs(nodeId, inputs: {path, sizeBytes}[])`,
    `verboseValidation(nodeId, results: {rule, passed, detail?}[])`,
    `verboseContinuation(nodeId, attempt, max, failures)`,
    `verboseSafety(nodeId, files, violations)`,
    `verboseCommit(nodeId, files, message, branch)`.
    All no-op when `verbosity !== "verbose"`. Output: human-readable stderr with
    section headers. Note: AC #5 (agent stdout streaming) already implemented
    via existing `nodeOutput()` method — no new work needed.
  - `agent.ts`: `AgentRunOptions` gains optional `output?: OutputManager` and
    `nodeId?: string`. `runAgent()` calls `verbosePrompt()` after prompt
    construction, `verboseValidation()` after each `runValidations()` call,
    `verboseContinuation()` before resume invocation. Guarded by `if (output)`.
  - `loop.ts`: `LoopRunOptions` gains optional `output?: OutputManager`.
    Forwarded to `runAgent()` calls. Enables prompt/validation/continuation
    verbose for loop body nodes. Safety/commit verbose for loop body nodes:
    deferred (loop body bypasses `executeAgentNode()`).
  - `git.ts`: No `OutputManager` dependency. Pure data enrichment only.
    `commitNodeChanges()` runs `git diff --cached --name-only` after
    `git add -A` to capture staged files. Returns enriched `CommitResult` with
    `filesStaged: string[]` and `message: string`. `safetyCheckDiff()` returns
    enriched `SafetyCheckResult` with `checkedFiles: string[]` (from
    already-computed `changedFiles`). `branch()` helper: returns current branch
    name via `git branch --show-current`. Verbose calls for safety/commit stay
    in engine.
  - `engine.ts`: `executeAgentNode()` resolves input artifact paths+sizes by
    walking `ctx.input` directories via `Deno.stat()`; calls
    `this.output.verboseInputs()` before `runAgent()`. Passes `this.output`
    and `nodeId` to `runAgent()`. After `safetyCheckDiff()`, calls
    `this.output.verboseSafety()` with `checkedFiles` and `violations`.
    `commitIfNeeded()` (called from `executeNode()` after agent returns): after
    `commitNodeChanges()` returns, calls `this.output.verboseCommit()` with
    `filesStaged`, `message`, branch. Sequencing: inputs → agent
    (prompt/validation/continuation verbose) → safety (verbose) → commit
    (verbose via `commitIfNeeded()`).
  - All existing callers pass no `output` arg — zero behavioral change.
- **Deps:** `claude` CLI, `deno`, `git`, `jsr:@std/yaml`.

### 3.6 Pipeline Trigger (Legacy)

- **Purpose:** Trigger pipeline on issue number, run stages sequentially.
- **Interfaces:** CLI: `deno task run:issue <N>`. Fetches issue via `gh`.
- **Deps:** Devcontainer, Claude CLI auth (OAuth or API key), `GITHUB_TOKEN`.

## 4. Data

- **Entities:**
  - Handoff Artifact: Structured Markdown (01-spec.md through 07-meta-report.md)
  - Agent Log: Claude CLI JSON output (`.sdlc/runs/<run-id>/logs/<node-id>.json`)
  - Agent Prompt: System prompt Markdown (`.sdlc/agents/<role>.md`)
  - Run State: JSON (`.sdlc/runs/<run-id>/state.json`)
  - Pipeline Config: YAML (`.sdlc/pipeline.yaml`)
  - CommitResult: `{ commitHash, filesStaged: string[], message: string }`
    (enriched for verbose output)
  - SafetyCheckResult: `{ violations[], checkedFiles: string[] }` (enriched for
    verbose output)
  - ValidationRule: `{ type: "file_exists"|"file_not_empty"|"contains_section"|
    "custom_script"|"frontmatter_field", path?, field?, allowed?, ... }`
  - NodeConfig: `{ ..., run_always?: boolean }` — flag for post-levels execution
- **ERD:** N/A (file-based, no database).
- **Migration:** N/A.

### 4.1 Inter-Node Data Flow

- **Mechanism:** Filesystem-based. Each node reads input via `{{input.<node-id>}}`
  template variable pointing to predecessor's output directory. No manifest.
- **Directory structure:** `.sdlc/runs/<run-id>/<node-id>/` per node output.
- **Validation:** Engine validates output via configurable rules (file_exists,
  file_not_empty, contains_section, custom_script, frontmatter_field) after
  each node. Validation failures trigger continuation (resume with error
  context) rather than immediate node failure.
  - `frontmatter_field`: Reads artifact file, extracts YAML frontmatter via
    `^---\n([\s\S]*?)\n---` regex, parses target field, checks value against
    allowed set. Config: `{ type: "frontmatter_field", path, field, allowed }`.
  - Executor node uses `custom_script` validation rule (not `after` hook) for
    `deno task check`, enabling continuation-on-failure for check errors.
- **Context management:** Claude CLI auto-compression handles large input sets.
- **Template variables:** `{{node_dir}}`, `{{input.*}}`, `{{run_dir}}`,
  `{{run_id}}`, `{{args.*}}`, `{{env.*}}`, `{{loop.iteration}}`.

### 4.2 Commit Strategy

- **Branch:** Feature branch, specified externally or current branch.
- **Commit cadence:** Engine commits after each successful node.
- **Commit format:** `sdlc(<node-id>): <run-id> — <node label>`.
- **Commit scope:** All changes since last commit (node output + modified docs).
- **Failure behavior:** Failed nodes produce no commits. On_error: "fail" stops
  pipeline; "continue" proceeds to next nodes.
- **Resume:** `--resume <run-id>` skips completed nodes per state.json.

## 5. Logic

- **Algos:**
  - **Continuation Loop**: invoke agent -> validate -> if fail: resume with
    error context -> repeat (max N). Additionally, `safetyCheckDiff()` violations
    after `runAgent()` trigger resume with violation details via
    `resumeSessionId`. Safety and validation continuations share single
    `max_continuations` counter. If limit reached: fail node, trigger
    Meta-Agent.
  - **Executor+QA Loop**: Executor implements -> QA verifies -> if FAIL:
    Executor reads QA report, fixes -> repeat (max 3).
  - **Diff Safety Check**: After Executor exit, check `git diff` for
    out-of-scope modifications, unauthorized deletions, secret patterns.
    **Gitleaks integration:** Before regex fallback, spawn
    `gitleaks detect --no-git --staged`; exit 0 = clean, non-zero = leak.
    On binary not found (`ENOENT`): log warning, fall back to regex. No silent
    suppression.
  - **Verbose Output Flow** (`-v` mode, agent nodes only): In
    `executeAgentNode()`: (1) resolve input artifact file paths+sizes from
    `ctx.input` dirs via `Deno.stat()` → `verboseInputs()`, (2) `runAgent()`
    (with `output` + `nodeId`) emits `verbosePrompt()` → Claude CLI executes →
    `verboseValidation()` → on failure: `verboseContinuation()` → retry,
    (3) `safetyCheckDiff()` returns enriched result → engine calls
    `verboseSafety()` with `checkedFiles` + `violations`. Then in
    `commitIfNeeded()` (called from `executeNode()` after agent returns):
    (4) `commitNodeChanges()` returns enriched result → engine calls
    `verboseCommit()` with `filesStaged`, `message`, branch. All verbose
    methods guarded by `verbosity !== "verbose"` — no-op in default/quiet.
    Output: human-readable stderr lines with section headers. Loop body nodes
    get prompt/validation/continuation verbose only; safety/commit verbose
    deferred (loop body bypasses `executeAgentNode()`).
  - **Verbose Edge Cases** (behavioral contracts verified by tests):
    - **Default mode (no `-v`):** All 6 verbose methods produce zero stderr
      output. `OutputManager` constructed with `verbose=false` suppresses all
      verbose calls unconditionally.
    - **Empty input dir:** `resolveInputArtifacts()` returns empty list →
      `verboseInputs()` reports `0 files` without error. No `Deno.stat()` calls.
    - **Missing file stat:** `Deno.stat()` failure on input artifact →
      graceful skip, verbose output includes error detail for affected path.
    - **Zero staged files at commit:** `commitNodeChanges()` detects no staged
      files → `verboseCommit()` reports no-op commit. No git commit created.
    - **Safety check with `allowed_paths: []`:** `safetyCheckDiff()` skipped
      entirely when node has empty `allowed_paths`. No `verboseSafety()` call.
    - **Safety check with `allowed_paths` configured:** `safetyCheckDiff()`
      executes, `verboseSafety()` emits `checkedFiles` + any `violations`.
  - **Meta-Agent Trigger**: Engine executes meta-agent via `run_always: true`
    mechanism. After all DAG levels complete (success or failure), engine
    collects nodes with `run_always: true` and executes them in a final
    post-levels step — outside normal DAG level iteration. Meta-agent node
    has no strict dependency on `presenter`, enabling execution even when
    upstream nodes fail. On failure: reads failed node ID from `state.json`,
    runs with failure context.
- **Rules:**
  - Artifacts overwritten on re-run (git history preserves previous).
  - QA iteration numbering restarts on re-run.
  - Meta-Agent runs on both success and failure.
  - Meta-Agent auto-applies prompt improvements to `.sdlc/agents/*.md` and
    commits changes. Human review at PR merge.

## 6. Non-Functional

- **Scale:** Single pipeline per issue. Sequential stages (no parallel agents).
- **Fault:** Stage failure stops pipeline, Meta-Agent analyzes, failure reported
  on issue.
- **Sec:** Diff-based safety checks (gitleaks CLI primary, regex fallback).
  Safety violations trigger continuation for self-correction. Agents run with
  local user's permissions.
- **Logs:** Full transcripts per stage in `.sdlc/runs/<run-id>/logs/`.

## 7. Constraints

- **Simplified:** Pipeline runs sequentially (no parallel stages in v1).
- **Deferred:** Multi-repo support. Parallel pipelines for multiple issues.
  Issue size/complexity limits. Cost tracking and budget limits.
