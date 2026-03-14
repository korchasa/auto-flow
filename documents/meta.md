# Meta-Agent Memory

## Agent Baselines
- pm (specification): 13t/$0.69/77s — tool-results thrashing (4 wasted reads of requirements.md)
- architect (design): 11t/$0.51/54s — clean
- tech-lead (decision): 13t/$0.41/79s — clean (1 redundant git branch check)
- developer (build): 11t/$0.65/64s — no-op (implementation pre-committed)
- qa (verify): 15t/$0.76/112s — clean
- Total run cost: $3.02 (down from $3.41)
- 1 iteration (QA passed first try)

## Active Patterns
- pm-requirements-thrashing: NEW, first seen 20260314T033033. Read
  requirements.md 5 times (1 full + 1 Bash cat + 3 offset) after output
  overflowed to tool-results file. Fix: HARD STOP with tool-results recovery
  instruction added to PM prompt.
- pm-branch-shortcut-regression: RESOLVING, first seen 20260313T230627,
  last clean 20260314T033033. 1st clean run after 5 consecutive violations.
  Need 2 more clean runs to confirm RESOLVED.
- architect-grep-after-read: RESOLVING, first seen 20260314T024833,
  last clean 20260314T033033. 0 Grep calls. 1st clean run after 3 violations.

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
