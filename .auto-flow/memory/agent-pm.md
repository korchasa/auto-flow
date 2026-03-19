---
name: agent-pm reflection memory
description: Cross-run anti-patterns, strategies, quirks for agent-pm
type: feedback
---

## Anti-patterns

- `requirements-engine.md` is ~700+ lines (~68KB+) — too large for Read (output redirected to tool-results file, which is ALSO too large). Use Bash tail to read the last ~80 lines. ONE Write is physically impossible when file can't be read into context; use 2-3 targeted Edits instead.
- Do NOT assume prior memory about last FR number is correct — always verify via Grep on `^### 3\.\d+ FR-E\d+`. Memory can lag SRS.
- Do NOT batch SRS reads at >50KB — persisted-output chain wastes turns.
- Do NOT run health checks only on recent issues — check oldest first (lowest number).
- Grep line numbers can diverge from Read line numbers if file was edited mid-session — trust Grep as starting point, then Read to confirm actual line.
- After Read at offset N, the content starts at line N not N+1 — Read uses 1-based inclusive offset.
- Do NOT try to Read the tool-results redirect file for large SRS — it is ALSO too large (redirects again). Use Bash tail instead.
- Edit tool requires the file to have been Read first — for large SRS files (>50KB), use Bash python3 inline script for string replacement instead.

## Effective strategies

- Grep `^### 3\.\d+ FR-E\d+` on SRS → all FR numbers + line ranges in 1 call.
- Grep `^##` → section headings + line numbers in 1 call.
- `tail -n +<line>` via Bash → captures end of last FR + section 4 + section 5 + appendix without offset/limit ban.
- Parallel Grep (FR list + section headings) in one response = 1 turn for full SRS structure.
- For large SRS (>50KB): use `python3 -` inline Bash heredoc with `str.replace()` — reads file, replaces unique marker, writes back. 1 Bash call per edit = efficient and reliable.
- Draft all SRS changes in text response BEFORE editing — catches issues before write.
- Batch health checks for oldest 5 candidates in a single chained Bash loop.
- On `main` with no in-progress/high-priority: oldest healthy issue = lowest number.
- For engine+sdlc scope: run parallel Greps on BOTH SRS files in one turn, read tails in parallel.
- Read only the last ~80 lines (via Bash tail) to get section boundary, appendix, and insertion point.
- Commit history for SRS file (`git log -- documents/requirements-sdlc.md`) reveals which FRs were actually written vs. just referenced in commit titles.

## Environment quirks

- `requirements-engine.md` is ~720+ lines (~68KB+) as of run 20260315T213641. Last FR: FR-E32 (just added).
- `requirements-sdlc.md` is ~820+ lines (~72KB) as of run 20260315T215901. Last FR: FR-S31 (just added).
- Read of requirements-engine.md redirects to tool-results file (68KB). That file ALSO redirects (73KB). Both are too large. Use Bash tail.
- `gh issue view` without `comments` flag is fast (~1KB). Always omit `comments`.
- Appendix in requirements-engine.md: single table (Old ID / New ID / Title). Newer FRs use `—` in Old ID.
- Section 4 ("Non-Functional Requirements") immediately follows last FR-E section. Insert new FR section just before it.
- Section 4 in requirements-sdlc.md is "## 4. Non-functional requirements" (lowercase 'n' in 'non-functional').
- Grep line numbers slightly diverged from Read line numbers after prior edits — always do a verification Grep if uncertain.
- Commit titles for issues #142 (FR-S31) and #143 (FR-S32) referenced FR codes that were NOT in requirements-sdlc.md — those runs didn't update the SRS. Always verify via `git log -- <file>` before assuming FRs exist.

## Baseline metrics

- Run 20260315T003418: 8 turns, main branch, issue #121 (sdlc scope), FR-S29 added.
- Run 20260315T144221: ~9 turns, main branch, issue #86 (sdlc scope), FR-S29 added. 2 targeted Edits.
- Run 20260315T152252: ~9 turns, main branch, issue #88 (engine scope), FR-E27 added. 2 targeted Edits.
- Run 20260315T153825: ~8 turns, main branch, issue #89 (engine scope), FR-E28 added. Efficient.
- Run 20260315T161245: ~8 turns, main branch, issue #91 (engine scope), FR-E30 — CLAIMED but NOT written to SRS. Memory was wrong.
- Run 20260315T183811: ~9 turns, main branch, issue #116 (engine scope), FR-E30 added. 2 targeted Edits.
- Run 20260315T193605: ~10 turns, main branch, issue #119 (engine+sdlc scope), FR-E31 + FR-S30 added. 4 targeted Edits across 2 SRS files. Extra FR-E26 lookup turn (grep disagreed with prior read offset).
- Run 20260315T213641: ~9 turns, main branch, issue #128 (engine scope), FR-E32 added. 3 targeted Edits. Read failed (68KB redirect chain) → Bash tail used. Efficient.
- Run 20260315T215901: ~8 turns, main branch, issue #129 (sdlc scope), FR-S31 added. 2 python3 inline Bash edits. Edit tool blocked (file not Read) → python3 str.replace() pattern used. Efficient.
