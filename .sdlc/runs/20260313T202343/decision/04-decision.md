---
variant: "Variant A: Standalone Deno script with <details> expand"
tasks:
  - desc: "Create generate-dashboard.ts with HTML generation logic"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Create tests for dashboard generator"
    files: ["scripts/generate-dashboard_test.ts"]
  - desc: "Add dashboard task to deno.json"
    files: ["deno.json"]
  - desc: "Add after-hook to optimize node in pipeline config"
    files: [".sdlc/pipeline.yaml"]
---

## Justification

**Selected: Variant A** over B and C.

**Variant B rejected:** Explicitly violates the "engine is domain-agnostic"
key decision (AGENTS.md: "Engine MUST NOT contain git, GitHub, branch, PR,
or any other domain-specific logic"). HTML dashboard with pipeline-specific
card layout is domain knowledge — belongs in scripts, not engine. Also
increases engine blast radius and test burden for a presentation concern.

**Variant C rejected:** CSS `-webkit-line-clamp` is non-standard and `title`
hover is not keyboard-accessible. Critically, it does not satisfy FR-33 AC #2
which requires collapsible long results (`<details>/<summary>` or
click-expand). This is a hard AC miss, not a trade-off.

**Variant A selected:** Standalone script in `scripts/` — clean separation of
concerns. Uses `<details><summary>` for native HTML collapsible behavior
(no JS needed, keyboard-accessible, works in all modern browsers). Effort: S.
Aligns with project vision of pipeline-agnostic engine (AGENTS.md) by keeping
presentation logic outside `engine/`. Triggered via `deno task dashboard` CLI
or `after:` hook on `optimize` node for automatic generation.

**Risk mitigation:** Tight coupling to `ClaudeCliOutput` JSON shape addressed
by reading fields defensively with fallback defaults. `after:` hook uses
`|| true` suffix to prevent dashboard generation failure from killing the
optimize node.

## Task Descriptions

### Task 1: Create generate-dashboard.ts

New `scripts/generate-dashboard.ts`. Reads `state.json` + per-node
`logs/*.json` from a run directory. Generates self-contained `index.html`
with all CSS inlined (no CDN deps). Structure:

- `readRunState(runDir)` — parse `state.json` → `RunState`
- `readNodeLog(runDir, nodeId)` — parse `logs/<nodeId>.json` → `ClaudeCliOutput`
- `renderCard(nodeId, state, log)` — HTML card with status badge, timing,
  cost, result summary using `<details><summary>` (first 3 lines in summary,
  full text in details body)
- `renderHtml(runDir, state, logs)` — full page: header (run ID, timestamp,
  overall status), phase-grouped card grid, inlined CSS
- `escHtml(str)` — escape `<>&"'` for safe HTML embedding
- CLI entry: accepts `--run-dir <path>` argument

### Task 2: Create tests for dashboard generator

New `scripts/generate-dashboard_test.ts`. TDD tests covering:

- `readRunState` with valid/missing state.json
- `readNodeLog` with valid/missing/malformed log JSON
- `escHtml` correctness (XSS prevention)
- `renderCard` output contains `<details>`, status badge, cost display
- Multi-line result produces `<details><summary>` with 3-line preview
- Single-line result renders without `<details>` wrapper
- Full `renderHtml` contains all node cards, phase grouping, run metadata

### Task 3: Add dashboard task to deno.json

Add `"dashboard"` task entry: `deno run --allow-read --allow-write
scripts/generate-dashboard.ts`. Accepts `--run-dir` argument passthrough.

### Task 4: Add after-hook to optimize node

Add `after:` hook to `optimize` node in `.sdlc/pipeline.yaml`:
`deno task dashboard --run-dir {{run_dir}} || true`. Ensures dashboard is
generated after every pipeline run. `|| true` prevents hook failure from
affecting optimize node status.
