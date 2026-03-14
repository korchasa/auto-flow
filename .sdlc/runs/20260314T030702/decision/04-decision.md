---
variant: "Variant A: Inline timeline in generate-dashboard.ts"
tasks:
  - desc: "Add computeTimeline() pure function"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
  - desc: "Add renderTimeline() HTML generator"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
  - desc: "Add timeline CSS to existing CSS const"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Integrate timeline section into renderHtml()"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
---

## Justification

**Selected: Variant A** — inline timeline in `generate-dashboard.ts`.

1. **Simplicity over abstraction** (AGENTS.md: "Avoid over-engineering. Only
   make changes that are directly requested or clearly necessary"): The file is
   ~350 lines. Adding ~100-120 lines of pure functions keeps it well within
   maintainable bounds. Variant B introduces two new files for a feature that
   adds ~100 lines of logic — the plan itself flags this as over-engineering at
   current scale.

2. **No precision trade-offs**: Variant C's CSS Grid approach (100 fractional
   columns) loses precision for bars <1% of total duration. Percentage-based
   positioning in Variant A handles arbitrary precision without edge cases.

3. **Minimal blast radius**: Only two files modified (source + test), no new
   modules, no import wiring. Aligns with project vision of keeping the pipeline
   working and simple.

4. **Engine-agnostic**: Feature is purely dashboard rendering — no engine
   changes required (AGENTS.md: "Engine is domain-agnostic"). Uses existing
   `NodeState` timing data from `state.json`.

## Task Descriptions

### Task 1: Add `computeTimeline()` pure function

Create `computeTimeline(state: RunState)` in `generate-dashboard.ts`. Iterates
`state.nodes`, parses `started_at` ISO timestamps, computes `offsetPct` and
`widthPct` relative to run start/total duration. Identifies bottleneck node
(max `duration_ms`). Omits nodes with missing timing. Returns array of
`{nodeId, offsetPct, widthPct, durationMs, isBottleneck}`.

Tests: bar calculation (normal multi-node), single-node edge case, missing
timing data omission, bottleneck detection accuracy.

### Task 2: Add `renderTimeline()` HTML generator

Create `renderTimeline(bars)` in `generate-dashboard.ts`. Generates HTML:
container div with relative positioning, each bar as absolutely-positioned div.
Bottleneck bar gets distinct CSS class (`timeline-bottleneck`). Node labels
sanitized via existing `escHtml()`. Parallel nodes stack vertically (each bar
on its own row, sorted by `started_at`).

Tests: HTML output contains expected structure, bottleneck class applied,
`escHtml` on labels with special characters, empty bars array produces
graceful empty state.

### Task 3: Add timeline CSS to existing `CSS` const

Append timeline-specific CSS rules to the existing `CSS` const string:
container styling, bar colors, bottleneck highlight, row layout, label
positioning. All inlined — no CDN dependencies (per FR-38).

No separate tests needed — CSS is a constant, covered by rendering tests.

### Task 4: Integrate timeline section into `renderHtml()`

Call `computeTimeline(state)` and `renderTimeline(bars)` inside `renderHtml()`.
Insert timeline HTML section between the run metadata header and the phase-
grouped card grid. Timeline section gets heading "Timeline" for visual
separation.

Tests: full `renderHtml()` output includes timeline section, timeline appears
in correct position relative to header and cards.
