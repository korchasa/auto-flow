---
variant: "Variant B: SRS-only update on current branch"
tasks:
  - desc: "Update FR-38 acceptance criteria to [x] with file-path:line evidence"
    files: ["documents/requirements.md"]
  - desc: "Update FR-39 acceptance criteria to [x] with file-path:line evidence"
    files: ["documents/requirements.md"]
  - desc: "Close PR #41 as superseded and comment on issue #15 with evidence links"
    files: []
---

## Justification

Variant B selected for three reasons:

1. **Implementation complete:** All dashboard code (FR-35, FR-38, FR-39, FR-40)
   already merged to `main` via PRs #69, #70, #74, #75, #77. Zero code changes
   needed. Only SRS evidence markers (`[ ]` → `[x]`) remain.

2. **Vision alignment (AGENTS.md — "fully autonomous, no human gates"):**
   Cherry-picking (A) or merge-main (C) introduce manual git conflict resolution
   risk — a human gate. Variant B is pure documentation update with no conflict
   surface. Maximizes autonomous completion probability.

3. **Complexity trade-off:** Variant A risks cherry-pick conflicts and duplicate
   SHAs. Variant C produces noisy PR diff (all main changes since branch point).
   Variant B: 2 targeted edits to `requirements.md`, no git archaeology.

PR #41 (`sdlc/issue-15`) contains only design/decision artifacts — no
implementation. Tech-lead-review or Developer closes it as superseded with
comment linking to actual implementation commits on `main`.

## Task Descriptions

### Task 1: Update FR-38 (Timeline Visualization) SRS Evidence

File: `documents/requirements.md`, section 3.37. Mark all ~10 acceptance
criteria `[x]` with evidence paths from:
- `scripts/generate-dashboard.ts` — `computeTimeline()`:117, `renderTimeline()`:152, `.timeline-bottleneck`:371
- `scripts/generate-dashboard_test.ts` — timeline unit tests

Note: `requirements.md` is ~85KB. Developer must read relevant section (3.37)
and update with exact line-number evidence from current `main` code.

### Task 2: Update FR-39 (Repeated File Read Warning) SRS Evidence

File: `documents/requirements.md`, section 3.38. Mark acceptance criteria `[x]`
with evidence paths from:
- `engine/agent.ts` — `FileReadTracker`:332, `track()` method
- `engine/agent_test.ts` — FileReadTracker unit tests

### Task 3: Close PR #41 and Comment on Issue #15

No file changes. Git/GitHub operations:
- Close PR #41 with comment: "Superseded — implementation landed on main via PRs #69, #70, #74, #75, #77"
- Comment on issue #15 linking implementation commits
