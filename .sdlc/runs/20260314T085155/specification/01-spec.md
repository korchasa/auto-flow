---
issue: 13
---

## Problem Statement

Agent outputs — artifacts, GitHub comments, PR descriptions, status updates —
are written in passive/impersonal voice ("The analysis found...", "It was
decided..."). This makes it unclear which agent performed which action and
reduces readability of multi-agent artifact chains.

First-person voice ("I analyzed...", "I decided...", "I found...") directly
attributes actions to the specific agent role, improving traceability and
readability for operators and downstream agents reviewing the pipeline output.

## Affected Requirements

- **FR-2** (Stage 1 — PM Specification): PM artifact and GitHub comments must
  adopt first-person voice. Modified: adds voice style constraint to output
  format.
- **FR-3** (Stage 2 — Architect Design Plan): Architect artifact must use
  first-person. Modified: adds voice style constraint.
- **FR-5** (Stage 3 — Tech Lead Decision): Tech Lead artifact, PR descriptions,
  and GitHub comments must use first-person. Modified: adds voice style
  constraint.
- **FR-7** (Stage 6-7 — Developer + QA Loop): Developer commits/QA reports must
  use first-person. Modified: adds voice style constraint.
- **FR-9** (Stage 8 — Presenter): PR summary must use first-person. Modified:
  adds voice style constraint.
- **FR-11** (Meta-Agent): Changelog and prompt-diff output must use
  first-person. Modified: adds voice style constraint.
- **FR-42** (Agent Output Summary Section): Summary sections must be written in
  first-person. Modified: voice style now also governs Summary section content.

No existing requirements are removed. FR-43 is the canonical requirement;
above FRs are impacted but not structurally changed.

## SRS Changes

- **FR-43 added** (section 3.42): Agent First-Person Voice — mandates
  first-person voice across all 7 agent SKILL.md files and all agent-generated
  GitHub interactions (comments, PR descriptions, status updates).
- Acceptance criteria include per-agent SKILL.md verification and
  `deno task check` gate.

## Scope Boundaries

- **Out of scope:** Changes to engine code, pipeline.yaml, or validation rules.
  Voice style is a prompt/documentation concern, not an engine concern.
- **Out of scope:** Historical artifacts from prior pipeline runs — only future
  outputs are governed.
- **Out of scope:** Human-authored content (CLAUDE.md, design.md, whiteboard.md
  updates unrelated to agent prompts).
- **Deferred:** Automated lint/validation of first-person voice in agent output.
  Currently a documentation-only constraint enforced via SKILL.md instructions.

## Summary

- Issue #13 selected: "Agents should write comments in first person"
- SRS change: FR-43 added (section 3.42) — first-person voice mandate for all 7
  agent SKILL.md files and agent-generated GitHub interactions
- Key scope exclusion: engine/pipeline.yaml unchanged; no automated voice
  linting; historical artifacts unaffected
