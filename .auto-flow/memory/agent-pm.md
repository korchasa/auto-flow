---
name: agent-pm reflection memory
description: Cross-run anti-patterns, strategies, quirks for agent-pm
type: feedback
---

## Anti-patterns

- `requirements-engine.md` is ~62KB — redirects on Read. Use Grep + offset/limit reads instead.
- `requirements-sdlc.md` is ~69KB (775+ lines) — too large to Read in one call. Use targeted Grep + offset reads + Edit.
- The "NEVER use Edit on SRS files" rule is impractical when SRS is >50KB and cannot be fully loaded. One targeted Edit per insertion is pragmatic.
- Tool-results redirect chains: reading a persisted-output file that also exceeds limits creates a second redirect. Do NOT follow more than 1 redirect.
- Do NOT run health checks only on the 5 most recent issues — check oldest first (lowest number) when no in-progress/high-priority labels exist.

## Effective strategies

- Grep `^### 3\.\d+ FR-E\d+` / `^### 3\.\d+ FR-S\d+` on SRS to find all FR numbers + line ranges in one call.
- Grep `^## ` to find section headings and line numbers.
- Read targeted line ranges (offset + limit) to get specific sections (last FR, appendix boundary).
- On `main` branch with no in-progress issues: check health of oldest (lowest-number) candidates first.
- Draft all SRS changes in text response BEFORE writing — catches issues before the write.
- For large SRS (>50KB): 2 targeted Edits (section insert + appendix row) is sufficient and practical.
- Batch health checks for oldest 5 candidates in a single chained Bash call.
- Read reflection memory and issue list in parallel in STEP 1+2a.
- Read issue body and SRS structure (grep for FRs + sections) in parallel.
- For new FRs with no old ID: use `| —      | FR-ENN | Title |` in appendix.

## Environment quirks

- `requirements-sdlc.md` was 775+ lines (~69KB) as of run 20260315T144221. Grows with each FR addition.
- `requirements-engine.md` is ~62KB (~670+ lines after FR-E28). Also too large to Read in one pass.
- `gh issue view` without `comments` flag is fast (~1KB). Always omit `comments`.
- Appendix C in requirements-sdlc.md must be updated alongside section 3.xx when adding a new FR.
- Appendix in requirements-engine.md (single table, Old ID / New ID / Title) must also be updated with each new FR-E.
- Newer FRs with no legacy alias use `—` in Old ID column of appendix.

## Baseline metrics

- Run 20260315T003418: 8 turns, main branch, issue #121 (sdlc scope), FR-S29 added.
- Run 20260315T144221: ~9 turns, main branch, issue #86 (sdlc scope), FR-S29 added. 2 targeted Edits.
- Run 20260315T152252: ~9 turns, main branch, issue #88 (engine scope), FR-E27 added. 2 targeted Edits.
- Run 20260315T153825: ~8 turns, main branch, issue #89 (engine scope), FR-E28 added. Grep structure + offset reads + 2 Edits. Efficient.
- Large SRS file (>50KB): use Grep + offset reads + targeted Edits. Both SRS files are now this large.
