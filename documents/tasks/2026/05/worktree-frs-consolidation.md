---
date: "2026-05-01"
status: to do
implements: [FR-E24, FR-E50, FR-E51, FR-E52, FR-E54, FR-E57, FR-E58]
tags: [docs, srs, sds, engine]
related_tasks:
  - 2026/05/isolation-provider-plugin.md
  - 2026/05/per-run-worktree-co-location.md
  - 2026/05/detached-head-rescue-branch.md
  - 2026/05/cwd-relative-template-paths.md
  - 2026/05/per-workflow-run-lock.md
---
# engine: Consolidate worktree FRs into a single coherent subsystem section

## Goal

Replace the chronological patch-log of FR-E24/E50/E51/E52/E54/E57/E58
with a single design-rationale-first specification of the (now-extracted)
git-worktree IsolationProvider.

## Overview

### Context

Critique #4: seven FR-E describe one git-worktree subsystem, each born
as a fix for the previous. `04b-worktree-isolation.md` reads as a
changelog. New readers cannot reconstruct the design from the FR list
alone.

### Current State

- `documents/requirements-engine/04b-worktree-isolation.md` — list of
  patches.
- `documents/design-engine/03-subsystems.md` covers `lock.ts` + worktree
  details inconsistently.
- "absorbed"/"superseded" FRs (FR-S4, S6, S8) keep IDs but no content.

### Constraints

- FR-IDs are stable — never renumber, never drop the ID. May reword title
  and acceptance, may mark "fulfilled by IsolationProvider contract".
- Lands AFTER IsolationProvider extraction — provider is the new
  unit of specification; pre-extraction this would be premature.
- Historical decisions captured in decision-tasks under
  `documents/tasks/2026/05/adr-*.md`.

## Definition of Done

- [ ] New requirements file:
      `documents/requirements-providers/git-worktree.md` — coherent SRS
      for the git-worktree provider. Sections: Purpose, Lifecycle (setup,
      mirror-ignored, teardown, pin-detached-head, rescue-branch),
      Path contracts, Concurrency (per-workflow lock), Failure handling.
- [ ] Old FR-IDs E24/E50/E51/E52/E54/E57/E58 each get a one-line entry
      in the new file: "FR-E24 [stable ID]: <reworded title>. See §<x>."
      Acceptance criteria moved into the narrative §s, not duplicated
      per-ID.
- [ ] `documents/requirements-engine/04b-worktree-isolation.md` becomes
      a redirect stub: "Worktree isolation moved to
      [requirements-providers/git-worktree.md]. FR-IDs preserved."
- [ ] `documents/design-engine/03-subsystems.md` worktree subsections
      replaced with a single "IsolationProvider contract" subsection;
      git-specific implementation details move to
      `documents/design-providers/git-worktree.md`.
- [ ] Each historical FR has a matching task entry under
      `documents/tasks/2026/05/adr-*.md` covering what the patch fixed
      and what the original assumption was. Tasks cross-link from the
      new SRS narrative.
- [ ] Index file `documents/requirements-engine.md` updated: removes
      04b row, adds note about provider SRS.
- [ ] Absorbed/superseded FR-IDs (e.g., FR-S4, S6, S8) get an explicit
      "STATUS: absorbed by FR-X" line so they stop occupying scan-space.

## Solution

### Step 1 — Inventory

List all FR-E touching worktree with their original problem statement.
Group by lifecycle phase (setup / mirror / teardown / lock / path
contract / rescue).

### Step 2 — Write new SRS narrative

Single document, problem-first. Each phase explains: invariant,
mechanism, edge cases. FR-IDs cited inline as "[FR-E50]" labels — not
section headers.

### Step 3 — Extract historical context to task files

For each of E50/E51/E52/E54/E57/E58: corresponding decision-task
under `2026/05/adr-*.md` already records the original bug report,
considered alternatives, and chosen fix.

### Step 4 — SDS rewrite (mirror narrative)

`documents/design-providers/git-worktree.md` mirrors the SRS structure
with implementation details: `git worktree add` flags, rescue-branch
naming pattern, lock-file format.

### Step 5 — Stub the old paths

`04b-worktree-isolation.md` → 5-line redirect. Index regen.

### Verification

- `deno task check` (docs token budget) green.
- `grep -rn "FR-E50\|FR-E51\|FR-E52\|FR-E54\|FR-E57\|FR-E58" documents/`
  shows hits only in: new provider SRS, decision tasks, redirect stub.
- Manual: a new reader can read the new SRS top-to-bottom and explain
  the worktree subsystem without consulting commit history.
