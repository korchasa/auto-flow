---
variant: "Variant A: Functions in existing dashboard file"
tasks:
  - desc: "Add computeCostBars() pure function and unit tests"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
  - desc: "Add renderCostChart() SVG renderer and unit tests"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
  - desc: "Integrate cost chart into renderHtml() and add cost chart CSS"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Add edge-case tests: single-node, all-zero, escHtml on labels"
    files: ["scripts/generate-dashboard_test.ts"]
---

## Justification

**Variant A selected** over B (separate module) and C (HTML/CSS bars).

- **Consistency:** Timeline visualization (FR-38) was added directly to
  `generate-dashboard.ts` using the same pattern (`computeTimeline()` +
  `renderTimeline()`). Variant A mirrors this exactly. Variant B extracts a
  module for ~100 lines — premature abstraction that creates inconsistency
  with timeline (not extracted either).
- **Spec alignment:** FR-40 spec states "inline SVG or canvas" with SVG
  preferred. Variant C uses HTML divs, diverging from spec preference.
  Variant A uses inline SVG as specified.
- **Vision alignment (AGENTS.md):** Project vision emphasizes simplicity and
  avoiding over-engineering. Variant A is smallest effort (S), fewest files
  touched, zero new modules. Aligns with "keep project in working condition"
  and "no stubs/crutches" — straightforward addition following established
  patterns.
- **Risk:** File grows ~100 lines (~320→~420). Acceptable — timeline added
  similarly with no issues. If dashboard outgrows single file in future,
  extract both timeline and cost chart together (consistent refactor).

## Task Descriptions

### Task 1: Add `computeCostBars()` pure function and unit tests

TDD RED-GREEN: Write `computeCostBars(state: RunState)` that filters
`state.nodes` entries by `cost_usd > 0`, computes proportional `widthPct`
relative to max cost. Returns `{nodeId: string, costUsd: number,
widthPct: number}[]`. Tests: multiple nodes with varying costs (verify
proportions), zero-cost exclusion, empty input.

### Task 2: Add `renderCostChart()` SVG renderer and unit tests

TDD RED-GREEN: Write `renderCostChart(bars, totalCost)` producing inline SVG
horizontal bar chart. Each bar: `<rect>` with proportional width, `<text>`
label (node ID via `escHtml()`), cost value. Header shows total cost. Empty
bars array → "No cost data" message (mirrors timeline empty-state pattern).
Tests: SVG structure, label escaping, empty-state message.

### Task 3: Integrate cost chart into `renderHtml()` and add CSS

Wire `computeCostBars()` + `renderCostChart()` into `renderHtml()`. Read
`state.total_cost_usd` for total display. Insert chart section between
timeline and `<main>` card grid. Append cost chart CSS to existing `CSS`
const (bar colors, spacing, responsive width — consistent with timeline CSS
approach).

### Task 4: Add edge-case tests

Tests for: single-node chart (one bar, 100% width), all-zero costs (empty
chart with message), `escHtml()` on node labels containing `<>&"'` chars.
Verify `deno task check` passes.
