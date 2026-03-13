# Meta-Agent Memory

## Agent Baselines
- pm (specification): 29t/$0.90/222s ← REGRESSION from 2t, target ≤12
- architect (design): 9t/$0.55/125s (stable)
- tech-lead (decision): 29t/$1.04/205s ← improved from 43t, target ≤15
- executor (build): 34t/$1.31/220s (1 iter) ← regression from 9t, target ≤25
- qa (verify): 26t/$0.59/243s (1 iter, PASS) ← target ≤18
- Total run cost: ~$4.40 (down from $5.27; baseline $4.83)

## Active Patterns
- executor-read-overhead: RESOLVED, first seen 20260313T023047,
  last seen 20260313T161422. Clean for 1 run.
- first-pass-qa-success: RESOLVED, first seen 20260313T023047,
  last seen 20260313T195608. QA passed iter-1 in 20260313T195608.
  Impl loop completed in 1 iteration.
- tech-lead-git-thrashing: WATCHING, first seen 20260313T161422,
  last seen 20260313T195608. Improved 43→29 turns. First commit failed
  (gitignored run artifacts), needed `git add -f`. Fix applied: added
  `git add -f` guidance and branch-reuse logic.
- executor-iter2-reinvestigation: NOT TRIGGERED (1 iter only). WATCHING.
- pm-over-exploration: NEW, first seen 20260313T195608.
  PM viewed 5 issues (44, 43, 42, 56, 23) despite finding in-progress
  issue immediately. Also ran 5+ grep commands on pipeline.yaml.
  Fix applied: stop-exploring guidance + turn target ≤12.
- executor-grep-via-bash: NEW, first seen 20260313T195608.
  Executor ran 6+ grep commands via Bash despite "no shell exploration" rule.
  Root cause: prompt said "don't read docs" but task required editing docs
  (conflicting rule). Fix applied: clarified rule + reinforced Read tool +
  lowered target to ≤25.
- qa-redundant-verification: NEW, first seen 20260313T195608.
  QA ran 20 bash commands (many greps) for verification already covered by
  deno task check. Also tried self-approve (failed), fell back to issue
  comment. Fix applied: trust-deno-task-check guidance + self-approval
  failure handling + typical turn breakdown.

## Applied Fixes Log
- 20260313T021326: pm — CRITICAL HARD CONSTRAINT on design.md → RESOLVED
- 20260313T023047: executor — efficiency guidance → RESOLVED (9 turns)
- 20260313T161422: tech-lead — simplified git workflow → PARTIAL (43→29,
  still above ≤15). 20260313T195608: added branch-reuse + git add -f → WATCHING
- 20260313T161422: executor — QA report path + trust QA → NOT TRIGGERED (1 iter)
- 20260313T195608: pm — stop-exploring after in-progress found + target ≤12 → WATCHING
- 20260313T195608: executor — clarified doc-read rule + reinforced Read tool +
  target ≤25 → WATCHING
- 20260313T195608: qa — trust deno task check + self-approval fallback +
  target ≤18 with turn breakdown → WATCHING

## Lessons Learned
- PM/SDS-update scope overlap resolved by explicit constraints in PM prompt.
- Engine loop bug (buildContext node lookup) fixed in commit f9c9983.
- Total pipeline cost baseline for M-effort issue: ~$4.40-$4.83.
- Pipeline config gap: build node has no input from verify for iter > 1.
  Workaround: hardcoded relative path in executor prompt.
- Git stash-pop across pipeline nodes is fragile — prefer clean branch creation.
- Run artifacts under .sdlc/runs/ are gitignored — agents must use `git add -f`.
- QA self-approval fails (same user can't approve own PR). Need fallback path.
- PM issue triage needs explicit stop condition — without it, PM explores all
  open issues even when in-progress issue is found immediately.
