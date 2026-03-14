# Meta-Agent Memory

## Agent Baselines
- pm (specification): 14t/$0.60/88s — CLEAN. Zero re-reads, zero wasted Grep.
- architect (design): 11t/$0.36/58s — clean, improved
- tech-lead (decision): 14t/$0.50/59s — clean, stable
- developer (build): 9t/$0.31/30s — BEST EVER. HARD STOP from 051048 worked.
- qa (verify): 21t/$0.55/128s — 5 Grep on tool-results after Read (3rd violation)
- Total run cost: $2.31 (55% reduction from $5.09)
- 1 iteration (QA passed first try)

## Active Patterns
- qa-grep-after-read-v3: ESCALATED, first seen 20260314T044342, last seen
  20260314T051509. 5 Grep on tool-results files (560-992 lines, fully loaded by
  Read). 3rd consecutive violation despite HARD STOP. Ban-only HARD STOP is
  insufficient for QA. Fix: replaced with positive ALGORITHM (read → extract
  facts in text response → proceed, no Grep).
- pm-tool-results-reread: RESOLVED. 0 re-reads in 051509. 2 clean runs.
- pm-branch-shortcut-regression: RESOLVED. Clean flow in 051509. 2 clean runs.

## Resolved Patterns
- developer-grep-after-read: RESOLVED. Fix from 051048 worked: 9t/$0.31 (was
  20t/$0.72). HARD STOP effective in 1 run.
- qa-double-check: RESOLVED. 1 `deno task check` call in 051509. Fix worked.
- tech-lead-write-rewrite: RESOLVED (3 clean runs)
- tech-lead-git-stash: RESOLVED (3 clean runs)
- qa-tool-results-reread: RESOLVED (3 clean runs)
- qa-duplicate-pr-list: RESOLVED (3 clean runs)
- pm-grep-after-read: RESOLVED (3+ clean runs)
- developer-file-rereads: RESOLVED (3+ clean runs)
- pm-multi-edit-srs: RESOLVED (3+ clean runs)
- All other previously resolved patterns: RESOLVED (3+ clean runs)

## Applied Fixes Log
- 20260313T021326–20260314T044342: (compressed — see git history for details)
- 20260314T051048: developer — HARD STOP Grep-after-Read + FORBIDDEN Agent tool
- 20260314T051048: qa — strengthened Grep-after-Read HARD STOP + "EXACTLY ONCE"
  deno task check
- 20260314T051509: qa — replaced ban-only Grep-after-Read HARD STOP with
  positive ALGORITHM: "Read → extract facts in text → proceed". Added evidence:
  all tool-results files <2000 lines (fully loaded by Read). 3rd consecutive
  violation → ban approach is insufficient, algorithm approach used instead.

## Lessons Learned
- Total pipeline cost baseline for M-effort issue: ~$2.30 (down from ~$5.00).
- Run artifacts under .sdlc/runs/ are gitignored — agents must use `git add -f`.
- QA self-approval fails (same user can't approve own PR). Need fallback path.
- **Blacklist approach fails for Bash commands.** WHITELIST is correct.
- **Rule placement matters.** HARD STOP before Responsibilities = strongest.
- **Cross-agent patterns:** Fix in one agent, apply to ALL. Developer had no
  Grep-after-Read HARD STOP → 10 violations. Added in 051048 → 0 in 051509.
- **Positive algorithms > prohibition.** Ban-only HARD STOP failed for QA
  Grep-after-Read (3 consecutive violations). Developer HARD STOP worked in 1
  run — but developer had no prior bad habit. QA has entrenched behavior.
  Switching QA to positive algorithm (WHAT to do, not just what NOT to do).
- **COMMAND 1/2 numbered sequence works for PM.** Resolved branch shortcut
  after 6 consecutive violations with weaker approaches.
- **Cost trajectory:** $5.09 → $2.31 in 2 runs. Main drivers: PM fix ($2.74→
  $0.60) and developer fix ($0.72→$0.31).
