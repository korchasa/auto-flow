# Meta-Agent Memory

## Agent Baselines
- pm (specification): 17t/$0.99/233s — improved from 22t; branch shortcut works
- architect (design): 8t/$0.52/133s (stable, no fix needed)
- tech-lead (decision): 17t/$0.59/113s — improved from 25t; whitelist works
- executor (build): 53t/$3.01/593s — down from 67t but still 2x target
- qa (verify): 27t/$0.89/146s — 1 iteration (PASS), down from 34t
- Total run cost: ~$6.00 (stable vs $6.20 last run)
- 1 iteration (QA passed first try)

## Active Patterns
- pm-multi-edit-srs: NEW, first seen 20260313T234144. 3 Edits on requirements.md
  instead of 1 Write. Fix: added "ONE WRITE for SRS" rule.
- executor-multi-edit-waste: PERSISTS, first seen 20260313T230627,
  last seen 20260313T234144. requirements.md edited 6x (should be 1 Write),
  stage-9 edited 4x. "FORBIDDEN multiple edits" ignored. Fix: reworded to
  "ONE WRITE PER FILE (MANDATORY)" with concrete evidence.
- qa-reread-waste: NEW, first seen 20260313T234144. deno check output read 7x
  (6 wasted). 5 Grep after Read on requirements.md. Fix: added explicit
  "ONE READ PER FILE" rule + "FORBIDDEN Grep after Read" with evidence.
- pm-branch-shortcut-regression: RESOLVED (3 consecutive runs with shortcut
  working: 22→17t, no gh issue list on branch).
- tech-lead-bash-exploration: RESOLVED (all 8 Bash commands whitelisted,
  17t down from 25t). Whitelist approach confirmed effective.
- qa-bash-explosion: RESOLVED (6 Bash commands, all whitelisted).
  Whitelist approach confirmed effective.

## Applied Fixes Log
- 20260313T021326: pm — CRITICAL HARD CONSTRAINT on design.md → RESOLVED
- 20260313T023047: executor — efficiency guidance → RESOLVED
- 20260313T161422: tech-lead — simplified git workflow → RESOLVED (17t stable)
- 20260313T223344: tech-lead — FORBIDDEN stash/checkout/pull → RESOLVED
- 20260313T224909: qa — FORBIDDEN Agent+Bash → superseded by whitelist
- 20260313T230627: pm — reordered steps (shortcut=step1) → RESOLVED (17t)
- 20260313T230627: tech-lead — Bash WHITELIST → RESOLVED (all 8 cmds valid)
- 20260313T230627: executor — FORBIDDEN multi-edit + re-reads → FAILED (ignored)
- 20260313T230627: qa — Bash WHITELIST → RESOLVED (6 cmds, all valid)
- 20260313T234144: executor — ONE WRITE PER FILE mandatory, pre-edit planning,
  evidence from this run (req.md 6x edit, stage-9 4x edit). Target ≤25 → WATCHING
- 20260313T234144: qa — ONE READ PER FILE mandatory, FORBIDDEN Grep after Read
  with evidence (check output 7x read, 5 Grep after Read). Target ≤10 → WATCHING
- 20260313T234144: pm — ONE WRITE for SRS mandatory, target adjusted ≤8 → WATCHING

## Lessons Learned
- PM/SDS-update scope overlap resolved by explicit constraints in PM prompt.
- Engine loop bug (buildContext node lookup) fixed in commit f9c9983.
- Total pipeline cost baseline for M-effort issue: ~$6.00.
- Pipeline config gap: build node has no input from verify for iter > 1.
- Run artifacts under .sdlc/runs/ are gitignored — agents must use `git add -f`.
- QA self-approval fails (same user can't approve own PR). Need fallback path.
- TodoWrite in executor is pure overhead. Banned — confirmed 0 calls (3 runs).
- **Blacklist approach fails for Bash commands.** WHITELIST is correct — now
  confirmed effective for tech-lead (3 runs) and QA (2 runs).
- **Step ordering matters.** Put fast-path shortcuts FIRST. Confirmed effective.
- **"FORBIDDEN" keyword is insufficient for multi-edit waste.** Agents ignore
  "FORBIDDEN multiple edits" because each individual Edit feels justified.
  Reframed as "ONE WRITE PER FILE (MANDATORY)" — positive instruction > ban.
- **Re-read waste is a distinct pattern from multi-edit waste.** QA re-reads
  tool output files (not source files) — need explicit rule covering ALL file
  types including tool-result temp files.
