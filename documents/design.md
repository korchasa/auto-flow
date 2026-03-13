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
    Issue["GitHub Issue"] --> CLI["deno task run"]
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
    Dispatch --> Output["Output<br/>3 verbosity levels"]
```

### 2.3 Pipeline DAG (FR-26, FR-33)

```mermaid
graph LR
    Spec["specification"] --> Design["design<br/>(solution plan)"]
    Design --> Decision["decision<br/>(critique+branch+PR)"]
    Decision --> Loop["implementation<br/>(build→verify)"]
    Loop -.-> Review["tech-lead-review<br/>(run_on:always)"]
    Loop -.-> Optimize["optimize<br/>(run_on:always)"]
```

- **Node ID convention (FR-33):** Activity-based IDs reflect what work is done,
  not who does it. Mapping: `pm`→`specification`, `architect`→`design`,
  `tech-lead`→`decision`, `impl-loop`→`implementation`, `executor`→`build`,
  `qa`→`verify`, `tech-lead-review`→`tech-lead-review`, `meta-agent`→`optimize`.
- **Phases (FR-33):** Top-level `phases:` key in `pipeline.yaml` declares named
  phase groups. Each phase lists member stage IDs:
  - `plan`: [specification, design, decision]
  - `impl`: [implementation]
  - `report`: [tech-lead-review, optimize]
  Phase grouping is declarative config; engine treats it as opaque data. Enables
  future phase-level `run_on` semantics and cleaner artifact reporting.

- **Subsystems:**
  - **Pipeline Engine** (`engine/`): Deno/TypeScript DAG-based executor
    with YAML config, template interpolation, parallel levels, loop nodes,
    human nodes, resume support
  - **Agent Runtime**: Claude Code CLI invocations with role-specific prompts
    from `agents/<name>/SKILL.md`; also discoverable as Claude Code skills via
    `.claude/skills/agent-<name>` symlinks
  - **Artifact Store**: Git-tracked files in `.sdlc/runs/<run-id>/[<phase>/]<node-id>/`
    (phase subdir present when node has `phase` field in config)
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

### 3.4 Agent Prompts (`agents/`)

- **Purpose:** Versioned system prompts defining each agent's role and behavior.
  Each agent lives in `agents/<name>/SKILL.md` with YAML frontmatter enabling
  dual-use: pipeline-driven (via engine `prompt:` config) and interactive
  (via Claude Code `/agent-<name>` slash commands).
- **Directory structure:** `agents/<name>/SKILL.md` — 7 agents:
  - `pm` — triages open GitHub issues, selects highest-priority, produces spec.
  - `architect` — design-solution role: produces implementation plan with 2-3
    variants, affected files, effort estimates, risk analysis (formerly
    tech-lead function).
  - `tech-lead` — critique + decision + SDS update + branch creation
    (`git checkout -b sdlc/issue-<N>`) + draft PR (`gh pr create --draft`) +
    task breakdown from selected variant. Absorbs former reviewer (FR-4) and
    SDS-update (FR-6) responsibilities. Uses `{{run_id}}` for `--prompt` mode
    fallback branch `sdlc/{{run_id}}`.
  - `executor` — implements tasks. Owns `git add`, `git commit`, `git push`
    after each task. Posts PR comment with implementation summary.
  - `qa` — verifies executor output. Posts verdict as PR review
    (`gh pr review`: approve/request-changes).
  - `tech-lead-review` — post-pipeline: final code review + CI gate check +
    merge. `run_on: always`. Handles missing-PR case gracefully (no-op with
    clear message if pipeline failed before PR creation).
  - `meta-agent` — prompt optimization, failure analysis.
- **Removed agents (FR-26):** `tech-lead-reviewer` (absorbed into tech-lead),
  `tech-lead-sds` (absorbed into tech-lead), `committer` (executor owns
  commits), `code-reviewer` (replaced by tech-lead-review).
- **SKILL.md frontmatter template:**
  ```yaml
  ---
  name: "agent-<name>"
  description: "<one-line role description>"
  disable-model-invocation: true
  ---
  ```
  - `disable-model-invocation: true` — prevents automatic invocation; agents
    are only triggered explicitly (pipeline or slash command).
- **Interfaces:**
  - Pipeline: engine reads `prompt:` path from `pipeline.yaml`, caches file
    content at config load time (`prompt_content`), passes inline via
    `claude --append-system-prompt`. Fallback to `--append-system-prompt-file`
    for template paths.
  - Interactive: Claude Code discovers skills via `.claude/skills/agent-<name>`
    symlinks → user invokes `/agent-<name>`.
- **Deps:** None (static content, versioned in git).

### 3.5 Skill Symlinks (`.claude/skills/agent-*`)

- **Purpose:** Bridge pipeline agents into Claude Code's skill discovery system,
  enabling `/agent-<name>` slash command invocability (FR-19 AC #2, AC #6).
- **Structure:** 7 symlinks: `.claude/skills/agent-<name>` → `../../agents/<name>/`
  (relative paths for portability within repo).
- **Agents exposed:** `agent-pm`, `agent-architect`, `agent-tech-lead`,
  `agent-executor`, `agent-qa`, `agent-tech-lead-review`, `agent-meta-agent`.
- **Removed (FR-26):** `agent-tech-lead-reviewer`, `agent-tech-lead-sds`,
  `agent-committer`, `agent-code-reviewer` (agents deleted),
  `agent-presenter` dangling symlink cleaned.
- **Added (FR-26):** `agent-tech-lead-review`.
- **Interfaces:** Claude Code skill loader reads symlink target directory,
  discovers `SKILL.md` frontmatter, registers slash command.
- **Deps:** `agents/<name>/SKILL.md` (symlink targets must exist).
- **Constraint:** Symlinks are Linux-native; devcontainer runtime ensures
  consistent behavior (no Windows symlink issues).

### 3.6 Pipeline Engine (`engine/`)

- **Purpose:** Configurable DAG-based pipeline executor. Replaces hardcoded
  shell script orchestration with YAML-driven node graph.
- **Modules:**
  - `types.ts` — type declarations (incl. `ValidationRule.type` union,
    `NodeConfig.run_on` (`"always"|"success"|"failure"`), `NodeConfig.phase`,
    `NodeConfig.env`, `NodeConfig.model` (per-node Claude model override),
    `PipelineDefaults.model` (default model for all nodes),
    `LoopNodeConfig.nodes` (inline body node definitions),
    `LoopResult.bodyResults`, `ErrorCategory` (structured failure enum),
    `NodeState.error_category`, `NodeState.cost_usd` (FR-32 per-node cost),
    `RunState.total_cost_usd` (FR-32 aggregated run cost))
  - `template.ts` — `{{var}}` interpolation for prompts/paths
  - `config.ts` — YAML parsing, schema validation, defaults merge,
    `run_on` normalization. `validateNode()`: if `run_on` present, must be
    one of `"always"|"success"|"failure"`; error:
    `Node '<id>' has invalid run_on value '<val>'. Must be one of: always, success, failure`.
    `normalizeRunOn()` pass (in `mergeDefaults()`):
    if `node.run_always === true && !node.run_on` → sets `run_on = "always"`;
    if both present, `run_on` wins; deletes `run_always` from config
    post-normalization (downstream code only sees `run_on`).
    Loop nodes: parses `nodes` sub-object, validates body node ordering
    (>1 entry requires `inputs` declarations), validates `condition_node`
    references valid key in `nodes`. Skips top-level existence check for
    body node IDs referenced in `inputs`.
  - `dag.ts` — topological sort, cycle detection, level grouping.
    Excludes loop body nodes (from `nodes` sub-object) from top-level
    graph; loop node itself remains in DAG with its declared `inputs`.
  - `validate.ts` — artifact validation rules (file_exists, not_empty,
    contains_section, custom_script, frontmatter_field)
  - `state.ts` — RunState persistence to `state.json`, resume logic,
    phase registry (`setPhaseRegistry()`, `clearPhaseRegistry()`,
    `getPhaseForNode()`), cost aggregation (`updateRunCost()` sums
    `nodes[*].cost_usd` → `total_cost_usd`; called from
    `markNodeCompleted()` when optional `costUsd` param provided, FR-32)
  - `agent.ts` — Claude CLI invocation, continuation loop, retry.
    `AgentRunOptions.model` and `InvokeOptions.model`: optional string for
    per-node model selection. `buildClaudeArgs()` emits `--model <value>` when
    `opts.model` is set AND `opts.resumeSessionId` is NOT set (resume inherits
    original model from session). Resolution: `node.model ?? defaults.model ??
    undefined` (computed in engine.ts/loop.ts, passed as field).
    `executeClaudeProcess()` uses `--output-format stream-json` and reads
    stdout line-by-line. Each JSON line appended to `streamLogPath` file
    (crash-resilient incremental write via `Deno.writeFile({ append: true })`).
    On `result` event: extracts `ClaudeCliOutput` fields (`result`,
    `session_id`, `is_error`, `total_cost_usd`, `duration_ms`,
    `duration_api_ms`, `num_turns`, `permission_denials`). `is_error` derived
    from `subtype !== "success"`. No `result` event → throws descriptive error.
    `streamLogPath` accepted as required parameter in `executeClaudeProcess()`.
    Append semantics: multiple invocations (continuation) with same path
    produce concatenated JSONL. `--verbose` flag removed from
    `buildClaudeArgs()` (unrelated to streaming, changes stderr globally)
  - `loop.ts` — loop node execution with condition extraction, per-iteration
    `AgentResult` accumulation into `LoopResult.bodyResults`.
    `buildLoopBodyOrder()` reads from inline `nodes` sub-object (replaces
    `body` array), topo-sorts body nodes by their `inputs` declarations.
    `buildContext()` resolves `inputs` against both sibling body nodes and
    top-level nodes. Accepts `streamLogPath` pattern from engine; computes
    iteration-qualified path `${nodeId}-iter-${i}.jsonl` per body node
    invocation; forwards to inner `runAgent()` calls
  - `hitl.ts` — HITL detection (`detectHitlRequest`) and poll loop
    (`runHitlLoop`); injectable `scriptRunner`/`claudeRunner` for testing
  - `human.ts` — terminal user input, abort logic
  - `git.ts` — commit helper, branch query,
    `rollbackUncommitted()` for pre-post-pipeline cleanup
  - `output.ts` — terminal output manager (quiet/normal/verbose), verbose
    methods for detailed agent-node diagnostics.
    `dryRunPlan(levels, labels, postPipelineNodeIds?, runOnMap?)`: renders
    regular DAG levels, then optional "Post-pipeline" section listing `run_on`
    nodes with their conditions (FR-28).
    `nodeResult(nodeId, output: ClaudeCliOutput)`: one-line agent result
    summary (FR-30). Guarded by `verbosity !== "quiet"`. Format:
    `[HH:MM:SS] <nodeId padded>  RESULT: <first line ≤120 chars> | cost=$X.XXXX | duration=Xs | turns=N`.
    Imports `ClaudeCliOutput` from `types.ts`
  - `engine.ts` — main executor: level iteration, parallel dispatch, verbose
    input resolution, node result summary display (FR-30),
    loop-node log saving via `onNodeComplete` callback,
    phase registry init (`setPhaseRegistry()` before `ensureRunDirs()` in both
    fresh and resume paths), phase subdir creation in `ensureRunDirs()`,
    pre-post-pipeline rollback + failed-node-id extraction.
    Dry-run path (FR-28): applies `collectPostPipelineNodes()` +
    `sortPostPipelineNodes()` + level filtering before calling
    `dryRunPlan()`, passing filtered levels and post-pipeline node IDs with
    `run_on` conditions — mirrors normal execution path's filtering logic.
    On config load: iterates all nodes; for loop nodes with `nodes`
    sub-object, flattens nested body node IDs into master ID list passed
    to `createRunState()` (ensures state.json tracks both top-level and
    nested body node IDs).
    Computes `streamLogPath = ${runDir}/logs/${nodeId}.jsonl` for each agent
    node; passes to `runAgent()`. For loop nodes: passes path pattern to
    loop executor for iteration-qualified derivation
  - `cli.ts` — CLI entry point: argument parsing, .env loading
  - `mod.ts` — public API re-exports
- **Interfaces:**
  - CLI: `deno task run [--prompt <text>] [--config <path>] [--resume <run-id>]
    [--dry-run] [-v|-q] [--env KEY=VAL] [--skip nodes] [--only nodes]`
  - Config: `.sdlc/pipeline.yaml` (YAML, version "1")
  - State: `.sdlc/runs/<run-id>/state.json` (JSON)
- **Node types:** `agent`, `merge`, `loop` (with inline `nodes` sub-object
    for body node definitions), `human`
- **Node flags:**
  - `run_on?: "always" | "success" | "failure"` — execution condition for
    post-pipeline nodes. When set, node is excluded from DAG levels and executes
    in a post-pipeline step after all DAG levels complete:
    - `"always"` — execute regardless of pipeline outcome. Used for meta-agent
      and tech-lead-review.
    - `"success"` — execute only if pipeline succeeded.
    - `"failure"` — execute only if pipeline failed. Skipped nodes get
      `markNodeSkipped()` status.
    Backward compat: `run_always: true` in YAML normalized to `run_on: "always"`
    by config loader (see `config.ts` normalization). `run_always` deleted
    post-normalization — not visible to engine runtime.
  - `phase?: string` — optional phase grouping label (e.g., `plan`, `impl`,
    `report`). When set, node artifacts are stored under
    `<run-dir>/<phase>/<node-id>/` instead of `<run-dir>/<node-id>/`. User-
    defined (no enum constraint). Validated: must be non-empty string if present.
    Backward-compatible: omitting `phase` preserves flat layout.
  - `env?: Record<string, string>` — optional node-level environment variables.
    Merged with global env (node-level overrides global defaults). Accessible
    in template context via `{{env.<key>}}`.
  - `model?: string` — optional per-node Claude model override (FR-27).
    Overrides `defaults.model`. Absent = defaults.model or CLI default (no flag).
    Emitted as `--model <value>` on initial invocations only; `--resume` calls
    exclude `--model` (session inherits original). Resolution chain:
    `node.model ?? defaults.model ?? undefined`. Centralized in
    `buildClaudeArgs()` via `InvokeOptions.model` field.
- **Commit strategy:** Engine does not auto-commit. Executor agent owns commits
  (`git add`, `git commit`, `git push` per task). No dedicated committer nodes.
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
    name via `git branch --show-current`. `rollbackUncommitted()`: executes
    `git checkout -- .` + `git reset HEAD`. No `git clean` — preserves
    untracked files (safe rollback). Used by engine pre-step before
    post-pipeline nodes on pipeline failure. Verbose calls for safety/commit
    stay in engine.
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

### 3.7 Phase Registry (`state.ts`)

- **Purpose:** Module-scoped mapping from nodeId → phase string, enabling
  `getNodeDir()` to resolve phase-aware artifact paths without signature change.
- **Data:** `phaseRegistry: Map<string, string>` — populated from
  `PipelineConfig` nodes' `phase` fields.
- **Interfaces:**
  - `setPhaseRegistry(config: PipelineConfig)` — iterates config nodes, builds
    map from `nodeId → node.phase` (skips nodes without `phase`). Called once at
    engine init (both fresh-run and `--resume` paths).
  - `clearPhaseRegistry()` — resets map. Used in tests for isolation.
  - `getPhaseForNode(nodeId: string): string | undefined` — lookup.
  - `getNodeDir(runId, nodeId)` — signature unchanged. Internally: if registry
    has phase for nodeId, returns `${runDir}/${phase}/${nodeId}/`; otherwise
    `${runDir}/${nodeId}/` (backward-compatible fallback).
- **Deps:** `types.ts` (`PipelineConfig`, `NodeConfig`).
- **Design rationale:** Module-scoped global state (not instance state) because
  `getNodeDir()` is a free function called from multiple contexts (engine,
  templates, tests). Single-instance engine guarantee prevents concurrent
  mutation. `clearPhaseRegistry()` ensures test isolation.

### 3.8 HITL Pipeline Scripts (`.sdlc/scripts/hitl-*.sh`)

- **Purpose:** Deliver agent questions to humans and poll for replies. Pipeline-
  specific (GitHub), not engine code. Engine invokes via configurable paths.
- **Scripts:**
  - `hitl-ask.sh` — render question JSON → markdown, post to GitHub issue.
    - Input: `--run-dir`, `--issue-source`, `--run-id`, `--node-id`,
      `--question-json`.
    - Extracts issue: `yq '.issue' "$RUN_DIR/$ISSUE_SOURCE"`.
    - Auto-detects repo: `gh repo view --json nameWithOwner`.
    - Renders: header, blockquoted question, numbered options, HTML marker
      `<!-- hitl:<run-id>:<node-id> -->`.
    - Posts via `gh issue comment <N> --body "$md"`.
    - Deps: `jq`, `yq`, `gh`.
  - `hitl-check.sh` — poll GitHub issue for human reply after marker.
    - Input: `--run-dir`, `--issue-source`, `--run-id`, `--node-id`,
      `--bot-login`.
    - Extracts issue: `yq '.issue' "$RUN_DIR/$ISSUE_SOURCE"`.
    - Auto-detects repo: `gh repo view --json nameWithOwner`.
    - Fetches comments: `gh api repos/{owner}/{repo}/issues/<N>/comments`.
    - jq filter: find comment with marker, then first subsequent non-bot comment.
    - Exit 0 + body on stdout = reply found. Exit 1 = no reply yet.
    - Deps: `jq`, `yq`, `gh`.
- **Interfaces:** Called by engine via `defaults.hitl.ask_script` /
  `defaults.hitl.check_script` paths in `pipeline.yaml`.

### 3.9 Pipeline Trigger

- **Purpose:** Single entry point for pipeline. PM agent autonomously triages
  open GitHub issues.
- **Interfaces:** CLI: `deno task run [--prompt "..."]`. PM selects
  highest-priority open issue via `gh`.
- **Deps:** Devcontainer, Claude CLI auth (OAuth or API key), `GITHUB_TOKEN`.

### 3.10 Dashboard Generator (`scripts/generate-dashboard.ts`) (FR-33)

- **Purpose:** Generate self-contained HTML dashboard summarizing pipeline run
  results. Reads `state.json` + per-node `logs/*.json`. Produces `index.html`
  in run directory with all CSS inlined (no CDN deps).
- **Functions:**
  - `readRunState(runDir)` — parse `state.json` → `RunState`
  - `readNodeLog(runDir, nodeId)` — parse `logs/<nodeId>.json` →
    `ClaudeCliOutput`
  - `renderCard(nodeId, state, log)` — HTML card: status badge, timing, cost,
    result summary via `<details><summary>` (first 3 lines preview, full text
    in details body). Single-line results render without `<details>` wrapper.
  - `renderHtml(runDir, state, logs)` — full page: run metadata header,
    phase-grouped card grid, inlined CSS
  - `escHtml(str)` — escape `<>&"'` for XSS-safe HTML embedding
- **Interfaces:**
  - CLI: `deno task dashboard --run-dir <path>`
  - Hook: `after:` on `optimize` node (`|| true` suffix for non-fatal)
- **Deps:** `engine/types.ts` (imports `RunState`, `ClaudeCliOutput` types
  for parsing). No runtime engine dependency — reads JSON files directly.

## 4. Data

- **Entities:**
  - Handoff Artifact: Structured Markdown (01-spec.md through 07-changelog.md)
  - Agent Log: Claude CLI JSON output (`.sdlc/runs/<run-id>/logs/<node-id>.json`)
  - Agent Prompt: SKILL.md with YAML frontmatter (`agents/<name>/SKILL.md`)
  - Run State: JSON (`.sdlc/runs/<run-id>/state.json`)
  - Pipeline Config: YAML (`.sdlc/pipeline.yaml`). Top-level keys: `name`,
    `version`, `defaults`, `phases` (FR-33), `nodes`. `phases` key declares
    named phase groups with member stage IDs (e.g., `plan: [specification,
    design, decision]`). Engine treats `phases` as opaque config data.
    Node IDs use activity-based naming (FR-33): `specification`, `design`,
    `decision`, `implementation`, `build`, `verify`, `tech-lead-review`, `optimize`
  - CommitResult: `{ commitHash, filesStaged: string[], message: string }`
    (enriched for verbose output)
  - ValidationRule: `{ type: "file_exists"|"file_not_empty"|"contains_section"|
    "custom_script"|"frontmatter_field", path?, field?, allowed?, ... }`
  - LoopResult: `{ ..., bodyResults: AgentResult[] }` — accumulated per-iteration
    agent results; consumed by `executeLoopNode()` callback for log saving
  - LoopNodeConfig: `{ ..., nodes: Record<string, NodeConfig> }` — inline
    body node definitions replacing `body: string[]`. Each key is a body
    node ID, value is its full node config. `condition_node` must reference
    a key in `nodes`. Body node ordering derived from `inputs` declarations
    via topo-sort (>1 entry requires at least one `inputs` reference to
    prevent disconnected graph with arbitrary order).
  - NodeState: `{ ..., cost_usd?: number }` — per-node cost from
    `ClaudeCliOutput.total_cost_usd`, set at completion via
    `markNodeCompleted()` optional param (FR-32)
  - RunState: `{ ..., total_cost_usd?: number }` — sum of all
    `nodes[*].cost_usd`, recomputed by `updateRunCost()` on each node
    completion (FR-32)
  - NodeConfig: `{ ..., run_on?: "always"|"success"|"failure", phase?: string,
    env?: Record<string, string>, model?: string }` — `run_on` for conditional
    post-pipeline execution; `phase` for artifact directory grouping; `env` for
    node-level env vars; `model` for per-node Claude model override (FR-27)
- **ERD:** N/A (file-based, no database).
- **Migration:** N/A.

### 4.1 Inter-Node Data Flow

- **Mechanism:** Filesystem-based. Each node reads input via `{{input.<node-id>}}`
  template variable pointing to predecessor's output directory. No manifest.
- **Directory structure:** `.sdlc/runs/<run-id>/[<phase>/]<node-id>/` per node
  output. Phase subdir present when node's `phase` field is set in config.
  Example with phases: `.sdlc/runs/abc/plan/specification/`, `.sdlc/runs/abc/impl/build/`.
  Without phase: `.sdlc/runs/abc/some-node/` (backward-compatible flat layout).
- **Validation:** Engine validates output via configurable rules (file_exists,
  file_not_empty, contains_section, custom_script, frontmatter_field) after
  each node. Validation failures trigger continuation (resume with error
  context) rather than immediate node failure.
  - `frontmatter_field`: Reads artifact file, extracts YAML frontmatter via
    `^---\n([\s\S]*?)\n---` regex, parses target field, checks value against
    allowed set. Config: `{ type: "frontmatter_field", path, field, allowed }`.
  - `contains_section`: Checks artifact file for presence of a markdown section.
    Supports `on_error: continue` (non-fatal). Used by meta-agent for
    "Fixes Applied" section validation.
  - Executor node uses `custom_script` validation rule (not `after` hook) for
    `deno task check`, enabling continuation-on-failure for check errors.
- **Context management:** Claude CLI auto-compression handles large input sets.
- **Template variables:** `{{node_dir}}`, `{{input.*}}`, `{{run_dir}}`,
  `{{run_id}}`, `{{args.*}}`, `{{env.*}}`, `{{loop.iteration}}`.
- **After-hook conventions:** Commands run from repo root (no `cd {{run_dir}}`
  prefix needed). Use `|| true` suffix to prevent hook failure from killing
  the node. Example (sds-update diff capture):
  `git diff HEAD -- documents/design.md > {{node_dir}}/04a-sds-diff.md;
  [ -s {{node_dir}}/04a-sds-diff.md ] || echo "No changes" >
  {{node_dir}}/04a-sds-diff.md || true`.

### 4.2 Commit Strategy

- **Branch:** Feature branch created by tech-lead agent (`git checkout -b
  sdlc/issue-<N>`). Fallback for `--prompt` mode: `sdlc/{{run_id}}`.
- **Commit cadence (FR-26):** Executor-owned commits. No dedicated committer
  agent nodes. Executor runs `git add`, `git commit`, `git push` after each
  task. Commit messages follow `sdlc(impl): <summary>` format.
- **PR creation:** Tech-lead creates draft PR (`gh pr create --draft`) before
  impl-loop. Executor pushes to same branch. QA posts PR review verdicts.
- **Post-pipeline:** Tech-lead-review performs final review + CI gate + merge.
- **Engine invariant:** Engine does NOT auto-commit (FR-14 preserved). All git
  operations happen inside agent prompts.
- **Failure behavior:** Failed nodes produce no commits. On_error: "fail" stops
  pipeline; "continue" proceeds to next nodes. Each failed `NodeState` gets
  `error_category?: ErrorCategory` — domain-agnostic enum:
  `continuations_exhausted | timeout | cli_crash | hook_failure | hitl_timeout |
  aborted | unknown`. Set by engine at failure point; downstream agents map
  categories to domain actions.
- **Resume:** `--resume <run-id>` skips completed nodes per state.json.

## 5. Logic

- **Algos:**
  - **Continuation Loop**: invoke agent -> validate -> if fail: resume with
    error context -> repeat (max N). If limit reached: fail node, trigger
    Meta-Agent.
  - **Executor+QA Loop**: Executor implements -> QA verifies -> if FAIL:
    Executor reads QA report, fixes -> repeat (max 3). Body nodes defined
    inline via loop's `nodes` sub-object (not top-level). Execution order
    determined by topo-sort of body nodes' `inputs` declarations.
  - **Secret Detection**: `gitleaks detect --no-git` runs as part of
    `deno task check` (`scripts/check.ts`). `allowFailure=true` — skips if
    gitleaks binary not found. Engine-level `safetyCheckDiff()` removed.
  - **Verbose Output Flow** (`-v` mode, agent nodes only): In
    `executeAgentNode()`: (1) resolve input artifact file paths+sizes from
    `ctx.input` dirs via `Deno.stat()` → `verboseInputs()`, (2) `runAgent()`
    (with `output` + `nodeId`) emits `verbosePrompt()` → Claude CLI executes →
    `verboseValidation()` → on failure: `verboseContinuation()` → retry.
    All verbose methods guarded by `verbosity !== "verbose"` — no-op in
    default/quiet. Output: human-readable stderr lines with section headers.
    Note: safety check and auto-commit verbose removed (engine no longer
    performs these operations).
  - **Loop Node Log Saving** (callback-based, no I/O in `loop.ts`):
    `runLoop()` accumulates `AgentResult` per body-node iteration into
    `LoopResult.bodyResults[]` (pure data, no filesystem ops). In
    `executeLoopNode()` (`engine.ts`), the `onNodeComplete` callback iterates
    `bodyResults`, calling `saveAgentLog()` with iteration-qualified nodeId
    (`${id}-iter-${i}`). Guard: only on `result.success && result.output`.
    `saveAgentLog()` errors caught and warned (non-fatal) — audit I/O must not
    break loop execution. `runDir` resolved via `getRunDir(this.state.run_id)`
    (already in engine scope).
  - **Node Result Summary** (FR-30): After agent node completion, engine
    displays one-line result summary via `OutputManager.nodeResult()`.
    Two call sites: (1) `executeNode()` — after `markNodeCompleted()`, for
    top-level agent nodes; `executeAgentNode()` returns `AgentResult | null`
    (was `boolean`), `executeNode()` extracts `.output` field.
    (2) `executeLoopNode()` `onNodeComplete` callback — calls `nodeResult()`
    when `result.output` exists. Suppressed in quiet mode. Shown in default
    and verbose modes.
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
  - **Phase Registry Init**: In `engine.ts` `run()`, `setPhaseRegistry(config)`
    called before `ensureRunDirs()`. On `--resume`: config re-loaded from
    `state.config_path`, then `setPhaseRegistry()` called (registry not persisted
    in `state.json` — always rebuilt from config). `ensureRunDirs()` creates
    phase subdirs (e.g., `plan/`, `impl/`, `report/`) when phases present.
    Phase assignment (default pipeline, FR-26, FR-33):
    - `plan`: specification, design, decision
    - `impl`: implementation (body nodes `build`, `verify` defined inline via
      `nodes` sub-object)
    - `report`: optimize, tech-lead-review
  - **Rollback Before Post-Pipeline Nodes**: When `pipelineSuccess === false`,
    engine calls `rollbackUncommitted()` before executing post-pipeline nodes.
    Reverts staged/unstaged modifications (`git checkout -- .` +
    `git reset HEAD`). Does NOT `git clean` — preserves untracked files.
    Extracts failed node ID via `getNodesByStatus(state, "failed")[0]`, writes
    to `{{run_dir}}/failed-node.txt` for meta-agent consumption.
  - **Post-Pipeline Node Collection & Ordering**: `collectPostPipelineNodes()`
    collects nodes where `run_on !== undefined` (replaces `run_always`-based
    collection). `sortPostPipelineNodes()` sorts them topologically using
    `inputs` field (reuses `toposort()` from `dag.ts`).
  - **Post-Pipeline Node Filtering**: Before executing each post-pipeline node,
    engine applies per-node filter based on `run_on` value and
    `pipelineSuccess`:
    - `run_on: "always"` → execute unconditionally.
    - `run_on: "success"` → skip if `!pipelineSuccess`, call
      `markNodeSkipped()`.
    - `run_on: "failure"` → skip if `pipelineSuccess`, call
      `markNodeSkipped()`.
  - **Meta-Agent Trigger**: Engine executes meta-agent via `run_on: "always"`.
    After all DAG levels complete (success or failure), engine collects
    post-pipeline nodes, sorts topologically, filters by condition (see above),
    and executes in order. Meta-agent reads `failed-node.txt` for failure
    context. Edits `agents/*/SKILL.md` to fix diagnosed problems. Produces
    minimal `07-changelog.md` listing applied fixes. Updates persistent memory
    in `documents/meta.md`. Posts 2-3 line summary to GitHub issue.
  - **Tech-Lead-Review Node**: Post-pipeline agent (`run_on: always`). Performs
    final code review, checks CI gates, merges PR if all pass. Handles
    missing-PR case gracefully (no-op with clear message when pipeline failed
    before tech-lead created PR).
  - **HITL via AskUserQuestion Interception** (FR-21):
    Engine detects agent HITL requests by inspecting `permission_denials` in
    Claude CLI JSON output. Flow:
    1. Agent node completes → engine parses JSON `result` event.
    2. If `permission_denials[]` contains entry with
       `tool_name == "AskUserQuestion"`: extract `tool_input.questions` (structured
       question with `question`, `header`, `options[]`, `multiSelect`) and
       `session_id` from result.
    3. Engine calls `defaults.hitl.ask_script` (external pipeline script) with
       question JSON + context args (repo, issue, run-id, node-id).
    4. Engine sets node state to `waiting` in `state.json`, saves `session_id`.
    5. Engine enters poll loop: `sleep(poll_interval)` → call
       `defaults.hitl.check_script` → if exit 0, read reply from stdout.
    6. Engine resumes agent: `claude --resume <session_id> -p "<reply>"
       --output-format json`. Agent sees full previous context + reply as new
       user message.
    7. On `timeout` exceeded: node marked `failed`, Meta-Agent triggered.
    Experimentally verified (see `documents/rnd/human-in-the-loop.md`):
    - `AskUserQuestion` denied in `-p` mode regardless of `--dangerously-skip-
      permissions` (cause: no terminal, not permissions).
    - Question JSON in `permission_denials[0].tool_input`: `{questions: [{
      question, header, options: [{label, description}], multiSelect}]}`.
    - `--resume <session_id> -p "<answer>"` preserves full session context;
      agent correctly interprets answer in context of its original question.
    - Cost per HITL roundtrip: ~$0.08 (question turn + resume turn).
    Pipeline config:
    ```yaml
    defaults:
      hitl:
        ask_script: .sdlc/scripts/hitl-ask.sh
        check_script: .sdlc/scripts/hitl-check.sh
        issue_source: plan/pm/01-spec.md
        poll_interval: 60
        timeout: 7200
    ```
- **Rules:**
  - Artifacts overwritten on re-run (git history preserves previous).
  - QA iteration numbering restarts on re-run.
  - Meta-Agent runs on both success and failure.
  - Meta-Agent auto-applies prompt improvements to `agents/*/SKILL.md`.
    Human review at PR merge via tech-lead-review.

## 6. Non-Functional

- **Scale:** Single pipeline per issue. Sequential stages (no parallel agents).
- **Fault:** Stage failure stops pipeline, Meta-Agent analyzes, failure reported
  on issue.
- **Sec:** Secret detection via `gitleaks detect --no-git` in `deno task check`
  (`scripts/check.ts`). Engine-level scope checks removed. Agents run with
  local user's permissions.
- **Logs:** Full transcripts per stage in `.sdlc/runs/<run-id>/logs/`.

## 7. Constraints

- **Simplified:** Pipeline runs sequentially (no parallel stages in v1).
- **Deferred:** Multi-repo support. Parallel pipelines for multiple issues.
  Issue size/complexity limits. Cost budget limits and alerts (per-node cost
  aggregation implemented in FR-32; budget enforcement deferred).
