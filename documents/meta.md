# Meta-Agent Memory

## Agent Baselines
- pm (specification): 16t/$0.65/87s — up from 13t/$0.50 (requirements.md hit 26k token limit)
- architect (design): 11t/$0.49/75s — stable
- tech-lead (decision): 13t/$0.50/81s — improved (was 18t/$0.68)
- developer (build): 16t/$0.51/73s — stable cost, but 9/13 Reads wasted on SKILL.md files
- qa (verify): 19t/$0.73/93s — up from 15t/$0.52. 6/10 Reads wasted on SKILL.md files
- Total run cost: $2.88 (up from $2.50)
- 1 iteration (QA passed first try)

## Active Patterns
- skill-self-invoke-cross-agent: WATCHING, first seen 20260314T052906, last
  seen 20260314T092842. Developer + QA both called Skill as first action AGAIN.
  Root cause identified: unresolved merge conflict markers in SKILL.md corrupted
  prompt structure — FORBIDDEN rules were garbled between conflict markers.
  Fix: resolved all conflicts in all 7 agents. Need 1 clean run to confirm.
- agent-skill-read-waste: NEW, first seen 20260314T092842. Developer read ALL
  7 agent SKILL.md files (9 wasted Reads). QA read all 6 other agent SKILL.md
  files (6 wasted Reads). Fix: added HARD STOP "Do NOT read .claude/skills/"
  rule to both agents.
- merge-conflict-corruption: NEW→FIXED in 20260314T092842. 6 of 7 agent
  SKILL.md files + meta.md had unresolved merge conflicts from FR-40/FR-43
  commits. All resolved.
- cross-run-path-confusion: WATCHING→2nd clean run (092842). 1 more to RESOLVE.
- tech-lead-design-reread: WATCHING→1st clean run (092842). 2 more to RESOLVE.
- developer-bash-whitelist-violation: WATCHING→1st clean run (092842). 2 more.

## Resolved Patterns
- pm-tool-results-reread: RESOLVED (3+ clean runs)
- developer-grep-after-read: RESOLVED (3+ clean runs)
- qa-double-check: RESOLVED (3+ clean runs)
- tech-lead-write-rewrite: RESOLVED (3+ clean runs)
- developer-scope-creep: RESOLVED (2+ clean runs)
- pm-branch-shortcut-violation: RESOLVED (2 clean runs: 085155, 092842)
- pm-grep-after-read-v2: RESOLVED (pruned)
- qa-grep-after-read-v4: RESOLVED (pruned)
- qa-tool-results-path-typos: RESOLVED (pruned)
- developer-double-edit: RESOLVED (pruned)
- qa-bash-grep-v3: RESOLVED (3+ clean runs, 083240 branch)
- qa-double-deno-check: RESOLVED (083240 branch)
- qa-toolsearch: RESOLVED (3+ clean runs, 083240 branch)
- dev-toolsearch: RESOLVED (083240 branch)
- tl-toolsearch: RESOLVED (083240 branch)
- architect-git-archaeology: RESOLVED (3+ clean runs)

## Applied Fixes Log
- 20260313T021326–20260314T085155: (compressed — see git history for details)
- 20260314T092842: ALL 7 agents — resolved merge conflict markers in SKILL.md
  (root cause of persistent Skill self-invocation). developer + qa — added
  HARD STOP prohibition on reading `.claude/skills/` files (9+6 wasted Reads).
  PM prompt consolidated (removed duplicate execution algorithm, kept STEP 1-6).
  meta.md — resolved merge conflict between HEAD and origin/main branches.

## Lessons Learned
- Total pipeline cost baseline for S-effort issue: ~$2.50.
- Run artifacts under .sdlc/runs/ are gitignored — agents must use `git add -f`.
- QA self-approval fails (same user can't approve own PR). Need fallback path.
- **Blacklist approach fails for Bash commands.** WHITELIST is correct.
- **Rule placement matters.** HARD STOP before Responsibilities = strongest.
- **Cross-agent patterns:** Fix in one agent, apply to ALL.
- **Positive algorithms > prohibition.** Algorithm approach works better.
- **Cost trajectory:** $5.09→$2.31→$2.24→$2.76→$4.11→$2.50→$2.88.
- **Scope enforcement needs explicit file path deny-lists.**
- **Merge conflicts in agent prompts are catastrophic.** They corrupt prompt
  structure — rules between conflict markers become unparseable. This was likely
  the root cause of Skill self-invocation persisting for 10+ runs despite
  escalating prohibition language. Always verify no conflict markers after merge.
- **requirements.md approaching 25k token limit.** PM hit 26k token Read error
  in 092842, causing fallback to 6 Grep calls. May need to split SRS.
- **Pre-flight checks > prohibition.** Self-check steps work better than bans.
- **Positive alternatives with exact syntax.** Providing exact Grep call syntax
  eliminates gap between "don't use bash grep" and knowing the alternative.
- **ToolSearch for built-in tools is a cross-agent anti-pattern.**
- **Background Bash is an anti-pattern for short commands.**
