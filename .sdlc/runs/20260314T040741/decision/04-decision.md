---
variant: "Variant A: Direct addition to generate-dashboard.ts"
tasks:
  - desc: "Add CostBar interface and computeCostBars() function"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
  - desc: "Add renderCostChart() function with inline SVG bars"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
  - desc: "Integrate cost chart into renderHtml() and add cost-chart CSS"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
---

## Justification

Variant A selected for three reasons:

1. **SDS compliance.** SDS §3.10 specifies `computeCostBars()` and
   `renderCostChart()` as functions within `scripts/generate-dashboard.ts`.
   Variant A implements these signatures directly. Variant C (HTML/CSS) violates
   the "inline SVG horizontal bar chart" specification. Variant B adds
   unnecessary indirection not reflected in the SDS.

2. **Pattern consistency.** Timeline chart (FR-35) was implemented identically:
   `computeTimeline()` + `renderTimeline()` in the same file, CSS appended to
   `CSS` const, integrated into `renderHtml()`. Variant A mirrors this proven
   pattern. Per AGENTS.md vision: simplicity over premature abstraction.

3. **Minimal effort, minimal risk.** Size S. Two files touched. No import
   restructuring, no test migration. File grows to ~400 lines — cohesive,
   single-purpose module.

## Task Descriptions

### Task 1: Add CostBar interface and computeCostBars()

Define `CostBar` interface (`{nodeId: string, costUsd: number, widthPct: number}`)
mirroring `TimelineBar` pattern. Implement `computeCostBars(state: RunState)`:
filter `state.nodes` by `cost_usd > 0`, compute `widthPct` relative to max cost
node. Return sorted array. Export for testing.

Tests: empty state (no cost data), single node, multiple nodes (verify
proportional widths), nodes with zero cost excluded.

### Task 2: Add renderCostChart() with inline SVG

Implement `renderCostChart(bars: CostBar[], totalCost: number)`: generates
`<section class="cost-chart">` with total cost header. Each bar rendered as SVG
`<rect>` with proportional width + `<text>` label (node ID via `escHtml()`) +
cost annotation. Empty bars array → "No cost data available" paragraph (mirrors
timeline empty-state pattern).

Tests: empty bars (no-cost message), single bar SVG output, multiple bars with
label escaping, total cost header formatting.

### Task 3: Integrate into renderHtml() and add CSS

Call `computeCostBars(state)` and `renderCostChart(bars, state.total_cost_usd)`
in `renderHtml()`, inserting output between timeline section and `<main>` card
grid (per SDS §3.10). Append cost-chart CSS to existing `CSS` const (bar colors,
label positioning, responsive widths, `overflow:hidden` for long node IDs).

Tests: full `renderHtml()` output contains cost-chart section, CSS includes
cost-chart rules, integration with real `RunState` data.
