# Meta-Agent Memory

## Agent Baselines
- pm: ~15 turns, ~$0.51, 111s
- tech-lead: ~8 turns, ~$0.47, 125s
- reviewer: ~16 turns, ~$0.62, 101s
- architect: ~7 turns, ~$0.20, 47s
- sds-update: ~6 turns, ~$0.27, 50s
- executor: ~50 turns, ~$2.37, 309s (49% of total cost)
- qa: ~14 turns, ~$0.39, 55s

## Active Patterns
- executor-read-overhead: WATCHING, first seen 20260313T023047,
  last seen 20260313T023047. Executor reads 10 files before first edit.
  Fix applied: added efficiency guidance to read only files from task breakdown.
- first-pass-qa-success: WATCHING, first seen 20260313T023047.
  QA passed on iteration 1. Track if impl-loop iterations stay low.

## Applied Fixes Log
- 20260313T021326: pm — added CRITICAL HARD CONSTRAINT prohibiting PM from
  editing design.md → RESOLVED (confirmed in 20260313T023047: PM only wrote spec)
- 20260313T023047: executor — added efficiency guidance to reduce unnecessary
  file reads. Target: <40 turns. → WATCHING

## Lessons Learned
- PM/SDS-update scope overlap resolved by explicit constraints in PM prompt.
- Engine loop bug (buildContext node lookup) fixed in commit f9c9983.
- Total pipeline cost baseline for M-effort issue: ~$4.83.
