# Meta-Agent Memory

## Agent Baselines
- pm (specification): 22t/$0.77/141s — improved cost but 7 Grep-after-Read + 1 Edit violation
- architect (design): 12t/$0.58/68s — clean, stable
- tech-lead (decision): 33t/$1.54/343s — REGRESSION. Merge conflicts (environmental), design.md 3x (Edit failure)
- developer (build): 14t/$1.84/490s — REGRESSION. Skill call persists despite FORBIDDEN
- qa (verify): 17t/$1.00/287s — REGRESSION. Skill call persists despite FORBIDDEN
- Total run cost: $5.73 (regression from $4.67)
- 1 iteration (QA passed first try)

## Active Patterns
- recursive-skill-call: WATCHING, first seen 20260314T054224, last seen
  20260314T054156. Developer + QA still call Skill despite FORBIDDEN rule.
  Fix in 054224 (added FORBIDDEN) did NOT work — agents call Skill as their
  FIRST action before reading rules. Fix in 054156: moved FORBIDDEN + positive
  instruction ("YOUR FIRST ACTION MUST BE: Read...") to absolute top of prompt.
- pm-grep-after-read-v2: ESCALATED, first seen 20260314T054224, last seen
  20260314T054156. 7 Grep calls on requirements.md after Read. Prohibition-only
  HARD STOP failed (2 consecutive runs). Fix in 054156: replaced with positive
  ALGORITHM (extract last FR + section in text response after Read). Same
  pattern that fixed QA's Grep issue.
- pm-edit-requirements: WATCHING, first seen 20260314T024833, last seen
  20260314T054156. Edit on requirements.md despite HARD STOP. Updated evidence
  (3 consecutive violations).
- tech-lead-merge-conflicts: NEW, first seen 20260314T054156. TL encountered
  merge conflicts in agent-pm SKILL.md, agent-qa SKILL.md, meta.md from
  meta-agent's uncommitted edits. Environmental — not a prompt issue. 8 turns
  wasted on git conflict resolution. No prompt fix applied.
- qa-deno-check-double: RESOLVED. Run 054156: deno task check ran exactly once.
  1 clean run after fix.
- qa-grep-after-read-v3: RESOLVED. 2 consecutive clean runs (054224 + 054156).

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
- qa-grep-after-read-v3: RESOLVED (2 clean runs, algorithm fix confirmed)
- qa-deno-check-double: RESOLVED (1 clean run after evidence update)

## Applied Fixes Log
- 20260313T021326–20260314T054224: (compressed — see git history for details)
- 20260314T054156: pm — replaced Grep-after-Read prohibition with positive
  ALGORITHM (extract last FR + section after Read). Updated Edit evidence (3
  consecutive violations).
- 20260314T054156: developer — moved FORBIDDEN Skill + positive first-action
  instruction to absolute top of prompt (before Role description).
- 20260314T054156: qa — moved FORBIDDEN Skill + positive first-action instruction
  to absolute top of prompt (before Role description).

## Lessons Learned
- Total pipeline cost baseline for M-effort issue: ~$2.30 (down from ~$5.00).
- Run artifacts under .sdlc/runs/ are gitignored — agents must use `git add -f`.
- QA self-approval fails (same user can't approve own PR). Need fallback path.
- **Blacklist approach fails for Bash commands.** WHITELIST is correct.
- **Rule placement matters.** HARD STOP before Responsibilities = strongest.
- **Cross-agent patterns:** Fix in one agent, apply to ALL.
- **Positive algorithms > prohibition.** Ban-only HARD STOP fails for entrenched
  behavior. Positive algorithm (WHAT to do) works. Applied to QA Grep (054224,
  confirmed working 2 runs). Now applying same to PM Grep (054156).
- **COMMAND 1/2 numbered sequence works for PM.** Resolved branch shortcut
  after 6 consecutive violations.
- **Cost trajectory:** $5.09 → $2.31 → $4.67 → $5.73 (2nd regression). Main
  drivers: Skill calls (developer+QA) + PM Grep waste + TL merge conflicts.
- **Skill tool is a trap.** Claude Code's Skill tool lets agents invoke their own
  prompt recursively. FORBIDDEN alone doesn't work — agents call Skill BEFORE
  reading the FORBIDDEN rule. Fix: place positive first-action instruction at
  absolute top of prompt (before Role description paragraph).
- **Algorithms beat prose for error recovery.** TL git branch + PM branch
  shortcut both resolved with numbered step-by-step ALGORITHMs.
- **Environmental issues inflate costs.** TL merge conflicts from meta-agent's
  uncommitted SKILL.md edits cost 8 turns/$0.40. Pipeline should ensure clean
  working tree before each node.
