---
variant: "Variant A: Inline SVG bars in generate-dashboard.ts"
tasks:
  - desc: "Add CostBar interface and computeCostBars() pure function"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Add renderCostChart() SVG renderer with escHtml() labels"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Integrate cost chart into renderHtml() and append CSS"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Add unit tests: bar proportions, zero-cost exclusion, total cost, single-node, all-zero, XSS safety"
    files: ["scripts/generate-dashboard_test.ts"]
---

## Justification

**Selected: Variant A** (Inline SVG bars) over Variant B (HTML/CSS divs) and
Variant C (enhanced SVG with axes).

**Technical fit:** Variant A mirrors the proven `computeTimeline()` +
`renderTimeline()` pattern from FR-38 — pure compute function returning typed
array, separate render function producing self-contained markup. SVG `<rect>` +
`<text>` elements provide pixel-precise bar widths and cost annotations without
CSS layout hacks. The existing `escHtml()` utility covers XSS safety for node
ID labels.

**Vision alignment:** Project vision (AGENTS.md) emphasizes fully autonomous
pipeline with no human gates. Self-contained inline SVG (no CDN, no external
deps) ensures the dashboard remains a single portable artifact — consistent
with the "single Docker image" and "all context from file artifacts" design
principles. Cost visibility directly supports the autonomous pipeline by
enabling budget optimization without human inspection of raw JSON.

**Complexity trade-off:** Effort S. Two pure functions + integration point +
CSS block. Variant B offers marginal consistency gain (div-based like timeline)
but loses SVG's precise text positioning for cost annotations. Variant C is
over-engineered (M effort, axes/gridlines/gradients for a simple bar chart) —
violates the project's "avoid over-engineering" principle.

**Risk:** SVG text clipping on long node IDs — mitigated by `text-overflow`
CSS or truncation in `escHtml()`. Minimal risk given FR-38 precedent.

## Task Descriptions

### Task 1: Add CostBar interface and computeCostBars()

Define `CostBar` interface: `{nodeId: string, costUsd: number, widthPct: number}`.
Implement `computeCostBars(state: RunState): CostBar[]` — iterate `state.nodes`,
filter entries where `cost_usd > 0`, compute `widthPct = (cost / maxCost) * 100`
relative to maximum cost node. Return sorted array. Pure function, no side effects.

### Task 2: Add renderCostChart() SVG renderer

Implement `renderCostChart(bars: CostBar[], totalCost?: number): string`. Produce
inline `<svg>` with horizontal `<rect>` bars (proportional width via `widthPct`),
`<text>` node labels (sanitized via `escHtml()`), and `$X.XXXX` cost annotations.
Total cost displayed in `<h2>` header above chart. Empty bars array → "No cost
data" message (mirrors timeline empty-state pattern).

### Task 3: Integrate into renderHtml() and CSS

Call `computeCostBars(state)` and `renderCostChart(bars, state.total_cost_usd)`
in `renderHtml()`. Insert output between `${timelineHtml}` and `<main>` card
grid. Append cost chart CSS classes (`.cost-chart`, SVG text/rect styling) to
existing `CSS` const.

### Task 4: Unit tests

Add tests to `scripts/generate-dashboard_test.ts`:
- Bar proportion calculation (multi-node, verify widthPct relative to max)
- Zero-cost exclusion (nodes with `cost_usd: 0` or missing field omitted)
- Total cost display (header shows formatted total)
- Single-node case (one bar at 100% width)
- All-zero case (empty chart, "No cost data" message)
- XSS safety (node IDs with `<script>` tags escaped in output)
