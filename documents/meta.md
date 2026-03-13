# Meta-Agent Memory

## Agent Baselines
- pm (specification): 23t/$0.66/185s ← down from 29t, still above target ≤12
- architect (design): 8t/$0.52/124s (stable, no fix needed)
- tech-lead (decision): 32t/$1.01/165s ← REGRESSION from 29t, target ≤15
- executor (build): 48t/$2.52/409s (1 iter) ← REGRESSION from 34t, target ≤25
- qa (verify): 17t/$0.39/83s (1 iter, PASS) ← within target ≤18, RESOLVED
- Total run cost: ~$5.10 (up from $4.40; baseline $4.83)

## Active Patterns
- executor-read-overhead: RESOLVED, first seen 20260313T023047,
  last seen 20260313T161422. Clean for 2 runs.
- first-pass-qa-success: RESOLVED, first seen 20260313T023047,
  last seen 20260313T204755. QA passed iter-1 in 3 consecutive runs.
- tech-lead-git-thrashing: WATCHING, first seen 20260313T161422,
  last seen 20260313T204755. REGRESSED 29→32 turns. Root cause: unnecessary
  stash+checkout-main ceremony, push failure from existing remote branch,
  4 granular design.md edits. Fix applied: simplified git workflow (create from
  origin/main, --force-with-lease), batch edit guidance.
- executor-iter2-reinvestigation: NOT TRIGGERED (1 iter only). WATCHING.
- pm-over-exploration: WATCHING, first seen 20260313T195608,
  last seen 20260313T204755. Improved 29→23 but still 2x target. Root cause:
  PM ignores branch name hint, views 4+ issues despite in-progress match.
  Prior fix insufficient. New fix: branch shortcut (skip triage if on
  sdlc/issue-<N>), HARD STOP language, removed AGENTS.md from read list.
- executor-serial-reads: NEW, first seen 20260313T204755.
  Executor read 7 files one-per-turn (6 wasted turns). Also called TodoWrite
  8 times (5 wasted turns) and re-read 4 files before editing.
  Fix applied: mandatory parallel batch reads, banned TodoWrite, batch edits.
- executor-grep-via-bash: RESOLVED, first seen 20260313T195608,
  last seen 20260313T195608. No grep-via-bash in this run.
- qa-redundant-verification: RESOLVED, first seen 20260313T195608,
  last seen 20260313T195608. QA hit target (17t) this run.

## Applied Fixes Log
- 20260313T021326: pm — CRITICAL HARD CONSTRAINT on design.md → RESOLVED
- 20260313T023047: executor — efficiency guidance → RESOLVED (9 turns)
- 20260313T161422: tech-lead — simplified git workflow → PARTIAL (43→29→32)
- 20260313T161422: executor — QA report path + trust QA → NOT TRIGGERED
- 20260313T195608: pm — stop-exploring after in-progress found → PARTIAL (29→23)
- 20260313T195608: executor — clarified doc-read rule → PARTIAL (34→48 REGRESSED)
- 20260313T195608: qa — trust deno task check + turn breakdown → RESOLVED (17t)
- 20260313T204755: pm — branch shortcut + HARD STOP + removed AGENTS.md read
  + enforce single-read rule → WATCHING
- 20260313T204755: tech-lead — eliminated stash/checkout-main, force-with-lease
  default, batch edit guidance, typical turn breakdown → WATCHING
- 20260313T204755: executor — mandatory parallel batch reads, banned TodoWrite,
  batch same-file edits, read-once-edit-immediately rule → WATCHING

## Lessons Learned
- PM/SDS-update scope overlap resolved by explicit constraints in PM prompt.
- Engine loop bug (buildContext node lookup) fixed in commit f9c9983.
- Total pipeline cost baseline for M-effort issue: ~$4.40-$5.10.
- Pipeline config gap: build node has no input from verify for iter > 1.
  Workaround: hardcoded relative path in executor prompt.
- Git stash-pop across pipeline nodes is fragile — prefer clean branch creation.
- Run artifacts under .sdlc/runs/ are gitignored — agents must use `git add -f`.
- QA self-approval fails (same user can't approve own PR). Need fallback path.
- PM issue triage needs explicit stop condition — without it, PM explores all
  open issues even when in-progress issue is found immediately.
- TodoWrite in executor is pure overhead — each call costs a turn and does not
  advance implementation. Banned in prompt.
- Serial file reads are the #1 turn waster in executor. Parallel batch reads
  can save 5-6 turns per run.
- Tech-lead git workflow must assume remote branch may exist from prior runs.
  Always use --force-with-lease instead of plain push.
