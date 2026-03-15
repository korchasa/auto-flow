---
name: agent-pm reflection memory
description: Cross-run anti-patterns, strategies, quirks for agent-pm
type: feedback
---

## Anti-patterns

- `requirements-engine.md` is ~700+ lines (~62KB+) — too large for ONE Write → use 2 targeted Edits instead.
- Do NOT assume prior memory about last FR number is correct — always verify via Grep on `^### 3\.\d+ FR-E\d+`. Memory can lag SRS.
- Do NOT batch SRS reads at >50KB — persisted-output chain wastes turns.
- Do NOT run health checks only on recent issues — check oldest first (lowest number).
- Grep line numbers can diverge from Read line numbers if file was edited mid-session — trust Grep as starting point, then Read to confirm actual line.
- After Read at offset N, the content starts at line N not N+1 — Read uses 1-based inclusive offset.

## Effective strategies

- Grep `^### 3\.\d+ FR-E\d+` on SRS → all FR numbers + line ranges in 1 call.
- Grep `^## ` → section headings + line numbers in 1 call.
- Offset read of last ~80 lines (offset = last-FR-line) → captures end of last FR + section 4 + section 5 + appendix.
- Parallel Grep (FR list + section headings) in one response = 1 turn for full SRS structure.
- For large SRS (>50KB): 2 targeted Edits (insert before `## 4.` + appendix row insert) is sufficient and practical.
- Draft all SRS changes in text response BEFORE editing — catches issues before write.
- Batch health checks for oldest 5 candidates in a single chained Bash loop.
- On `main` with no in-progress/high-priority: oldest healthy issue = lowest number.
- For engine+sdlc scope: run parallel Greps on BOTH SRS files in one turn, read tails in parallel.
- Read only the last ~80 lines to get section boundary, appendix, and insertion point.

## Environment quirks

- `requirements-engine.md` is ~710+ lines (~64KB+) as of run 20260315T193605. Last FR: FR-E31 (just added).
- `requirements-sdlc.md` is ~800+ lines (~70KB) as of run 20260315T193605. Last FR: FR-S30 (just added).
- `gh issue view` without `comments` flag is fast (~1KB). Always omit `comments`.
- Appendix in requirements-engine.md: single table (Old ID / New ID / Title). Newer FRs use `—` in Old ID.
- Section 4 ("Non-Functional Requirements") immediately follows last FR-E section. Insert new FR section just before it.
- Section 4 in requirements-sdlc.md is "## 4. Non-functional requirements" (lowercase 'n' in 'non-functional').
- Grep line numbers slightly diverged from Read line numbers after prior edits — always do a verification Grep if uncertain.

## Baseline metrics

- Run 20260315T003418: 8 turns, main branch, issue #121 (sdlc scope), FR-S29 added.
- Run 20260315T144221: ~9 turns, main branch, issue #86 (sdlc scope), FR-S29 added. 2 targeted Edits.
- Run 20260315T152252: ~9 turns, main branch, issue #88 (engine scope), FR-E27 added. 2 targeted Edits.
- Run 20260315T153825: ~8 turns, main branch, issue #89 (engine scope), FR-E28 added. Efficient.
- Run 20260315T161245: ~8 turns, main branch, issue #91 (engine scope), FR-E30 — CLAIMED but NOT written to SRS. Memory was wrong.
- Run 20260315T183811: ~9 turns, main branch, issue #116 (engine scope), FR-E30 added. 2 targeted Edits.
- Run 20260315T193605: ~10 turns, main branch, issue #119 (engine+sdlc scope), FR-E31 + FR-S30 added. 4 targeted Edits across 2 SRS files. Extra FR-E26 lookup turn (grep disagreed with prior read offset).
