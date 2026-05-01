<!-- section file — index: [documents/requirements-sdlc.md](../requirements-sdlc.md) -->

# SRS SDLC — Dashboard and Observability


### 3.16 FR-S16: Dashboard Result Summary Display

- **Description:** HTML dashboard cards for workflow nodes must display at least the first 3 lines of the agent result text. Long results must be collapsible (expand on click). Single-line results display inline without unnecessary whitespace. Prior implementation used `white-space: nowrap; text-overflow: ellipsis` truncating multi-line results to ~40 chars.
- **Acceptance criteria:**
  - [x] `renderCard()` in `scripts/generate-dashboard.ts` uses `<details>/<summary>` for multi-line results (>1 line): first 3 lines in `<summary>`, full text in `<details>` body. Evidence: `scripts/generate-dashboard.ts:73-77`
  - [x] Single-line results render as `<p class="result">` without `<details>` wrapper. Evidence: `scripts/generate-dashboard.ts:72`
  - [x] No `white-space: nowrap; text-overflow: ellipsis` CSS for result text. Evidence: `scripts/generate-dashboard.ts:189` (`white-space:pre-wrap`)
  - [x] `escHtml()` applied to all result content to prevent XSS. Evidence: `scripts/generate-dashboard.ts:74-75`
  - [x] Unit tests cover: multi-line result (details/summary structure), single-line result (p tag), empty result, HTML special chars in result. Evidence: `scripts/generate-dashboard_test.ts:100-170`



### 3.19 FR-S19: Timeline Visualization in Dashboard

- **Description:** HTML dashboard must include a Gantt-style timeline section
  showing each workflow node as a horizontal bar. Bar position reflects
  `started_at` offset from run start; bar width reflects `duration_ms`.
  Parallel nodes appear stacked vertically at the same horizontal offset. The
  longest-duration node (bottleneck) is visually highlighted.
- **Motivation:** Current dashboard renders node cards with no temporal view,
  making it impossible to identify parallelism, sequencing, or bottlenecks at
  a glance. `NodeState` already records `started_at`, `completed_at`, and
  `duration_ms` — no engine changes required.
- **Acceptance criteria:**
  - [x] Dashboard HTML includes a Gantt-style timeline section (rendered in
    `generate-dashboard.ts`). Evidence: `scripts/generate-dashboard.ts:117` (`computeTimeline`), `scripts/generate-dashboard.ts:152` (`renderTimeline`), `scripts/generate-dashboard.ts:305-306` (integrated in `renderHtml`).
  - [x] Each node rendered as a horizontal bar: left offset =
    `(node.started_at − run.started_at) / total_duration`; width =
    `node.duration_ms / total_duration` (proportional, percentage-based CSS). Evidence: `scripts/generate-dashboard.ts:140-141` (`offsetPct`, `widthPct` computation).
  - [x] Parallel nodes (overlapping time ranges) are stacked vertically in the
    timeline view (each on its own row). Evidence: `scripts/generate-dashboard.ts:165` (`<div class="timeline-row">` per bar).
  - [x] Bottleneck node (max `duration_ms`) is visually distinguished (e.g.,
    distinct fill color or border). Evidence: `scripts/generate-dashboard.ts:143` (`isBottleneck` flag), `scripts/generate-dashboard.ts:160-161` (CSS class applied), `scripts/generate-dashboard.ts:371` (`.timeline-bottleneck` CSS).
  - [x] Nodes with missing `started_at` or `duration_ms` (skipped/pending) are
    omitted from the timeline. Evidence: `scripts/generate-dashboard.ts:123` (`continue` on missing timing).
  - [x] Timeline renders correctly when only one node has timing data. Evidence: `scripts/generate-dashboard_test.ts:323` (single-node test).
  - [x] No external CDN dependencies; all CSS/JS inlined. Evidence: `scripts/generate-dashboard.ts:369-372` (timeline CSS in inlined `CSS` const).
  - [x] `escHtml()` applied to node labels rendered in the timeline. Evidence: `scripts/generate-dashboard.ts:163` (`label = escHtml(nodeId)`).
  - [x] Unit tests cover: bar position/width calculation, bottleneck detection,
    parallel node stacking, single-node edge case, missing-timing omission. Evidence: `scripts/generate-dashboard_test.ts:288-472`.



### 3.20 FR-S20: Dashboard Stream Log Links

- **Description:** Each node card in the HTML dashboard must include a direct
  link to that node's `stream.log` execution log when the file exists. The link
  must be visually distinct from artifact `.md` links (e.g., labeled
  "execution log" or styled differently). Enables direct navigation from a
  failing node card to its detailed execution log without manual filesystem
  navigation.
- **Motivation:** Stream logs are the primary debugging tool for workflow
  failures. The dashboard currently lists only `.md` output artifacts;
  execution logs (`stream.log`) are not linked, making them hard to discover.
  `scanArtifacts` already surfaces `stream.log` in node directories but
  dashboard rendering ignores it.
- **Acceptance criteria:**
  - [x] `renderCard()` in `scripts/generate-dashboard.ts` checks for existence
    of `<node-dir>/stream.log` and includes a link when the file exists.
    Evidence: `scripts/generate-dashboard.ts:47-51` (`renderCard` accepts
    `streamLogHref?`), `scripts/generate-dashboard.ts:82-84` (conditional
    `logLinkHtml`), `scripts/generate-dashboard.ts:419-430` (CLI scans via
    `Deno.stat()`, builds href map).
  - [x] Stream log link is visually distinct from artifact links (e.g.,
    different label such as "execution log", distinct CSS class or style).
    Evidence: `scripts/generate-dashboard.ts:380` (`.log-link` CSS class:
    monospace, 0.75rem, muted color `#6b7280`), `scripts/generate-dashboard.ts:83`
    (`class="log-link"` on anchor).
  - [x] If `stream.log` does not exist for a node, no broken link is rendered.
    Evidence: `scripts/generate-dashboard.ts:82-84` (renders only when
    `streamLogHref` is provided; absent → empty string).
  - [x] `escHtml()` applied to stream log link path/label to prevent XSS.
    Evidence: `scripts/generate-dashboard.ts:83` (`escHtml(streamLogHref)`
    in href attribute).
  - [x] Unit tests cover: stream.log present (link shown), stream.log absent
    (no link), HTML escaping of path.
    Evidence: `scripts/generate-dashboard_test.ts:641-647` (link present),
    `scripts/generate-dashboard_test.ts:649-654` (no link when absent),
    `scripts/generate-dashboard_test.ts:656-678` (threading via `renderHtml`).



### 3.21 FR-S21: Agent Output Summary Section

- **Description:** Every agent in the workflow must produce a `## Summary`
  section in its primary output artifact. The workflow validation must enforce
  its presence via `contains_section: Summary` rule. Ensures traceability:
  any operator or downstream agent can read a single section to understand
  what the stage accomplished.
- **Motivation:** Agent artifacts vary widely in length (spec: ~1 page;
  QA report: multi-page). Without a mandatory summary, downstream agents and
  operators must parse the full artifact to assess outcomes — increasing cost
  and latency.
- **Acceptance criteria:**
  - [x] All 6 agent SKILL.md files include documented requirement for a
    `## Summary` section in their output artifact.
    Agents: `agent-pm`, `agent-architect`, `agent-tech-lead`,
    `agent-developer`, `agent-qa`, `agent-tech-lead-review`.
    Evidence: `.flowai-workflow/agents/agent-pm/SKILL.md:113`,
    `.flowai-workflow/agents/agent-architect/SKILL.md:120`,
    `.flowai-workflow/agents/agent-tech-lead/SKILL.md:87`,
    `.flowai-workflow/agents/agent-developer/SKILL.md:92`,
    `.flowai-workflow/agents/agent-qa/SKILL.md:113`,
    `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md:55`.
  - [x] `workflow.yaml` validation rules include `contains_section: Summary`
    for all 6 agent nodes (`specification`, `design`, `decision`, `build`,
    `verify`, `tech-lead-review`).
    Evidence: `.flowai-workflow/workflow.yaml:61` (specification), `:83` (design),
    `:108` (decision), `:140` (build), `:159` (verify), `:210` (tech-lead-review).
  - [x] Continuation mechanism is triggered when `## Summary` is absent
    (same `contains_section` rule behavior as other section validations).
    Evidence: Inherent behavior of `contains_section` validation in engine;
    `.flowai-workflow/workflow.yaml` `contains_section` rules trigger continuation on
    missing section (same mechanism as all other section validations).



### 3.34 FR-S34: Dashboard Diagnostic Enhancements

- **Description:** Three inline diagnostic capabilities added to the HTML run
  dashboard: (1) collapsible inline `stream.log` viewer per node card, (2)
  accurate header run status with distinct visual styling per state value,
  (3) phase aggregate status with `run_on: always` nodes separated from core
  nodes so their outcomes do not mask each other.

  Extends FR-S20 (Dashboard Stream Log Links) — from file-link to inline
  content. Reuses FR-S16 `<details>/<summary>` collapsible pattern.
- **Acceptance criteria:**

  **Group 1 — Inline collapsible stream.log viewer per node card:**

  - [x] `readStreamLog(path, maxHead, maxTail)` returns full content when line
    count ≤ `maxHead+maxTail` (default 200+50); otherwise first `maxHead` lines
    + `\n--- truncated ---\n` + last `maxTail` lines; empty string for
    missing/empty file. Evidence: `scripts/generate-dashboard.ts`,
    `scripts/generate-dashboard_test.ts`.
  - [x] `renderCard()` accepts optional `logContent?: string`; when present and
    non-empty renders `<details><summary>stream log</summary><pre
    class="log-content">${escHtml(logContent)}</pre></details>`; existing
    `<a class="log-link">` href retained. Evidence:
    `scripts/generate-dashboard.ts`.
  - [x] `.log-content` CSS: monospace font, max-height 300px, overflow-y
    scroll; `logContent` HTML-escaped via `escHtml()`. Evidence:
    `scripts/generate-dashboard.ts`.

  **Group 2 — Header status with distinct per-state styling:**

  - [x] `<strong class="${state.status}">` uses actual state value as CSS
    class.
  - [x] Distinct CSS rules: `strong.completed{color:#166534}` (green),
    `strong.running{color:#2563eb}` (blue), `strong.failed{color:#991b1b}`
    (red), `strong.aborted{color:#854d0e}` (orange). `running` does NOT share
    a rule with `completed`. Evidence: `scripts/generate-dashboard.ts`.

  **Group 3 — Phase aggregate status with `run_on: always` separation:**

  - [x] `computePhaseStatus(nodeIds, nodeStates, alwaysNodes)` exported
    function returns `{coreStatus, alwaysStatus?}`; `alwaysStatus` omitted
    when no always-nodes present. Core status: all completed → "completed",
    any failed → "failed", otherwise "running". Always-node status computed
    independently. Evidence: `scripts/generate-dashboard.ts`,
    `scripts/generate-dashboard_test.ts`.
  - [x] CLI entry extracts `run_on: always` from workflow config, builds
    `Set<string>` of always-nodes; passes to `renderHtml()`. Phase heading
    renders secondary `phase-badge-always` badge when `alwaysStatus` present.
    Evidence: `scripts/generate-dashboard.ts`.



### 3.36 FR-S36: After-Script Failure Observability

- **Description:** The `after:` script in `workflow.yaml` for the
  `tech-lead-review` node MUST surface non-zero exit codes as a warning-level
  log entry rather than silently suppressing them. A wrapper script replaces
  the `|| true` pattern: it runs `deno task dashboard --run-dir "$1"`, emits
  `[WARN] dashboard generation failed (exit $code)` to stderr on non-zero exit
  (captured in `stream.log` by engine), and always exits 0 (non-blocking
  behavior retained). `on_error: continue` and `run_on: always` remain
  unchanged.
- **Acceptance criteria:**
  - [x] `run-dashboard.sh` created at `.flowai-workflow/scripts/run-dashboard.sh`.
    Evidence: `.flowai-workflow/scripts/run-dashboard.sh`.
  - [x] Wrapper receives `$1` as run_dir, executes
    `deno task dashboard --run-dir "$1"`, captures exit code. Evidence:
    `.flowai-workflow/scripts/run-dashboard.sh`.
  - [x] On non-zero exit: emits `[WARN] dashboard generation failed (exit $code)`
    to stderr. Evidence: `.flowai-workflow/scripts/run-dashboard.sh`.
  - [x] Wrapper always exits 0 — non-blocking behavior retained. Evidence:
    `.flowai-workflow/scripts/run-dashboard.sh`.
  - [x] `workflow.yaml` `tech-lead-review` `after:` field updated from
    `deno task dashboard --run-dir {{run_dir}} || true` to
    `.flowai-workflow/scripts/run-dashboard.sh {{run_dir}}`. Evidence:
    `.flowai-workflow/workflow.yaml`.
  - [x] `on_error: continue` and `run_on: always` retained unchanged. Evidence:
    `.flowai-workflow/workflow.yaml`.


