---
issue: 157
scope: sdlc
---

## Problem Statement

All 6 agent SKILL.md files contain a "BEFORE YOU DO ANYTHING" block (lines 7-10)
instructing agents to read `shared-rules.md`. After FR-S38 (Phase 1), `shared-rules.md`
is inlined automatically via `{{file(...)}}` in `task_template` — making this explicit
read instruction redundant. If left in place, agents waste one turn re-reading content
already present in their prompt, increasing latency and token cost per pipeline run.

## Affected Requirements

- **FR-S38** (Pipeline Agent Context via file() Injection in task_template): Established
  that `shared-rules.md` is injected via `{{file(...)}}` in `task_template`. FR-S39 is
  a direct follow-up: once content is injected at prompt construction time, the in-SKILL.md
  read instruction becomes dead code.
- **FR-S39** (new): Covers the cleanup — remove the redundant "BEFORE YOU DO ANYTHING"
  + "Read shared-rules.md" block from all 6 SKILL.md files.

## SRS Changes

- **FR-S39 added** to `documents/requirements-sdlc.md` (section 3.39).
  - Title: Remove Redundant shared-rules.md Read Instruction from SKILL.md Files
  - Acceptance criteria: block removed from 6 files; cross-references preserved;
    frontmatter unchanged; `deno task check` passes.
  - Dep: FR-S38 must be implemented first.
- **Appendix C** updated: FR-S39 row added.

## Scope Boundaries

- **Excluded:** SKILL.md content restructuring beyond removing the read instruction block.
- **Excluded:** Engine code changes.
- **Excluded:** Removing cross-reference phrases like "per shared-rules.md § Scope-Aware
  Doc Reads" — these are semantic pointers, not read instructions.
- **Deferred:** Any further consolidation of SKILL.md structure.
- **Depends on:** Issue #156 / FR-S38 (Phase 1 — file() injection already implemented
  in PR merged as commit 3aac6ed).

## Summary

- Selected issue #157 (sdlc scope): remove redundant `shared-rules.md` read instruction
  from 6 SKILL.md files post FR-S38 injection.
- FR-S39 added to `requirements-sdlc.md` (section 3.39) with 4 acceptance criteria.
- Scope limited to removing the "BEFORE YOU DO ANYTHING" read block; cross-references
  preserved; no engine changes.
- Key dependency: FR-S38 already implemented (commit 3aac6ed).
- `deno task check` must pass after changes.
