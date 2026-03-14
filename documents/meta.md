# Meta-Agent Memory

## Agent Baselines
- pm (specification): 14t/$0.71/88s — stable
- architect (design): 8t/$0.40/85s — Agent subagent persists despite ban
- tech-lead (decision): 13t/$0.47/62s — stable
- developer (build): 4t/$0.20/8s — clean (no-op skip-implementation task)
- qa (verify): 17t/$0.73/105s — offset/limit re-read persists (8th run)
- Total run cost: $2.50
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
- developer-offset-reread: RESOLVED, first seen 20260314T020214,
  last seen 20260314T020922. Fix v2 confirmed: 0 offset/limit reads in
  20260314T021602. 1 clean run.
- qa-offset-reread: RESOLVED, first seen 20260314T020214,
  last seen 20260314T020214. Fix confirmed: 0 offset/limit reads in
  20260314T020922. 3 Reads total, all clean.
- developer-grep-via-bash: RESOLVED, first seen 20260314T020922,
  last seen 20260314T020922. Fix confirmed: 0 grep-via-Bash in 20260314T021602.
- developer-offset-persistent: RESOLVED, first seen 20260314T020214,
  last seen 20260314T022056. Fix v3 confirmed: 0 offset/limit reads in
  20260314T022619 (only 3 clean Reads). 1 clean run.
- qa-offset-persistent: WATCHING, first seen 20260314T020214,
  last seen 20260314T022619. Fix v3 (HARD STOP in Efficiency section) FAILED.
  Read requirements.md at offset=826. Fix v4: moved HARD STOP to top of
  prompt (before Responsibilities), replaced Efficiency section copy with
  back-reference.
- architect-subagent-waste: WATCHING, first seen 20260314T022056,
  last seen 20260314T022619. FORBIDDEN rule at line 100 FAILED — still spawned
  Agent/Explore. Fix v2: elevated to HARD STOP before Responsibilities.
- pm-bash-blacklist-ignored: WATCHING, first seen 20260314T021602,
  last seen 20260314T021602. Fix: converted to WHITELIST. Verify next run.
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
  Bash rule as explicit whitelist. Chunk-read temp file 4x + grep via Bash. → RESOLVED
- 20260314T021602: pm — converted Bash FORBIDDEN blacklist to WHITELIST. PM
  used wc+grep via Bash + offset/limit re-read (12t, target 8t). → WATCHING
- 20260314T022056: developer — elevated offset/limit ban from nested paragraph
  to top-level "HARD STOP" standalone bullet. Re-read requirements.md at
  offset=822 despite existing ban (was buried in paragraph). → WATCHING
- 20260314T022056: qa — elevated offset/limit ban from nested paragraph to
  top-level "HARD STOP" standalone bullet. Read temp file at offset=800 despite
  existing ban (was buried in paragraph). → WATCHING
- 20260314T022056: architect — added FORBIDDEN Agent tool rule. Used subagent
  for grep sweep (wasteful). → FAILED (still used Agent in 20260314T022619)
- 20260314T022619: architect — elevated Agent ban to HARD STOP at top of prompt
  (before Responsibilities). FORBIDDEN at line 100 was ignored. → WATCHING
- 20260314T022619: qa — moved offset/limit HARD STOP from Efficiency section to
  top of prompt (before Responsibilities). 8th consecutive violation at
  offset=826 on requirements.md. → WATCHING

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
- **Rule placement matters as much as rule content.** Nested rules inside
  paragraphs get ignored even with FORBIDDEN/NEVER keywords. Critical bans
  must be standalone top-level bullets with "HARD STOP" prefix to survive
  agent attention decay.
- **Section placement matters too.** HARD STOP in an "Efficiency" section
  (line 113) still gets ignored — agent treats efficiency as advisory. Moving
  the rule BEFORE Responsibilities (top of prompt, right after role description)
  is the strongest placement. Same for FORBIDDEN in a "Rules" list at line 100.
- **FORBIDDEN keyword fails for Agent tool bans.** Agent/Explore is attractive
  because it "feels thorough." Must frame as HARD STOP with explicit
  alternative: "Use Grep with `-i: true` — 1% of the cost."
