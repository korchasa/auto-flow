# Meta-Agent Memory

## Agent Baselines
- pm (specification): 10t/$0.47/55s — stable
- architect (design): 14t/$0.40/53s — stable
- tech-lead (decision): 13t/$0.42/64s — stable
- developer (build): 12t/$0.51/61s — improved (was 17t), chunk-read waste remains
- qa (verify): 16t/$0.54/79s — improved (was 19t), offset/limit fix confirmed
- Total run cost: $2.34
- 1 iteration (QA passed first try)

## Active Patterns
- pm-multi-edit-srs: RESOLVED, first seen 20260313T234144,
  last seen 20260314T000902. Fix (draft→Write, NEVER Edit) confirmed working:
  16t/2 Writes in 20260314T010515. 1 clean run.
- developer-multi-edit-waste: RESOLVED, first seen 20260313T230627,
  last seen 20260314T000902. Fix (replace_all + checklist) confirmed working:
  20t/$1.21 in 20260314T010515 (was 81t/$7.02). 1 clean run.
- developer-reread-waste: RESOLVED, first seen 20260314T000902.
  20t/11 Reads in 20260314T010515 (no wasted re-reads). 1 clean run.
- qa-reread-waste: RESOLVED, first seen 20260313T234144,
  last seen 20260314T013359. Fix v2 confirmed: 13t/1 temp read in 20260314T014728
  (was 21t/7 reads). Explicit path pattern + evidence in prompt = effective.
- developer-temp-reread: RESOLVED, first seen 20260314T014728,
  last seen 20260314T014728. Fix confirmed: 0 temp re-reads in 20260314T014914.
- pm-offset-reread: RESOLVED, first seen 20260314T014914,
  last seen 20260314T014914. Fix confirmed: 0 offset/limit re-reads in
  20260314T020000 (2 Reads total, no offset/limit). 2 clean runs.
- developer-offset-reread: WATCHING, first seen 20260314T020214,
  last seen 20260314T020922. Previous fix insufficient — developer chunk-read
  temp file 4x (never did full read, used offset/limit from start). Fix v2:
  banned ALL offset/limit params, not just "re-reads after full read".
- qa-offset-reread: RESOLVED, first seen 20260314T020214,
  last seen 20260314T020214. Fix confirmed: 0 offset/limit reads in
  20260314T020922. 3 Reads total, all clean.
- developer-grep-via-bash: NEW, first seen 20260314T020922. Developer ran
  `grep -rn` via Bash despite existing ban. Fix: rewrote rule as explicit
  Bash whitelist (only deno task check, git add/commit/push).
- pm-branch-shortcut-regression: RESOLVED (3 consecutive runs with shortcut
  working: 22→17t, no gh issue list on branch).
- tech-lead-bash-exploration: RESOLVED (all 8 Bash commands whitelisted,
  17t down from 25t). Whitelist approach confirmed effective.
- qa-bash-explosion: RESOLVED (6 Bash commands, all whitelisted).
  Whitelist approach confirmed effective.

## Applied Fixes Log
- 20260313T021326: pm — CRITICAL HARD CONSTRAINT on design.md → RESOLVED
- 20260313T023047: developer — efficiency guidance → RESOLVED
- 20260313T161422: tech-lead — simplified git workflow → RESOLVED (17t stable)
- 20260313T223344: tech-lead — FORBIDDEN stash/checkout/pull → RESOLVED
- 20260313T224909: qa — FORBIDDEN Agent+Bash → superseded by whitelist
- 20260313T230627: pm — reordered steps (shortcut=step1) → RESOLVED (17t)
- 20260313T230627: tech-lead — Bash WHITELIST → RESOLVED (all 8 cmds valid)
- 20260313T230627: developer — FORBIDDEN multi-edit + re-reads → FAILED (ignored)
- 20260313T230627: qa — Bash WHITELIST → RESOLVED (6 cmds, all valid)
- 20260313T234144: developer — ONE WRITE PER FILE mandatory → FAILED (81t, 22 writes)
- 20260313T234144: qa — ONE READ PER FILE mandatory → IMPROVED (24t from 27t)
- 20260313T234144: pm — ONE WRITE for SRS mandatory → FAILED (13 Edits, worse)
- 20260314T000902: pm — step-by-step enforcement: draft→Write, NEVER Edit → RESOLVED
  (16t/2 Writes in 20260314T010515)
- 20260314T000902: developer — replace_all for renames, mandatory checklist → RESOLVED
  (20t/$1.21 in 20260314T010515, down from 81t/$7.02)
- 20260314T010515: no fixes needed — all agents within acceptable ranges
- 20260314T013359: qa — strengthened temp-file re-read rule with explicit path
  pattern and dual-run evidence. → RESOLVED (13t in 20260314T014728)
- 20260314T014728: developer — added explicit temp-file re-read prevention
  (mirroring QA fix). 3 re-reads of check output temp file. → RESOLVED (0 in 20260314T014914)
- 20260314T014914: pm — added FORBIDDEN offset/limit re-read rule. PM read
  requirements.md 5x (1 full + 4 offset/limit). → RESOLVED (0 in 20260314T020000)
- 20260314T020000: no fixes needed — all agents within acceptable ranges
- 20260314T020214: developer — added FORBIDDEN offset/limit re-read rule.
  Re-read requirements.md at offset=822 after full read. → FAILED (chunk-read
  temp file 4x in 20260314T020922; rule only covered "after full read")
- 20260314T020214: qa — added FORBIDDEN offset/limit + no-partial-reads rule.
  Read requirements.md with limit=100, then offset=820. → RESOLVED (0 in 20260314T020922)
- 20260314T020922: developer — banned ALL offset/limit params on Read + rewrote
  Bash rule as explicit whitelist. Chunk-read temp file 4x + grep via Bash. → WATCHING

## Lessons Learned
- PM/SDS-update scope overlap resolved by explicit constraints in PM prompt.
- Engine loop bug (buildContext node lookup) fixed in commit f9c9983.
- Total pipeline cost baseline for M-effort issue: ~$6.00.
- Pipeline config gap: build node has no input from verify for iter > 1.
- Run artifacts under .sdlc/runs/ are gitignored — agents must use `git add -f`.
- QA self-approval fails (same user can't approve own PR). Need fallback path.
- TodoWrite in developer is pure overhead. Banned — confirmed 0 calls (3 runs).
- **Blacklist approach fails for Bash commands.** WHITELIST is correct — now
  confirmed effective for tech-lead (3 runs) and QA (2 runs).
- **Step ordering matters.** Put fast-path shortcuts FIRST. Confirmed effective.
- **"FORBIDDEN" keyword is insufficient for multi-edit waste.** Agents ignore
  "FORBIDDEN multiple edits" because each individual Edit feels justified.
  Reframed as "ONE WRITE PER FILE (MANDATORY)" — positive instruction > ban.
- **Re-read waste is a distinct pattern from multi-edit waste.** QA re-reads
  tool output files (not source files) — need explicit rule covering ALL file
  types including tool-result temp files.
- **"ONE WRITE/READ" rules alone are insufficient.** Developer ignored them at
  81 turns. Root cause: agent doesn't plan ahead — edits file, runs check,
  re-reads to fix, re-writes. Fix: mandatory pre-edit checklist + replace_all
  for rename tasks.
- **PM ignores "ONE WRITE" when task has many SRS sections to update.**
  Root cause: Edit feels easier per-section. Fix: make Edit on SRS explicitly
  forbidden + enforce step-by-step (draft in text → one Write).
- **QA temp-file re-read is a persistent pattern.** Generic "ONE READ PER FILE"
  rule is insufficient — agent doesn't recognize tool-result temp files as
  "files" covered by the rule. Must explicitly name the path pattern and
  reference concrete past failures.
- **Temp-file re-read pattern is cross-agent.** Any agent that runs
  `deno task check` via Bash can exhibit it. When fixing in one agent, proactively
  apply same fix to all agents that run Bash commands with large output.
- **Offset/limit re-reads are a distinct waste pattern.** Agent reads full file
  (under 2000 lines), then re-reads sections with offset/limit — believing
  it needs "focused" reads. Must explicitly forbid offset/limit after full read.
- **Offset/limit re-read is a cross-agent pattern.** PM fix (20260314T014914)
  was not proactively applied to developer/QA. Same pattern recurred in both.
  When fixing a waste pattern in one agent, ALWAYS apply to ALL agents.
- **"After full read" condition is too narrow.** Developer never did a full
  read — it chunk-read from the start with offset/limit. Rule must ban
  offset/limit unconditionally, not just "after a full read".
