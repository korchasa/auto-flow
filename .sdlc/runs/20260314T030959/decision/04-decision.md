---
variant: "Variant A: Pure CSS bars in renderHtml"
tasks:
  - desc: "Add computeTimeline() helper — compute bar offsets, widths, bottleneck from RunState timing data"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Add renderTimeline() helper — generate Gantt-style HTML section with CSS-positioned bars"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Integrate timeline into renderHtml() — call computeTimeline + renderTimeline, append timeline CSS to CSS const"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Add timeline tests — bar position/width math, bottleneck detection, missing-timing omission, escHtml on labels, single-node edge case"
    files: ["scripts/generate-dashboard_test.ts"]
---

## Justification

**Variant A selected** over B (separate module) and C (SVG-based).

- **Simplicity:** ~60 lines of logic doesn't warrant a new module. Variant B
  adds 2 files + import coupling for marginal separation gain — violates
  AGENTS.md "avoid over-engineering" principle. The dashboard generator is
  already a single-file utility; timeline is a natural extension of `renderHtml()`.
- **CSS vs SVG:** Percentage-based CSS (`left:X%;width:Y%`) adapts to container
  width naturally. SVG (Variant C) requires coordinate math, produces verbose
  string construction, and has accessibility drawbacks (screen readers handle
  HTML divs better than SVG rects). Sub-pixel bar risk mitigated with
  `min-width: 2px`.
- **Vision alignment:** AGENTS.md mandates "keep the project in working
  condition" and "avoid over-engineering." Variant A is the minimum viable
  change — S effort, 2 existing files modified, no new dependencies.
- **SDS compatibility:** `design.md` §3.10 already documents `computeTimeline`
  and `renderTimeline` functions matching Variant A's architecture (pure data
  computation + HTML rendering separation within the same file).

## Task Descriptions

### Task 1: `computeTimeline()` helper

Pure function: `computeTimeline(state: RunState) → TimelineBar[]`. Iterates
`state.nodes`, filters nodes with `started_at` + `duration_ms`, computes
`offsetPct = (node.started_at − run.started_at) / total_span * 100` and
`widthPct = node.duration_ms / total_span * 100`. Identifies bottleneck
(max `duration_ms`). Returns array of `{nodeId, offsetPct, widthPct,
durationMs, isBottleneck}`. `total_span` = max(`completed_at`) − `run.started_at`.

### Task 2: `renderTimeline()` helper

Takes `TimelineBar[]`, returns HTML string: `<section class="timeline">` with
one `<div class="timeline-row">` per bar (sorted by start offset). Each row:
label span + absolutely-positioned bar div with `style="left:X%;width:Y%"`.
Bottleneck bar gets `.timeline-bottleneck` CSS class. Labels sanitized via
`escHtml()`.

### Task 3: Integrate into `renderHtml()`

Call `computeTimeline(state)` → `renderTimeline(bars)` inside `renderHtml()`,
insert between header and card grid (per FR-38 spec). Append timeline CSS
rules to existing `CSS` const: bar colors matching status classes, bottleneck
highlight, `min-width: 2px` for sub-pixel mitigation, row layout.

### Task 4: Tests

In `generate-dashboard_test.ts`:
- Proportional offset/width calculation correctness (known input → exact %)
- Bottleneck = node with max `duration_ms`
- Nodes missing `started_at` or `duration_ms` omitted from output
- `escHtml()` applied to node labels in rendered HTML
- Single-node edge case (widthPct = 100%, offsetPct = 0%)
- Empty nodes map → no timeline section rendered
