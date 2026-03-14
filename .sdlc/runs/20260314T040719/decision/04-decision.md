---
variant: "Variant A: Inline SVG bar chart in existing dashboard generator"
tasks:
  - desc: "Add CostBar type and computeCostBars() pure function"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
  - desc: "Add renderCostChart() SVG renderer with empty-state handling"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
  - desc: "Add cost chart CSS and integrate into renderHtml() between timeline and card grid"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
---

## Justification

**Variant A selected** over B (HTML/CSS-only) and C (separate module).

- **Spec alignment:** FR-40 spec explicitly requires "inline SVG (no external
  JS)". Variant A is the direct implementation of the spec's stated approach.
- **Vision alignment (AGENTS.md):** Project vision emphasizes simplicity and
  avoiding over-engineering. Variant A adds ~40 lines of pure functions to an
  existing file — minimal surface area, no new modules, no new imports. Variant C
  violates "avoid over-engineering" by extracting a module with a single consumer.
- **Technical superiority over B:** SVG provides semantic chart structure
  (`role="img"` for screen readers), precise coordinate control for bar/text
  positioning, and a natural path to future enhancements (annotations, gradients)
  without switching rendering approaches. CSS-only bars (Variant B) sacrifice
  accessibility and visual fidelity for no effort savings (both are size S).
- **Risk mitigation:** Division-by-zero on all-zero costs handled by filtering
  `cost_usd > 0` before computing proportional widths. Long node IDs mitigated
  by SVG `<text>` truncation. HTML size increase negligible for <20 nodes.
- **SDS already consistent:** `design.md` section 3.10 already documents
  `computeCostBars` and `renderCostChart` with SVG semantics — no SDS delta
  required beyond confirming variant selection.

## Task Descriptions

### Task 1: Add CostBar type and computeCostBars()

Define `CostBar` interface `{nodeId: string, costUsd: number, widthPct: number}`.
Implement `computeCostBars(state: RunState): CostBar[]` — filter nodes where
`cost_usd > 0`, compute `widthPct` as `(cost / maxCost) * 100`. Return sorted
descending by cost. TDD: test with multiple nodes, single node, all-zero (empty
result), mixed zero/non-zero.

### Task 2: Add renderCostChart() SVG renderer

Implement `renderCostChart(bars: CostBar[], totalCost: number): string`. Output:
inline `<svg>` with horizontal `<rect>` bars (proportional width), `<text>`
labels (node ID via `escHtml()`), cost value annotations (`$X.XXXX`). Total cost
header above chart. Empty `bars` array → "No cost data" message (consistent with
timeline empty-state pattern). TDD: test SVG output contains expected elements,
empty-state message, XSS safety of node IDs.

### Task 3: Integrate into renderHtml() with CSS

Append cost chart CSS to existing `CSS` const (bar colors, spacing, container
styles). Call `computeCostBars(state)` and `renderCostChart(bars, totalCost)` in
`renderHtml()`. Insert output between timeline section and `<main>` card grid.
TDD: test full `renderHtml()` output contains cost chart section when cost data
present, omits when absent.
