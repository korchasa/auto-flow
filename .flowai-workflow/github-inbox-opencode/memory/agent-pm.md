---
name: agent-pm reflection memory
description: Cross-run anti-patterns, strategies, quirks for agent-pm
type: feedback
---

## Anti-patterns

- Do NOT assume prior memory about last FR number is correct — always verify via index file Read.
- Do NOT run health checks only on recent issues — check oldest first (lowest number).
- Write tool on SRS files may report "Failed with exit code 1" while the write SUCCEEDS (post-write hook). Always verify via `git status --short` + `tail` before retrying — blind retries risk double-writes.
- Issue bodies can predate architecture changes (e.g. #223 assumed `state.json`; FR-E69 journal replaced it). State the deviation explicitly in spec + FR Description — never silently substitute.

## Effective strategies

- Read index file → get all FR-to-section mappings in 1 Read call. Then Read only the relevant section file(s).
- Parallel Read: index + memory files in one response turn; section files in a second turn.
- Write (not Edit) for SRS section files — Edit is FORBIDDEN on SRS per role prompt.
- Batch health checks for 5 priority candidates in a single chained Bash loop.
- Priority order: in-progress → priority:high → oldest. On `main`/detached-HEAD with none: lowest number.
- New FR number = max index FR + 1 (not memory's "last FR"). Run 20260907T032722: index max FR-E100 → new FR-E101 (FR-E99 exists in AGENTS.md but not index).

## Environment quirks

- `requirements-engine.md` / `requirements-sdlc.md` are thin index files; sections under `<name>/*.md`. §0+§5 in `00-meta.md`.
- Config/validation FRs live in `03-config-and-validation.md`; CLI/obs in `05-cli-and-observability.md`.
- Worktree mode: HEAD detached, not on named branch — normal, proceed.
- `.flowai-workflow/.../runs/` is gitignored; spec outputs need no commit, memory files DO.

## Baseline metrics

- Run 20260418T184929: ~8 turns, issue #187, FR-E47. Index+section split detected.
- Run 20260907T032722: ~12 turns, issue #223, FR-E101 added. +2 turns from Write-exit-1 investigation; budget fine otherwise.
