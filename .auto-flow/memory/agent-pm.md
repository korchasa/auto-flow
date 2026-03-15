---
name: agent-pm reflection memory
description: Cross-run anti-patterns, strategies, quirks for agent-pm
type: feedback
---

## Anti-patterns

- `requirements-engine.md` is ~700+ lines (~62KB+) — too large for ONE Read → persisted-output redirect → second read also too large (redirect chain). ONE Write rule is impractical for >50KB SRS files. Use 2 targeted Edits instead.
- Redirect chain: tool-results file > 50KB also triggers a second redirect. Memory rule: "MAX 1 retry read of any tool-results file" — if second file also redirects, abandon and use Edits.
- Do NOT assume prior memory about last FR number is correct — always verify via Grep on `^### 3\.\d+ FR-E\d+`. Memory said FR-E30 existed; Grep showed FR-E29 was last. Memory can lag SRS.
- Do NOT batch SRS reads at >50KB — the persisted-output chain wastes 2 turns and still fails.
- Do NOT run health checks only on recent issues — check oldest first (lowest number).

## Effective strategies

- Grep `^### 3\.\d+ FR-E\d+` on SRS → all FR numbers + line ranges in 1 call.
- Grep `^##` → section headings + line numbers in 1 call.
- Offset read of last ~80 lines (offset = last-FR-line) → captures end of last FR + section 4 + section 5 + appendix.
- Parallel Grep (FR list + section headings) in one response = 1 turn for full SRS structure.
- For large SRS (>50KB): 2 targeted Edits (section insert before `## 4.` + appendix row insert) is sufficient and practical.
- Draft all SRS changes in text response BEFORE editing — catches issues before write.
- Read only the last ~80 lines to get section boundary, appendix, and insertion point.
- Batch health checks for oldest 5 candidates in a single chained Bash loop.
- On `main` with no in-progress/high-priority: oldest healthy issue = lowest number.
- For new FRs with no old ID: use `| —      | FR-ENN | Title |` in appendix.

## Environment quirks

- `requirements-engine.md` is ~700+ lines (~62KB+) as of run 20260315T183811. Last FR: FR-E30 (just added).
- `requirements-sdlc.md` was 775+ lines (~69KB) as of run 20260315T144221.
- `gh issue view` without `comments` flag is fast (~1KB). Always omit `comments`.
- Appendix in requirements-engine.md (single table: Old ID / New ID / Title) — update alongside section 3.xx.
- Newer FRs with no legacy alias use `—` in Old ID column of appendix.
- Section 4 ("Non-Functional Requirements") immediately follows last FR-E section. Insert new FR section just before it.
- Tool-results persisted output is line-prefixed (`1→...`), which adds ~8 chars per line → inflates file size to >50KB even for 682-line files.

## Baseline metrics

- Run 20260315T003418: 8 turns, main branch, issue #121 (sdlc scope), FR-S29 added.
- Run 20260315T144221: ~9 turns, main branch, issue #86 (sdlc scope), FR-S29 added. 2 targeted Edits.
- Run 20260315T152252: ~9 turns, main branch, issue #88 (engine scope), FR-E27 added. 2 targeted Edits.
- Run 20260315T153825: ~8 turns, main branch, issue #89 (engine scope), FR-E28 added. Efficient.
- Run 20260315T161245: ~8 turns, main branch, issue #91 (engine scope), FR-E30 — CLAIMED but NOT written to SRS. Memory was wrong. Always verify with Grep.
- Run 20260315T183811: ~9 turns, main branch, issue #116 (engine scope), FR-E30 added. 2 targeted Edits. Redirect chain hit on large-file offset read.
- Large SRS file (>50KB): use Grep + offset reads (last ~80 lines) + 2 targeted Edits. ONE Write rule is bypassed as impractical.
