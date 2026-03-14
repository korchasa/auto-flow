# SDS: SDLC Pipeline

## 1. Intro

- **Purpose:** Implementation details for the SDLC pipeline (example use case
  of auto-flow engine).
- **Rel to SRS:** Implements FRs from `documents/requirements-sdlc.md`.

## 2. Architecture

### 2.1 Legacy: Shell Script Pipeline (DEPRECATED — pre-FR-26)

```mermaid
graph LR
    Issue["GitHub Issue"] --> CLI["deno task run"]
    CLI --> S1["Stage 1: PM"]
    S1 --> S2["Stage 2: Tech Lead"]
    S2 --> S3["Stage 3: Reviewer"]
    S3 --> S4["Stage 4: Architect"]
    S4 --> S5["Stage 5: SDS Update"]
    S5 --> S6["Stage 6-7: Developer+QA Loop"]
    S6 --> S8["Stage 8: Presenter"]
    S8 --> S9["Stage 9: Meta-Agent"]
    S6 -->|"FAIL after max"| S9

    subgraph Devcontainer["Devcontainer"]
        S1; S2; S3; S4; S5; S6; S8; S9
    end
```

### 2.2 Pipeline DAG (FR-26, FR-33)

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
  `tech-lead`→`decision`, `impl-loop`→`implementation`, `developer`→`build`,
  `qa`→`verify`, `tech-lead-review`→`tech-lead-review`, `meta-agent`→`optimize`.
- **Phases (FR-33):** Top-level `phases:` key in `pipeline.yaml` declares named
  phase groups. Each phase lists member stage IDs:
  - `plan`: [specification, design, decision]
  - `impl`: [implementation]
  - `report`: [tech-lead-review, optimize]
  Phase grouping is declarative config; engine treats it as opaque data. Enables
  future phase-level `run_on` semantics and cleaner artifact reporting.

- **Subsystems:**
  - **Agent Runtime**: Claude Code CLI invocations with role-specific prompts
    from `.claude/skills/agent-<name>/SKILL.md` (canonical, agentskills.io-
    compliant; no symlinks)
  - **Artifact Store**: Git-tracked files in `.sdlc/runs/<run-id>/[<phase>/]<node-id>/`
    (phase subdir present when node has `phase` field in config)
  - **Legacy Shell Scripts** (`.sdlc/scripts/`): Preserved for backward
    compatibility, superseded by engine

## 3. Components

### 3.1 Docker Image

- **Purpose:** Single runtime environment for all stages.
- **Interfaces:** Contains `claude` CLI, `deno`, `git`, `gh`, `gitleaks`.
- **Deps:** Node.js (for claude CLI install), Deno runtime.

### 3.2 Stage Scripts (`.sdlc/scripts/`) — DEPRECATED

- **Status:** Formally deprecated. Superseded by Deno/TypeScript pipeline engine
  (`engine/`). Retained for backward compatibility only. Use `deno task run`.
- **Purpose:** Legacy orchestration for each pipeline stage: prepare input,
  invoke agent, validate, continue, commit.
- **AGENT_PROMPT paths:** Updated to `.claude/skills/agent-<name>/SKILL.md`
  (canonical, post-FR-36 migration).
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

### 3.4 Agent Skills (`.claude/skills/agent-*`) (FR-36)

- **Purpose:** Versioned system prompts defining each agent's role and behavior.
  Each agent lives in `.claude/skills/agent-<name>/SKILL.md` (canonical,
  agentskills.io-compliant). Dual-use: pipeline-driven (via engine `prompt:`
  config) and interactive (via Claude Code `/agent-<name>` slash commands).
- **Directory structure:** `.claude/skills/agent-<name>/SKILL.md` — 7 agents:
  - `agent-pm` — triages open GitHub issues, selects highest-priority, produces
    spec.
  - `agent-architect` — design-solution role: produces implementation plan with
    2-3 variants, affected files, effort estimates, risk analysis.
  - `agent-tech-lead` — critique + decision + SDS update + branch creation
    (`git checkout -b sdlc/issue-<N>`) + draft PR (`gh pr create --draft`) +
    task breakdown from selected variant. Uses `{{run_id}}` for `--prompt` mode
    fallback branch `sdlc/{{run_id}}`.
  - `agent-developer` — implements tasks. Owns `git add`, `git commit`,
    `git push` after each task. Posts PR comment with implementation summary.
  - `agent-qa` — verifies developer output. Posts verdict as PR review
    (`gh pr review`: approve/request-changes).
  - `agent-tech-lead-review` — post-pipeline: final code review + CI gate
    check + merge. `run_on: always`. Handles missing-PR case gracefully.
  - `agent-meta-agent` — prompt optimization, failure analysis.
- **Removed agents (FR-26):** `tech-lead-reviewer`, `tech-lead-sds`,
  `committer`, `code-reviewer`.
- **SKILL.md frontmatter (agentskills.io-compliant):**
  ```yaml
  ---
  name: "agent-<name>"
  description: "<one-line role description>"
  compatibility: ["claude-code"]
  allowed-tools: []
  ---
  ```
  - `compatibility: ["claude-code"]` — declares runtime compatibility.
  - `allowed-tools: []` — no automatic tool grants; agents use tools available
    in their execution context.
- **Interfaces:**
  - Pipeline: engine reads `prompt:` path from `pipeline.yaml` (now
    `.claude/skills/agent-<name>/SKILL.md`), caches file content at config load
    time (`prompt_content`), passes inline via
    `claude --append-system-prompt`. Fallback to `--append-system-prompt-file`
    for template paths.
  - Interactive: Claude Code discovers skills directly from
    `.claude/skills/agent-<name>/SKILL.md` → user invokes `/agent-<name>`.
    No symlinks required (canonical location).
- **Agent Execution Summary (FR-40, FR-42):** All 7 agents must produce a `## Summary`
  section in their output artifacts. Content: 2-5 bullet points (actions taken,
  key decisions, artifacts produced, issues encountered). 6 agents (PM,
  Architect, Tech Lead, QA, Meta-Agent, Tech Lead Review) append `## Summary`
  to their markdown artifact files. Developer includes summary in commit message
  body (no separate artifact file). Pipeline enforces via `contains_section:
  Summary` validation on 6 nodes (`specification`, `design`, `decision`,
  `verify`, `optimize`, `tech-lead-review`). Developer (`build`) excluded from
  file-based validation — uses existing `custom_script: deno task check`.
- **Voice Convention (FR-40, FR-43):** Each SKILL.md contains a `## Voice`
  section (after `# Role:` heading, before `## Responsibilities`) mandating
  first-person narrative ("I") in all agent outputs. Scope explicitly includes
  GitHub issue comments, PR descriptions, and status updates (FR-43). Passive/
  third-person prohibited in narrative text. YAML frontmatter and code blocks
  excluded. Each agent's section includes 3 role-specific correct vs incorrect
  example pairs: 2 anchored to artifacts/reports, 1 targeting GitHub
  interactions specifically (e.g., PM: "I started the specification phase" not
  "Specification phase started"; QA: "I verified all criteria" not "All criteria
  were verified"). Hardcoded `gh issue comment --body` templates in SKILL.md
  files must also use first-person (FR-43).
- **Migration (FR-36):** Complete. Formerly `agents/<name>/SKILL.md` with
  symlinks from `.claude/skills/`. Migrated to canonical `.claude/skills/`
  layout; `agents/` directory removed; symlink indirection eliminated. Legacy
  stage scripts formally deprecated (co-location N/A for deprecated scripts).
- **Voice directive (FR-40):** Each SKILL.md contains `## Voice` section
  (before `## Rules`) mandating first-person ("I") narrative in all prose
  output. Shared 3-line core directive (first-person mandate, prohibited
  patterns, scope exclusions for YAML/code/tables) + 1 agent-specific
  correct/incorrect example pair per file. Applies to: handoff artifacts,
  PR/issue comments, QA reports, spec files. Excludes: YAML frontmatter,
  code blocks, structured data, tables.
- **Deps:** None (static content, versioned in git).

### 3.5 HITL Pipeline Scripts (`.sdlc/scripts/hitl-*.sh`)

- **Purpose:** Deliver agent questions to humans and poll for replies. Pipeline-
  specific (GitHub), not engine code. Engine invokes via configurable paths.
- **Scripts:**
  - `hitl-ask.sh` — render question JSON → markdown, post to GitHub issue.
    - Input: `--run-dir`, `--artifact-source`, `--run-id`, `--node-id`,
      `--question-json`.
    - Extracts issue: `yq '.issue' "$RUN_DIR/$ISSUE_SOURCE"`.
    - Auto-detects repo: `gh repo view --json nameWithOwner`.
    - Renders: header, blockquoted question, numbered options, HTML marker
      `<!-- hitl:<run-id>:<node-id> -->`.
    - Posts via `gh issue comment <N> --body "$md"`.
    - Deps: `jq`, `yq`, `gh`.
  - `hitl-check.sh` — poll GitHub issue for human reply after marker.
    - Input: `--run-dir`, `--artifact-source`, `--run-id`, `--node-id`,
      `--exclude-login`.
    - Extracts issue: `yq '.issue' "$RUN_DIR/$ISSUE_SOURCE"`.
    - Auto-detects repo: `gh repo view --json nameWithOwner`.
    - Fetches comments: `gh api repos/{owner}/{repo}/issues/<N>/comments`.
    - jq filter: find comment with marker, then first subsequent non-bot comment.
    - Exit 0 + body on stdout = reply found. Exit 1 = no reply yet.
    - Deps: `jq`, `yq`, `gh`.
- **Interfaces:** Called by engine via `defaults.hitl.ask_script` /
  `defaults.hitl.check_script` paths in `pipeline.yaml`.

### 3.6 Pipeline Trigger

- **Purpose:** Single entry point for pipeline. PM agent autonomously triages
  open GitHub issues.
- **Interfaces:** CLI: `deno task run [--prompt "..."]`. PM selects
  highest-priority open issue via `gh`.
- **Deps:** Devcontainer, Claude CLI auth (OAuth or API key), `GITHUB_TOKEN`.

### 3.7 Dashboard Generator (`scripts/generate-dashboard.ts`) (FR-33, FR-35, FR-38, FR-40, issue #15)

- **Purpose:** Generate self-contained HTML dashboard summarizing pipeline run
  results. Reads `state.json` + per-node `logs/*.json`. Produces `index.html`
  in run directory with all CSS inlined (no CDN deps).
- **Functions:**
  - `readRunState(runDir)` — parse `state.json` → `RunState`
  - `readNodeLog(runDir, nodeId)` — parse `logs/<nodeId>.json` →
    `ClaudeCliOutput`
  - `renderCard(nodeId, state, log, streamLogHref?)` — HTML card: status badge,
    timing, cost, result summary via `<details><summary>` (first 3 lines
    preview, full text in details body). Single-line results render without
    `<details>` wrapper. When `streamLogHref` provided: renders
    `<a class="log-link" href="${escHtml(streamLogHref)}">stream log</a>` after
    card-meta div. Omitted when absent (backward-compatible).
  - `renderHtml(runDir, state, logs, streamLogHrefs?)` — full page: run metadata
    header, phase-grouped card grid, inlined CSS. 4th param
    `streamLogHrefs?: Record<string, string>` maps nodeId → relative href;
    threaded to each `renderCard()` call via lookup
  - `escHtml(str)` — escape `<>&"'` for XSS-safe HTML embedding
  - `computeTimeline(state: RunState)` — iterates `state.nodes`, parses
    `started_at` ISO timestamps, computes `offsetPct`/`widthPct` relative to
    run start/total duration. Identifies bottleneck (max `duration_ms`). Omits
    nodes with missing timing. Returns `{nodeId, offsetPct, widthPct,
    durationMs, isBottleneck}[]`
  - `renderTimeline(bars)` — generates Gantt-style HTML timeline section:
    container with relative positioning, bars absolutely-positioned per row
    (sorted by `started_at`). Bottleneck bar gets `.timeline-bottleneck` CSS
    class. Labels sanitized via `escHtml()`. Timeline CSS appended to existing
    `CSS` const (inlined, no CDN deps). Integrated into `renderHtml()` between
    header and card grid (FR-38)
- **Stream log link flow (issue #15):** CLI entry point scans each node
  directory for `stream.log` existence via `Deno.stat()`. For nodes with phases,
  computes relative path as `<phase>/<nodeId>/stream.log`; without phase:
  `<nodeId>/stream.log`. Builds `Record<string, string>` href map, passes to
  `renderHtml()` → threaded to `renderCard()`. CSS: `.log-link` class (monospace,
  smaller font, muted color — distinct from result text).
- **Functions (continued):**
  - `computeCostBars(state: RunState)` — filters `state.nodes` by
    `cost_usd > 0`, computes proportional `widthPct` relative to max cost.
    Returns `{nodeId: string, costUsd: number, widthPct: number}[]` (FR-40)
  - `renderCostChart(bars, totalCost)` — inline SVG horizontal bar chart.
    Each bar: `<rect>` with proportional width, `<text>` label (node ID via
    `escHtml()`), cost value annotation. Total cost header. Empty bars →
    "No cost data" message (mirrors timeline empty-state). Cost chart CSS
    appended to `CSS` const. Integrated into `renderHtml()` between timeline
    and `<main>` card grid (FR-40)
- **Interfaces:**
  - CLI: `deno task dashboard --run-dir <path>`
  - Hook: `after:` on `optimize` node (`|| true` suffix for non-fatal)
- **Deps:** `engine/types.ts` (imports `RunState`, `ClaudeCliOutput` types
  for parsing). No runtime engine dependency — reads JSON files directly.

## 4. Data

### 4.1 Commit Strategy

- **Branch:** Feature branch created by tech-lead agent (`git checkout -b
  sdlc/issue-<N>`). Fallback for `--prompt` mode: `sdlc/{{run_id}}`.
- **Commit cadence (FR-26):** Developer-owned commits. No dedicated committer
  agent nodes. Developer runs `git add`, `git commit`, `git push` after each
  task. Commit messages follow `sdlc(impl): <summary>` format.
- **PR creation:** Tech-lead creates draft PR (`gh pr create --draft`) before
  impl-loop. Developer pushes to same branch. QA posts PR review verdicts.
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

- **Developer+QA Loop**: Developer implements -> QA verifies -> if FAIL:
  Developer reads QA report, fixes -> repeat (max 3). Body nodes defined
  inline via loop's `nodes` sub-object (not top-level). Execution order
  determined by topo-sort of body nodes' `inputs` declarations.
- **Secret Detection**: `gitleaks detect --no-git` runs as part of
  `deno task check` (`scripts/check.ts`). `allowFailure=true` — skips if
  gitleaks binary not found. Engine-level `safetyCheckDiff()` removed.
- **Meta-Agent Trigger**: Engine executes meta-agent via `run_on: "always"`.
  After all DAG levels complete (success or failure), engine collects
  post-pipeline nodes, sorts topologically, filters by condition, and executes
  in order. Meta-agent identifies failed nodes via `state.json`
  (`nodes[*].status === "failed"`). Edits `.claude/skills/agent-*/SKILL.md` to fix diagnosed problems. Produces
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
  Pipeline config:
  ```yaml
  defaults:
    on_failure_script: .sdlc/scripts/rollback-uncommitted.sh
    hitl:
      ask_script: .sdlc/scripts/hitl-ask.sh
      check_script: .sdlc/scripts/hitl-check.sh
      artifact_source: plan/pm/01-spec.md
      poll_interval: 60
      timeout: 7200
  ```
- **Rules:**
  - Artifacts overwritten on re-run (git history preserves previous).
  - QA iteration numbering restarts on re-run.
  - Meta-Agent runs on both success and failure.
  - Meta-Agent auto-applies prompt improvements to `.claude/skills/agent-*/SKILL.md`.
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

## 8. SRS Evidence Status

All FR evidence for issue #15 is complete:

- **FR-35 (Dashboard Result Summary Display):** Implemented. SRS section 3.34
  evidence recorded — `scripts/generate-dashboard.ts` (`renderCard`,
  `escHtml`). Tests in `scripts/generate-dashboard_test.ts`.
- **FR-38 (Timeline Visualization):** Implemented. SRS section 3.37 evidence
  recorded — `scripts/generate-dashboard.ts` (`computeTimeline`,
  `renderTimeline`, `.timeline-bottleneck` CSS). Tests in
  `scripts/generate-dashboard_test.ts`. Evidence committed in `e493cbb`.
- **FR-39 (Repeated File Read Warning):** Implemented. SRS section 3.38
  evidence recorded — `engine/agent.ts` (`FileReadTracker` class). Tests in
  `engine/agent_test.ts`. Evidence committed in `e493cbb`.
- **FR-40 (Dashboard Stream Log Links):** Implemented. SRS section 3.39
  evidence recorded — `scripts/generate-dashboard.ts` (`streamLogHref`,
  `.log-link` CSS). Tests in `scripts/generate-dashboard_test.ts`.
- **FR-42 (Agent Output Summary):** Already implemented. All 7 agent SKILL.md
  files document `## Summary` in output format. `pipeline.yaml` enforces
  `contains_section: Summary` on 6 agent nodes (`specification`, `design`,
  `decision`, `verify`, `optimize`, `tech-lead-review`); Developer (`build`)
  enforced via `custom_script: deno task check`. Evidence:
  `.claude/skills/agent-*/SKILL.md` (7 files), `.sdlc/pipeline.yaml` (7 rules).
- **FR-43 (Agent First-Person Voice — GitHub Interactions):** Voice sections
  strengthened with explicit GitHub interaction scope + third example pair per
  agent. Hardcoded `gh issue comment --body` templates in PM, Architect, Tech
  Lead SKILL.md files updated to first-person. Evidence:
  `.claude/skills/agent-*/SKILL.md` (7 files, `## Voice` sections).

FR-S1 evidence (issue #100):

- **FR-S1 (Pipeline Trigger):** All 4 acceptance criteria marked `[x]` with
  evidence. `engine/cli.ts:36-76` (CLI entry point, flags),
  `.claude/skills/agent-pm/SKILL.md` (issue frontmatter mandate).

Engine FR evidence (issue #99):

- **FR-E2, FR-E10, FR-E11, FR-E13, FR-E19:** Documentation-only — mark
  existing implementations with evidence in `documents/requirements-engine.md`.
  No code or design changes. Variant A (batch single-pass) selected.
