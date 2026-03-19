---
variant: "Variant C: Static embedding with truncation"
tasks:
  - desc: "Add readStreamLog() truncation utility"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
  - desc: "Embed inline log viewer in renderCard()"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
  - desc: "Fix header status CSS per run state value"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
  - desc: "Compute phase aggregate status with run_on:always separation"
    files: ["scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts"]
  - desc: "Update CLI entry to wire log content and run_on config into rendering"
    files: ["scripts/generate-dashboard.ts"]
---

## Justification

I selected Variant C (static embedding with truncation) for these reasons:

- **Self-contained dashboard contract preserved.** AGENTS.md states artifacts
  are stored per-run for isolation. Variant B's `fetch()` breaks file://
  protocol — dashboard opened as local file would fail to load logs. Variant C
  keeps all data inline in the HTML, matching the existing self-contained
  pattern (all CSS inlined, no CDN deps).
- **Proactive risk mitigation.** AGENTS.md mandates "fail fast, fail clearly."
  Variant A defers the large-file risk — unbounded `stream.log` content could
  produce multi-MB HTML pages. Variant C bounds output via head+tail truncation
  (200+50 lines default), eliminating this risk at minimal extra complexity.
- **Minimal incremental effort over Variant A.** The `readStreamLog()` function
  adds ~20 LOC + 3-4 test cases. All other changes (header status, phase
  aggregate) are identical across A and C.
- **Domain-agnostic engine boundary respected.** All changes are in
  `scripts/generate-dashboard.ts` (SDLC scope). No engine code touched. Phase
  aggregate reads `run_on` from pipeline config (already loaded), not from
  engine types.

## Task Descriptions

### Task 1: Add `readStreamLog()` truncation utility

New exported function `readStreamLog(path: string, maxHead?: number,
maxTail?: number): Promise<string>`. Reads file, splits into lines. If line
count ≤ `maxHead + maxTail` (defaults: 200, 50): return full content. Otherwise:
return first `maxHead` lines + `\n--- truncated ---\n` + last `maxTail` lines.
Returns empty string if file missing. Tests: under limit (full), over limit
(truncated with marker), empty file, missing file.

### Task 2: Embed inline log viewer in `renderCard()`

Modify `renderCard()` to accept optional `logContent?: string` parameter. When
present and non-empty: render `<details><summary>stream log</summary><pre
class="log-content">${escHtml(logContent)}</pre></details>` after existing
stream log link. Existing href link retained for direct file access. Add
`.log-content` CSS (monospace, max-height with overflow scroll). Tests: card
with log content renders `<details>`, card without log content omits it.

### Task 3: Fix header status CSS per run state value

Current: `state.status` string used as CSS class but `running` shares styling
with `completed`. Fix: add distinct CSS rules for all 4 values (`completed`,
`failed`, `aborted`, `running`) with semantic colors (green, red, orange,
blue). Ensure `<strong class="${state.status}">` renders correctly for each.
Tests: header HTML contains correct class per status value, CSS includes all
4 rules.

### Task 4: Compute phase aggregate status with `run_on: always` separation

New exported function `computePhaseStatus(nodeIds: string[],
nodeStates: Record<string, NodeState>, alwaysNodes: Set<string>):
{coreStatus: string, alwaysStatus?: string}`. Separates core nodes from
`run_on: always` nodes. Core status: all completed → "completed", any failed →
"failed". Always-node status computed independently, rendered as secondary
badge. Update `renderHtml()` to call this per phase group and render both
badges. Tests: all-pass core + failed always-node, failed core + passed
always-node, mixed, no always-nodes.

### Task 5: Update CLI entry to wire log content and `run_on` config

CLI entry point reads `stream.log` content via `readStreamLog()` for each node
(replacing existence-only check). Extracts `run_on` from pipeline config nodes
to build `Set<string>` of always-nodes. Passes both to `renderHtml()`. No new
tests (integration-level wiring; covered by existing CLI tests + new unit tests
from tasks 1-4).

## Summary

I selected Variant C (static embedding with truncation) for issue #149
(FR-S34). It preserves the self-contained dashboard contract while proactively
bounding HTML size via head+tail truncation. 5 tasks ordered by dependency:
truncation utility → inline log viewer → header status fix → phase aggregate
status → CLI wiring. Branch `sdlc/issue-149` created with draft PR.
