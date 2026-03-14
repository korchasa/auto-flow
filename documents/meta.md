# Meta-Agent Memory

## Agent Baselines
- pm (specification): 19t/$0.95/233s — REGRESSION from 12t/$0.57. Branch shortcut + Grep violations
- architect (design): 18t/$0.46/85s — IMPROVED from 23t/$0.91. Git archaeology fix working (8→1 git cmd)
- tech-lead (decision): 17t/$0.63/146s — stable
- developer (build): 13t/$0.68/117s — slight regression from 10t/$0.61 (2 Grep-after-Read)
- qa (verify): 15t/$0.43/75s — IMPROVED from 18t/$0.65
- Total run cost: $3.16 (improved from $3.38)
- 1 iteration (QA passed first try)

## Active Patterns
- pm-branch-shortcut-v2: WATCHING, first seen 20260314T062600. On `sdlc/issue-15`,
  PM ran git pull + 2x gh issue list despite branch shortcut rule existing in TWO
  places. 8th consecutive violation. Fix: restructured PM prompt from scattered
  HARD STOPs to single EXECUTION ALGORITHM with mandatory text checkpoint after
  git branch output.
- pm-grep-after-read-v2: WATCHING, first seen 20260314T054224, last seen
  20260314T062600. REGRESSED from 1 Grep to 4 Grep calls on requirements.md.
  Fix: integrated into execution algorithm with mandatory "Content loaded" text
  checkpoint after Read step.
- pm-tool-results-reread-v2: WATCHING, first seen 20260314T062600. Read same
  tool-results file twice. Fix: integrated into execution algorithm step 3.
- architect-git-archaeology: WATCHING (improving), first seen 20260314T062340,
  last seen 20260314T062600. Down from 8 git commands to 1 (`git log --oneline`).
  Fix: switched from blacklist to WHITELIST for Bash commands.
- architect-reread-offset: NEW, first seen 20260314T062600. Read requirements.md
  fully, then re-read with offset=836/limit=80. Fix: added evidence to existing
  HARD STOP rule.
- pm-edit-requirements: RESOLVED (2 clean runs: 062340, 062600)
- recursive-skill-call: RESOLVED (2 clean runs: 062340, 062600)
- tech-lead-merge-conflicts: RESOLVED (2 clean runs: 062340, 062600)

## Resolved Patterns
- developer-grep-after-read: RESOLVED (3+ clean runs)
- tech-lead-write-rewrite: RESOLVED (3 clean runs)
- tech-lead-git-stash: RESOLVED (3 clean runs)
- qa-tool-results-reread: RESOLVED (3 clean runs)
- qa-duplicate-pr-list: RESOLVED (3 clean runs)
- pm-grep-after-read: RESOLVED (3+ clean runs)
- developer-file-rereads: RESOLVED (3+ clean runs)
- pm-multi-edit-srs: RESOLVED (3+ clean runs)
- pm-tool-results-reread: RESOLVED (3 clean runs)
- pm-branch-shortcut-regression: RESOLVED (3 clean runs)
- qa-grep-after-read-v3: RESOLVED (3 clean runs)
- qa-deno-check-double: RESOLVED (2 clean runs)
- pm-edit-requirements: RESOLVED (2 clean runs)
- recursive-skill-call: RESOLVED (2 clean runs)
- tech-lead-merge-conflicts: RESOLVED (2 clean runs)

## Applied Fixes Log
- 20260313T021326–20260314T054224: (compressed — see git history for details)
- 20260314T054156: pm — positive ALGORITHM for Grep-after-Read. developer/qa —
  FORBIDDEN Skill moved to absolute top of prompt.
- 20260314T062340: architect — added HARD STOP against git archaeology (git log,
  git show, git branch, git diff HEAD..origin). Evidence: 8 git commands → 1.
- 20260314T062600: pm — MAJOR RESTRUCTURE: replaced 8 scattered HARD STOP blocks
  (65 lines) with single EXECUTION ALGORITHM (numbered steps with mandatory text
  checkpoints). Each step tells agent WHAT to do + inline prohibitions. Addresses
  branch shortcut (8 consecutive violations), Grep-after-Read (4 violations),
  tool-results re-read (1 violation). architect — switched git archaeology ban
  from blacklist to Bash WHITELIST (only gh issue comment, mkdir, ls allowed).
  Added evidence for offset/limit re-read violation.

## Lessons Learned
- Total pipeline cost baseline for M-effort issue: ~$2.30 (down from ~$5.00).
- Run artifacts under .sdlc/runs/ are gitignored — agents must use `git add -f`.
- QA self-approval fails (same user can't approve own PR). Need fallback path.
- **Blacklist approach fails for Bash commands.** WHITELIST is correct.
- **Rule placement matters.** HARD STOP before Responsibilities = strongest.
- **Cross-agent patterns:** Fix in one agent, apply to ALL.
- **Positive algorithms > prohibition.** Ban-only HARD STOP fails for entrenched
  behavior. Positive algorithm (WHAT to do) works.
- **Skill tool is a trap.** Fix: FORBIDDEN + positive first-action at absolute
  top of prompt (before Role description). Confirmed working in 062340+062600.
- **Cost trajectory:** $5.09→$2.31→$4.67→$5.73→$3.38→$3.16. Trend recovering.
- **Git archaeology is wasteful.** Agents should plan from current checkout +
  spec, not explore git history for prior implementations.
- **Scattered HARD STOPs cause rule fatigue.** 8 separate prohibition blocks
  spanning 65 lines are less effective than a single numbered execution algorithm
  with mandatory text checkpoints. Agent follows steps, not a list of don'ts.
- **Text checkpoint technique:** Requiring agent to WRITE analysis in text
  response ("Branch: X. Issue: N.") before next tool call creates a commitment
  device that prevents skipping the conditional logic.
