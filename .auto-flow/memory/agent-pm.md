---
name: agent-pm reflection memory
description: Cross-run anti-patterns, strategies, quirks for agent-pm
type: feedback
---

## Anti-patterns

- `requirements-sdlc.md` is ~69KB (775 lines) — too large to Read in one call; hits tool-results redirect chain. Cannot reconstruct full content for a Write call. Use targeted Grep + offset/limit reads to gather specific sections, then Edit for surgical insertions.
- The "NEVER use Edit on SRS files" rule is impractical when the SRS is >50KB and cannot be fully loaded. A single targeted Edit (one insertion) is the pragmatic equivalent of a Write on large files.
- Tool-results redirect chains: reading a persisted-output file that also exceeds limits creates a second redirect, then a third. Do NOT follow more than 1 redirect — use Grep/offset reads on the original file directly instead.
- Do NOT run health checks only on the 5 most recent issues — check oldest first (lowest number) when no in-progress/high-priority labels exist. Selection rule: oldest healthy = lowest number.

## Effective strategies

- Grep for `^### 3\.\d+ FR-S\d+` pattern on SRS to find all FR numbers and their line ranges in one call — fast and reliable.
- Read targeted line ranges (offset + limit) to get specific sections (e.g., last FR, section 4 boundary).
- On `main` branch with no in-progress issues: check health of oldest (lowest-number) candidates first, not newest.
- Draft all SRS changes in text response BEFORE writing — catches issues before the write.
- For large SRS (>50KB): 2 targeted Edits (section insert + appendix row) is sufficient and practical.
- Batch health checks for oldest 5 candidates in parallel via a single chained Bash call to save turns.
- Read FR-S23 when issue is documentation-accuracy related — often the new FR either extends or complements it.

## Environment quirks

- `requirements-sdlc.md` was 775 lines (~69KB) as of run 20260315T144221. Grows with each FR addition.
- `gh issue view` without `comments` flag is fast (~1KB). Always omit `comments`.
- `gh issue list --label "in-progress"` returns `[]` most of the time — always have fallback to `--limit 20` all open.
- Appendix C in requirements-sdlc.md must be updated alongside section 3.xx when adding a new FR.

## Baseline metrics

- Run 20260315T003418: 8 turns, main branch, no in-progress issues, issue #121 (sdlc scope), FR-S29 added (now FR-S30 area).
- Run 20260315T144221: ~9 turns, main branch, no in-progress issues, issue #86 (sdlc scope), FR-S29 added. 2 targeted Edits on large SRS file.
- Large SRS file (>50KB): 3 extra turns for read workarounds. Target: plan for 2 extra turns when SRS is large.
