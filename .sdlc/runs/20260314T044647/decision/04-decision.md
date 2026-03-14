---
variant: "Variant A: Minimal parameter threading"
tasks:
  - desc: "Add streamLogHref optional parameter to renderCard() and render log link"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Add streamLogHrefs parameter to renderHtml() and thread to renderCard()"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Add .log-link CSS class to inlined CSS const"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Add stream.log existence scanning and href map construction in CLI entry point"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Add tests for renderCard with/without streamLogHref and renderHtml with streamLogHrefs map"
    files: ["scripts/generate-dashboard_test.ts"]
---

## Justification

**Variant A selected** over B and C for three reasons:

1. **Scope alignment:** FR-40 requires exactly one thing — a stream log link in
   dashboard cards. Variant B introduces general artifact linking (`.md` files)
   not in FR-40 acceptance criteria — scope creep. Variant A delivers precisely
   the required feature.

2. **Phase-aware correctness:** This project uses phases (`plan`, `impl`,
   `report`) in `pipeline.yaml`, producing paths like
   `<phase>/<nodeId>/stream.log`. Variant C hardcodes `<nodeId>/stream.log`
   inside `renderCard()`, which produces broken links for phase-aware layouts.
   Variant A has the caller (CLI entry point, which has phase info) compute the
   correct relative href — `renderCard()` stays pure and path-agnostic.

3. **Vision alignment (AGENTS.md):** The project vision emphasizes domain-agnostic
   engine and pure, testable components. Variant A keeps `renderCard()` as a pure
   function (receives href string, renders it) — no filesystem coupling, no path
   convention assumptions. This matches the "agents are stateless — all context
   from file artifacts" principle.

**Rejected:**
- Variant B: Effort M vs S, introduces `scanNodeArtifacts()` helper and
  `ArtifactLink` type for a single-link feature. YAGNI.
- Variant C: Breaks with phases (active in this project). Couples path convention
  into render function.

## Task Descriptions

### Task 1: Add streamLogHref to renderCard()

Add optional `streamLogHref?: string` parameter to `renderCard()`. When provided,
render `<a class="log-link" href="...">stream log</a>` after the card-meta div.
Apply `escHtml()` to href value. TDD: write test first for both present/absent cases.

### Task 2: Add streamLogHrefs to renderHtml()

Add optional 4th parameter `streamLogHrefs?: Record<string, string>` to
`renderHtml()`. For each node card, look up `streamLogHrefs[nodeId]` and pass to
`renderCard()`. TDD: test with map containing subset of nodes.

### Task 3: Add .log-link CSS

Append `.log-link` styles to the existing `CSS` const in
`scripts/generate-dashboard.ts`. Style: monospace, smaller font size, distinct
color (e.g., muted blue), inline-block. Must not break existing card layout.

### Task 4: CLI entry point — scan stream.log existence

In the CLI entry point section of `scripts/generate-dashboard.ts`, after reading
`state.json`, iterate node IDs. For each: compute node dir path (phase-aware
using state/config data), check `stream.log` existence via `Deno.stat()`, build
`Record<string, string>` mapping `nodeId → relative href`. Pass map to
`renderHtml()`.

### Task 5: Tests

Add test cases to `scripts/generate-dashboard_test.ts`:
- `renderCard` with `streamLogHref` → output contains `<a class="log-link"` with
  correct href
- `renderCard` without `streamLogHref` → output does NOT contain `log-link`
- `renderHtml` with `streamLogHrefs` map → cards for mapped nodes contain links,
  unmapped nodes do not
