<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Meta (Intro, NFR, Interfaces, Proposals)


# SRS: Engine

## 0. Resolved Design Decisions

- **Cost limits:** Workflow-wide `--budget <USD>` CLI cap; per-node `budget.max_usd` / `budget.max_turns` in YAML config. Engine aborts run or fails node on cap exceeded. See FR-E47.
- **Rollback:** Manual operation (no automated rollback).
- **Retry logic:** 3 attempts with exponential backoff for external API calls (`claude`, `gh`) in `lib.sh`.
- **Target project:** Engine is domain-agnostic; no project-specific logic. Workflow configs define domain workflows.
- **Concurrent workflows:** Per-workflow-folder lock (FR-E54). One concurrent run per `<workflowDir>` (the folder containing `workflow.yaml`); distinct workflow folders run independently in parallel. Within one folder, runs serialize via `<workflowDir>/runs/.lock`.

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

- **System context:** Operates as a local Deno engine process triggered by CLI command (`deno task run [--prompt "..."]`). Reads workflow DAG config (YAML), executes nodes sequentially via the selected agent runtime (`claude` by default, `opencode` also supported), validates outputs, manages continuations and resume. Domain-agnostic: no git, GitHub, or SDLC logic in engine code.
- **Assumptions and constraints:**
  - Each agent is stateless between runs — all context comes from input artifacts and its system prompt.
  - Runtime selection is resolved by precedence: node → enclosing loop node → workflow defaults → `claude`.
  - Engine is workflow-independent: MUST NOT depend on any specific workflow config. One engine, many workflows.
  - Engine MUST NOT contain references to concrete artifact filenames, node names, or domain-specific logic.

## 3. Functional Requirements



## 4. Non-Functional Requirements

- **Isolation:** Each agent runs in its own runtime process with no shared state except file artifacts. Concurrency unit = workflow folder: at most one run per `<workflowDir>` at a time, enforced by the per-workflow PID lock (FR-E54). Distinct workflow folders in the same repo run independently in parallel — each owns its `runs/`, `worktrees/`, and `state.json` namespace.
- **Fault tolerance:** If a node fails (agent error, timeout, continuation limit exhausted), the workflow stops. Post-workflow nodes with `run_on` config execute based on outcome. Manual restart via `--resume <run-id>`.
- **Timeouts:** Each node has a configurable timeout (default: 30 min). Engine enforces timeout per node. On timeout, node is treated as failed.
- **Observability:** 3 verbosity levels (`-q`/default/`-v`/`-s`); status lines with timestamps; per-node result summaries; full logs stored per node in `<run-dir>/logs/`.
- **Domain-agnostic:** Engine MUST NOT contain git, GitHub, branch, PR, or any domain-specific logic. All domain workflows implemented via agent nodes wired in workflow YAML configs.
- **Workflow-independent:** Engine MUST NOT depend on any specific workflow config. One engine, many workflows. No references to concrete node names, artifact filenames, or workflow structure.

## 5. Interfaces

- **CLI entry:** `deno task run [--prompt "..."]`. Flags: `--resume <run-id>`, `--dry-run`, `-v` (verbose), `-q` (quiet), `-s` (semi-verbose), `--config <path>`, `--skip <node>`, `--only <node>`, `--env <K=V>`, `--budget <USD>` (workflow cost cap; see FR-E47).
- **Agent runtime:** runtime selected by config. Supported: `claude`
  (default), `opencode`, `cursor`. CLI invocation contracts per runtime
  documented in the sibling `korchasa/ai-ide-cli` repo
  (`documents/requirements/00-meta.md` §5).
- **Config format:** YAML workflow config with `defaults` (global settings) and `nodes` (DAG definition). Node types: `agent`, `loop`, `merge`, `human`. Fields per type include `runtime`, `runtime_args`, `prompt`, `inputs`, `validate`, `model`, `run_on`, `after`/`before` hooks. `permission_mode` is Claude-only. Config validation rejects non-claude runtimes with unsupported permission modes.
- **State:** `<run-dir>/state.json` — node statuses (`pending`/`running`/`completed`/`failed`/`waiting`/`skipped`), session IDs, cost data, timing, HITL question JSON.
- **Template variables:** `{{input.<node-id>}}` (node output dir), `{{node_dir}}` (current node output dir), `{{run_dir}}` (run root), `{{run_id}}`, `{{loop.iteration}}` (loop body only), `{{env.<KEY>}}`, `{{file("path")}}` (inline file content, path relative to `workDir`; FR-E32), `{{flow_file("path")}}` (inline file content, path relative to current workflow folder `workDir/dirname(config_path)`; FR-E55).

## 6. Proposals (Non-Binding)

Design ideas captured for discussion; not committed work. Promote to FR-E only after explicit decision.

### P1: Frontmatter Schema Validation Rule (`frontmatter_schema`)

- **Description:** New validation rule `type: frontmatter_schema` that validates an artifact's YAML frontmatter against an inline JSON Schema. Extends existing `frontmatter_field` (FR-E38 covers presence only) with typed constraints: enums, integer/number types, min/max, array length, pattern matching.
- **Motivation:** Today workflows can require a frontmatter field exists, but cannot constrain its type or allowed values. Example gap: `verdict` field in QA report must be `PASS` or `FAIL` — enforced today by string compare downstream, not at validation time. Similarly, `issue: <N>` could be `"N/A"` string and pass `frontmatter_field` check.
- **Comparison with Claude CLI `--json-schema`:** `--json-schema` validates the CLI's **final `result` response**, not file artifacts. Requires rewriting agent prompts to return JSON instead of writing markdown files. Destructive to current file-based artifact chain (PM/Architect/Dev/QA all produce markdown documents consumed by downstream nodes and dashboards). Comparison on three real SDLC nodes showed current YAML validate syntax is shorter and more declarative for document nodes; parity only for gate nodes (QA verdict). `frontmatter_schema` keeps the file channel, closes the typing gap, runs locally in engine with no Claude CLI dependency.
- **Sketch:**
  ```yaml
  validate:
    - type: frontmatter_schema
      path: "{{node_dir}}/05-qa-report.md"
      schema:
        type: object
        required: [verdict, summary]
        properties:
          verdict: {enum: [PASS, FAIL]}
          summary: {type: string, minLength: 50}
  ```
- **Open questions:** JSON Schema library choice (Deno-native vs npm bridge), error message UX, interaction with `frontmatter_field` (replace / coexist).
- **Source:** R&D walkthrough 2026-04-10, [documents/rnd/claude-code-best-practices-for-engine.md § Topic 6](rnd/claude-code-best-practices-for-engine.md).

### P2: Per-Node Worktree Isolation for Safe Parallel Execution

- **Description:** Optional per-node `isolation: node_worktree` field that creates a nested git worktree per node, extending existing FR-E24 (run-level worktree) with finer I/O isolation. Enables safe parallel execution of sibling nodes that write to overlapping file paths.
- **Motivation:** Sibling independent nodes on the same DAG level already run in parallel via `Promise.allSettled` with `max_parallel` semaphore (`engine/engine.ts:363-366`). However, they share the run-level worktree — any two agents writing to the same file race each other. Current SDLC workflow avoids this because parallel sibling nodes are rare (mostly linear PM → Architect → Tech Lead → loop(Dev → QA) → Review). P2 unlocks safe parallelism for workflows that would benefit (e.g., parallel explore-backend + explore-frontend, or adversarial design-review alongside design).
- **Sketch:**
  ```yaml
  nodes:
    explore-backend:
      type: agent
      isolation: node_worktree
      # ...
    explore-frontend:
      type: agent
      isolation: node_worktree
      # ...
  ```
- **Breakdown (three phases):**
  1. **Node-level worktree isolation.** `isolation: node_worktree | shared` field; engine creates nested worktree per node, merges on success, preserves on failure. Works for top-level nodes only (not loop body for start).
  2. **Parallel-safe I/O + budget.** Atomic `state.json` updates; concurrent cost aggregation; SIGTERM propagation to all child processes; integration tests for race conditions.
  3. **Merge semantics.** How the nested worktree's changes flow back into the run-level worktree on success: fast-forward, 3-way merge, or explicit `allowed_paths` disjoint enforcement.
- **Risks:**
  - Nested git worktree — may or may not be supported. Fallback: temp dir + rsync instead of `git worktree add`.
  - Merge conflicts when parallel nodes write overlapping files. Mitigation: `allowed_paths` enforcement (FR-E37) with fail-fast on overlap detection at config load.
  - `state.json` concurrent writes require atomic replace or fine-grained locking.
- **Open questions:** Is there a concrete SDLC workflow use case that needs this? Nested worktree vs rsync? Failure semantics — does one failed parallel node cancel siblings or let them finish?
- **Source:** R&D walkthrough 2026-04-10, [documents/rnd/claude-code-best-practices-for-engine.md § Topic 3](rnd/claude-code-best-practices-for-engine.md).

### P3: Permission Prompt Interception via `--permission-prompt-tool`

- **Description:** Engine starts a dedicated HITL MCP server exposing a `handle_permission_request` tool; passes `--permission-prompt-tool <tool>` to Claude CLI spawns. When Claude needs to request a permission (e.g. running an untrusted Bash command), the request flows through the MCP server → engine HITL pipeline → operator reply → result back to Claude. Extends or reuses existing OpenCode HITL MCP infrastructure (`engine/opencode-hitl-mcp.ts`).
- **Motivation:** Current SDLC workflow sets `permission_mode: bypassPermissions`, so all permission prompts are auto-approved. This is fine for dogfooding but blocks future workflows that want **strict interactive permission** with human approval (e.g., security-sensitive pipelines, CI gate flows). In those workflows, without `--permission-prompt-tool`, a Claude headless process hitting a permission prompt either hangs or fails silently.
- **Current state:** `AskUserQuestion` tool is already intercepted via stream-json tool_use detection (`engine/hitl.ts`). Permission prompts are a separate channel — not tool_use events — and require the dedicated CLI flag.
- **Sketch:**
  ```yaml
  defaults:
    permission_mode: default   # prompts enabled, not bypassed
    hitl:
      ask_script: scripts/hitl/ask.sh
      check_script: scripts/hitl/check.sh
  # engine passes --permission-prompt-tool to spawn
  ```
- **Open questions:** Single MCP server shared across Claude + OpenCode or separate? Permission response format (allow / deny / remember)? Timeout behavior when operator does not respond?
- **Status:** Not required for current SDLC (`bypassPermissions`). Promote to FR-E only when a concrete workflow with strict permission requirements is proposed.
- **Source:** R&D walkthrough 2026-04-10, [documents/rnd/claude-code-best-practices-for-engine.md § Topic 10](rnd/claude-code-best-practices-for-engine.md).

### P4: `--bare` Flag for Faster Claude CLI Startup

- **Description:** Engine passes `--bare` to every Claude CLI spawn. Claude skips ancestor `CLAUDE.md`, `.claude/settings.json`, `.mcp.json`, and project agent discovery — up to 10× faster startup per Boris Cherny ([Boris 15 tips — Tip 12](https://github.com/shanraisshan/claude-code-best-practice/blob/main/tips/claude-boris-15-tips-30-mar-26.md)). Engine must explicitly inject anything previously auto-loaded.
- **Motivation:** Faster per-node startup reduces wallclock time for workflows with many short agent nodes. Claude spawn currently pays discovery cost on every invocation; engine already knows exactly what it wants each node to load.
- **Blockers:**
  1. Engine uses `--agent <name>` which relies on Claude discovering `.claude/agents/<name>.md`. `--bare` disables that discovery. Must either (a) read agent file inline and concatenate into `--append-system-prompt`, losing Claude's frontmatter processing (`tools`, `skills`, `memory`, `mcpServers`), or (b) construct explicit `--settings <path>` and `--mcp-config <path>` per spawn.
  2. Project `CLAUDE.md` no longer auto-appends. Engine must inject explicitly — currently engine relies on `--append-system-prompt` for per-node content but lets Claude add project CLAUDE.md on top.
  3. MCP servers from `.mcp.json` no longer load. Must pass `--mcp-config <path>` for every node that needs MCPs.
- **ROI analysis:** For long-running agent turns (~30s typical), saving 400-500ms on startup is ~1-2% total. For short reasoning-only nodes (~5s), savings grow to 7-8%. Current SDLC has mostly long turns — low ROI. Benefit scales with node count and turn brevity.
- **Open questions:** Is there a profiled bottleneck that startup dominates? Cleanest way to preserve `--agent` semantics (especially tools allowlist and per-agent frontmatter)? How to handle multi-root `CLAUDE.md` override policy under explicit injection?
- **Status:** Defer until a concrete workflow shows startup overhead as dominant cost. Complements the CLAUDE.md ancestor scan work (#195) — both revolve around making Claude's implicit loading explicit.
- **Source:** R&D walkthrough 2026-04-10, [documents/rnd/claude-code-best-practices-for-engine.md § Topic 8](rnd/claude-code-best-practices-for-engine.md).

