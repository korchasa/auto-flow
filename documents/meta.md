# Meta-Agent Memory

## Agent Baselines
- pm (specification): 15t/$0.47/82s ← REGRESSED from 2t; branch shortcut not followed
- architect (design): 8t/$0.48/91s (stable, no fix needed)
- tech-lead (decision): 17t/$0.49/86s ← down from 21t, target ≤12
- executor (build): 18t/$0.51/68s (iter1) + 20t/$0.64/101s (iter2, fix)
- qa (verify): 20t/$0.45/89s (iter1, FAIL) + 24t/$0.57/147s (iter2, PASS)
- Total run cost: ~$2.65 (down from $3.21; best so far)
- 2 iterations needed (QA found real bug in loop.ts model resolution)

## Active Patterns
- pm-branch-shortcut-regression: NEW, first seen 20260313T224909. PM had 2t
  with branch shortcut last run, now 15t. Still ran `gh issue list` despite
  being on sdlc/issue-21. Also did 4 Grep calls on files already Read.
  Fix: made shortcut a HARD STOP ("do NOT run gh issue list"), added "no Grep
  after Read" rule, lowered target to ≤8.
- tech-lead-git-exploration: PARTIAL, first seen 20260313T161422,
  last seen 20260313T224909. Improved 21→17t. No longer does stash/checkout-main
  (FORBIDDEN fix worked!). But now wastes turns on `git show`, `git log`,
  double `ls`. Fix: explicitly banned git exploration commands, listed allowed
  Bash commands exhaustively.
- qa-agent-tool-violation: NEW, first seen 20260313T224909. QA used Agent tool
  in verify-iter-2 despite "Do NOT use the Agent tool" in prompt. Also used
  `cat` via Bash. Fix: changed to "FORBIDDEN: Agent tool" + "FORBIDDEN: Bash
  file inspection" with specific command names listed.
- qa-high-turns: WATCHING, first seen 20260313T223344, last seen 20260313T224909.
  20t (iter1) + 24t (iter2) vs target ≤12. Grep via Bash persisted in iter-1
  despite ban. Fix strengthened with FORBIDDEN keyword + "no re-reading" rule.
- executor-serial-reads: WATCHING→CHECK, first seen 20260313T204755,
  last seen 20260313T224909. Build-iter-2 had 14 parallel turns (vs 0 last run).
  Significant improvement. Validate next run for consistency.
- all-agents-no-parallelism: PARTIAL→IMPROVED. Parallel turns observed:
  spec=8, decision=8, build1=8, build2=14, verify1=13, verify2=14.
  Major improvement from 0 parallel turns last run.

## Applied Fixes Log
- 20260313T021326: pm — CRITICAL HARD CONSTRAINT on design.md → RESOLVED
- 20260313T023047: executor — efficiency guidance → RESOLVED
- 20260313T161422: tech-lead — simplified git workflow → PARTIAL (43→29→32→21→17)
- 20260313T195608: pm — stop-exploring → superseded by branch shortcut
- 20260313T195608: qa — trust deno task check → regressed (17→20→20/24)
- 20260313T204755: pm — branch shortcut → REGRESSED (2→15); shortcut ignored
- 20260313T204755: tech-lead — force-with-lease + batch edits → PARTIAL
- 20260313T204755: executor — parallel reads + ban TodoWrite → IMPROVED
  (parallelism working: 14 parallel turns in iter-2)
- 20260313T223344: tech-lead — FORBIDDEN stash/checkout/pull → RESOLVED
  (no stash/checkout observed). But git exploration persists.
- 20260313T223344: executor — strengthened parallel read → IMPROVED (14 parallel)
- 20260313T223344: qa — banned Bash file inspection → PARTIAL (still used grep
  via Bash in iter-1, Agent tool in iter-2)
- 20260313T224909: pm — HARD STOP on gh issue list when on branch, ban Grep
  after Read, target ≤8 → WATCHING
- 20260313T224909: tech-lead — banned git show/log/ls, listed allowed Bash
  commands, target ≤12 → WATCHING
- 20260313T224909: qa — FORBIDDEN Agent tool + FORBIDDEN Bash file inspection
  (with keyword), no re-reading rule, target ≤12 → WATCHING

## Lessons Learned
- PM/SDS-update scope overlap resolved by explicit constraints in PM prompt.
- Engine loop bug (buildContext node lookup) fixed in commit f9c9983.
- Total pipeline cost baseline for M-effort issue: ~$2.65-$5.10.
- Pipeline config gap: build node has no input from verify for iter > 1.
  Workaround: hardcoded relative path in executor prompt.
- Run artifacts under .sdlc/runs/ are gitignored — agents must use `git add -f`.
- QA self-approval fails (same user can't approve own PR). Need fallback path.
- TodoWrite in executor is pure overhead. Banned — confirmed 0 calls (2 runs).
- "Parallel" language alone is insufficient but "MANDATORY"/"FIRST response MUST"
  phrasing DOES work — parallelism improved from 0 to 8-14 parallel turns.
- FORBIDDEN keyword works for hard bans (stash/checkout stopped). Must use
  it for all strict prohibitions, not just "do not".
- "No Grep after Read" needed: agents Read a file then Grep it 4 times for
  content they already have in context.
- Cost improved 18% ($3.21→$2.65) but 2 iterations inflated total. Single-iter
  cost would be ~$1.95 (best possible with current prompts).
