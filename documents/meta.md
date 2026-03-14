# Meta-Agent Memory

## Agent Baselines
- pm (specification): 18t/$0.69/150s — branch shortcut + tool-results re-read REGRESSION
- architect (design): 11t/$0.45/56s — clean (Grep on unread file = legitimate)
- tech-lead (decision): 16t/$0.52/91s — read AGENTS.md unnecessarily (+3t)
- developer (build): 18t/$1.32/357s — 3 redundant push attempts + fmt fix cycle
- qa (verify): 14t/$0.24/375s — excellent (big improvement from $0.76)
- Total run cost: $3.22 (down from $3.90, up from $3.02 baseline)
- 1 iteration (QA passed first try)

## Active Patterns
- pm-requirements-thrashing: WATCHING, first seen 20260314T033033, last seen
  20260314T034433. Still persisting: offset re-read + 2 Grep after tool-results
  redirect. 3 consecutive violations (033033, 034010, 034433). Updated evidence.
- pm-branch-shortcut-regression: REGRESSION, first seen 20260313T230627,
  last seen 20260314T034433. Violated on sdlc/issue-51: ran git pull + 2×
  issue list. Was clean for 034010 (main branch). Algorithm ignored on
  sdlc/issue-* branch. Updated evidence with current run data.
- architect-grep-after-read: RESOLVING, first seen 20260314T024833,
  last clean 20260314T034433. 2nd clean run (Grep on engine/types.ts = unread
  file, legitimate). Need 1 more clean run to confirm RESOLVED.
- developer-push-retry: NEW, first seen 20260314T034433. 3 push variants
  attempted (all "Everything up-to-date"). Fix: "push ONCE, accept up-to-date"
  rule added to developer prompt.

## Resolved Patterns
- pm-grep-after-read: RESOLVED (1 clean run: 033033, 0 Grep calls)
- qa-grep-after-read: RESOLVED (2 clean runs: 032515, 033033)
- developer-file-rereads: RESOLVED (2 clean runs: 032515, 033033)
- pm-multi-edit-srs: RESOLVED (3+ clean runs)
- developer-multi-edit-waste: RESOLVED (3+ clean runs)
- developer-reread-waste: RESOLVED (3+ clean runs)
- qa-reread-waste: RESOLVED (3+ clean runs)
- developer-temp-reread: RESOLVED (3+ clean runs)
- pm-offset-reread: RESOLVED (3+ clean runs)
- developer-offset-reread: RESOLVED (3+ clean runs)
- qa-offset-reread: RESOLVED (3+ clean runs)
- developer-grep-via-bash: RESOLVED (3+ clean runs)
- developer-offset-persistent: RESOLVED (3+ clean runs)
- qa-offset-persistent: RESOLVED (3+ clean runs)
- architect-subagent-waste: RESOLVED (3+ clean runs)
- pm-bash-blacklist-ignored: RESOLVED (3+ clean runs)
- architect-offset-reads: RESOLVED (3+ clean runs)
- pm-offset-reread-regression: RESOLVED (3+ clean runs)
- pm-edit-regression: RESOLVED (3+ clean runs)
- developer-test-fix-loop: RESOLVED (3+ clean runs)
- developer-offset-v4: RESOLVED (3+ clean runs)
- tech-lead-bash-exploration: RESOLVED (3+ clean runs)
- qa-bash-explosion: RESOLVED (3+ clean runs)

## Applied Fixes Log
- 20260313T021326–20260314T024833: (compressed — see git history for details)
- 20260314T030959: pm — HARD STOP grep-after-read + 4-run branch shortcut evidence
- 20260314T030959: architect — updated grep-after-read evidence (regression)
- 20260314T030959: developer — strengthened ONE READ with post-write evidence
- 20260314T030959: qa — updated grep-after-read evidence
- 20260314T032515: pm — pseudocode algorithm for branch shortcut (IF/ELSE),
  grep-after-read fix: "note last FR/section in text response"
- 20260314T032515: architect — updated grep-after-read evidence (3-run trail)
- 20260314T033033: pm — HARD STOP for tool-results overflow recovery (read
  requirements.md once, if redirected to tool-results file read that once, STOP).
  Updated grep-after-read evidence (CLEAN). Updated branch shortcut evidence (CLEAN).
- 20260314T034010: pm — strengthened tool-results HARD STOP: explicit "this is
  a FACT" + "ZERO re-reads" + removed ambiguity. PM said "NOT in context" after
  tool-results read → 1 Grep + 5 offset reads ($1.84, 21t).
- 20260314T034010: architect — updated grep-after-read evidence (4-run trail),
  added "note FR-* IDs in text response" instruction.
- 20260314T034433: pm — updated branch shortcut evidence (REGRESSION on
  sdlc/issue-51), updated tool-results HARD STOP evidence (offset re-read +
  2 Grep), updated grep-after-read evidence (2 violations).
- 20260314T034433: developer — added "push ONCE, accept up-to-date" rule.
  3 push attempts wasted 3 turns.

## Lessons Learned
- PM/SDS-update scope overlap resolved by explicit constraints in PM prompt.
- Total pipeline cost baseline for M-effort issue: ~$3.00.
- Run artifacts under .sdlc/runs/ are gitignored — agents must use `git add -f`.
- QA self-approval fails (same user can't approve own PR). Need fallback path.
- TodoWrite in developer is pure overhead. Banned — confirmed 0 calls (5+ runs).
- **Blacklist approach fails for Bash commands.** WHITELIST is correct.
- **Step ordering matters.** Put fast-path shortcuts FIRST.
- **"FORBIDDEN" keyword is insufficient for multi-edit waste.** Positive
  instruction > ban.
- **Rule placement matters.** HARD STOP before Responsibilities = strongest.
  Nested rules in paragraphs, Efficiency sections, or Rules lists get ignored.
- **Cross-agent patterns:** When fixing a waste pattern in one agent, ALWAYS
  apply to ALL agents.
- **Grep-after-read is cross-agent — now RESOLVED across all agents.**
- **Post-write re-reads are developer-specific.** RESOLVED.
- **Branch shortcut was the most persistent pattern (5 runs).** Pseudocode
  algorithm with explicit IF/ELSE finally broke the pattern.
- **"NEVER Edit" rules in Rules section get ignored.** Only HARD STOP at top
  of prompt is reliable.
- **Tool-results overflow is a new failure mode.** When Read output exceeds
  inline limit, it's redirected to a tool-results file. Agent must read that
  file once — NOT re-read the original with offset/limit or Bash cat.
- **"Content IS in context" assertion is insufficient.** PM read tool-results
  file but still claimed content was NOT in context. Stronger fix: explicit
  "this is a FACT" + "ZERO re-reads" + remove any ambiguity about whether
  content was successfully loaded.
- **PM branch shortcut is model-sensitive.** Algorithm works on some runs but
  regresses on others even with identical prompt. May need structural
  enforcement (e.g., engine-level branch detection) rather than prompt-only fix.
- **Developer push retry is a new waste pattern.** When tech-lead already
  pushed, developer's push returns "up-to-date" and retries with different
  syntax. Fix: explicit "one push, accept up-to-date" rule.
