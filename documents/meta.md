# Meta-Agent Memory

## Agent Baselines
- pm (specification): 12t/$0.33/59s — stable.
- architect (design): 10t/$0.22/49s — IMPROVED (13t→10t, $0.26→$0.22).
- tech-lead (decision): 15t/$0.38/93s — RECOVERED ($1.03→$0.38). ToolSearch fix worked.
- developer (build): 9t/$0.21/37s — RECOVERED ($0.49→$0.21). ToolSearch fix worked.
- qa (verify): 15t/$0.41/124s — IMPROVED (21t→15t, $0.52→$0.41). All WATCHING patterns clean.
- Total run cost: $1.55 (record low, down from $2.64)
- 1 iteration (QA passed first try)

## Active Patterns
- qa-bash-grep-v3: 2nd clean run (083240). WATCHING → need 1 more clean.
- qa-double-deno-check: 1st clean run (083240)! Was 6 consecutive. WATCHING.
- qa-toolsearch: 2nd clean run (083240). WATCHING → need 1 more clean.
- qa-unnecessary-reads: 1st clean run (083240). No requirements.md read. WATCHING.
- qa-duplicate-grep: REDUCED in 083240. 4 Grep calls (2 slightly redundant on
  pipeline.yaml) vs 5 before. Improving. WATCHING.
- tl-toolsearch: 1st clean run (083240). WATCHING.
- tl-double-tool-results-read: 1st clean run (083240). WATCHING.
- dev-toolsearch: 1st clean run (083240). WATCHING.

## Resolved Patterns
- pm-oversized-gh-output: RESOLVED (2+ clean runs)
- architect-grep-after-read-v2: RESOLVED (4 clean runs)
- tl-design-md-reread: RESOLVED (4 clean runs)
- dev-design-md-reread: RESOLVED (4 clean runs)
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
- qa-deno-check-double: RESOLVED → MUTATED into qa-background-deno-check → qa-double-deno-check
- pm-edit-requirements-v2: RESOLVED (3+ clean runs)
- pm-skill-self-invocation: RESOLVED (3+ clean runs)
- qa-skill-self-invocation: RESOLVED (3+ clean runs)
- pm-branch-shortcut-v3: RESOLVED (3+ clean runs)
- recursive-skill-call: RESOLVED (3+ clean runs)
- tech-lead-merge-conflicts: RESOLVED (3+ clean runs)
- architect-git-archaeology: RESOLVED (3+ clean runs)
- architect-reread-offset: RESOLVED (3+ clean runs)
- dev-individual-file-reads: RESOLVED (3+ clean runs)
- architect-bulk-file-reads: RESOLVED (3+ clean runs)
- tl-push-force-with-lease: RESOLVED (2 clean runs)
- qa-bash-grep-v2: RESOLVED → MUTATED into qa-bash-grep-v3
- qa-individual-file-reads-v2: RESOLVED (2 clean runs: 080106, 080440)
- double-git-commit: RESOLVED (3 clean runs)
- dev-bash-grep: RESOLVED (3 clean runs)

## Applied Fixes Log
- 20260313T021326–20260314T062600: (compressed — see git history for details)
- 20260314T072450: pm/qa — anti-Skill before # Role heading. dev — Grep-first.
- 20260314T073009: qa — deno check algorithm + Bash grep prohibition.
  architect — HARD STOP for cross-file checks.
- 20260314T074913: qa — FOREGROUND mandatory, banned ToolSearch/TaskOutput.
  tech-lead — git push -f, forbidden git commands, read-once evidence.
- 20260314T074859: qa — HARD STOP SKILL.md reads. Stronger FOREGROUND mandate.
  tech-lead — text-extraction ALGORITHM. Chained `git add -f && commit`.
  developer — single-call Grep ALGORITHM. Chained `git add -f`.
  architect — updated Grep-after-Read evidence (6th consecutive).
- 20260314T080106: pm — `--jq '{title,body}'` to prevent oversized gh output
  (4 retries wasted $0.24). Tool-results retry limit to 1.
  qa — banned `sed`/`for` loops via Bash. "USE INSTEAD" positive guidance.
  Updated double deno check evidence ("ONCE means ONCE").
  tech-lead — strengthened ALGORITHM with explicit fact-extraction template.
  developer — updated grep-after-read evidence with this run's data.
  architect — updated evidence to 7th consecutive violation, added ALGORITHM
  for writing FR-* IDs in text response.
- 20260314T080440: pm — pre-flight check "verify no `comments` in command"
  (2nd consecutive violation despite --jq fix). qa — Grep tool positive
  alternative with exact syntax (4th consecutive bash grep). Updated deno
  check evidence (2nd consecutive double-run).
- 20260314T081855: qa — (1) ToolSearch added to FORBIDDEN list (1st violation).
  (2) Replaced bash grep prohibition with MANDATORY ALGORITHM + exact Grep
  syntax (5th consecutive). (3) HARD STOP for requirements.md/pipeline.yaml
  reads (unnecessary context inflation, ~$0.10).
- 20260314T082012: tech-lead — (1) ToolSearch added to FORBIDDEN (1st violation,
  $1.03 vs $0.30 baseline). (2) ONE READ PER FILE for tool-results temp files
  (double read of same gh pr list output).
  developer — ToolSearch added to FORBIDDEN (1st violation, $0.49 vs $0.23).
  qa — (1) double deno check: added "pipe = second execution" explanation +
  forbidden pipe operators (6th consecutive). (2) requirements.md: updated
  evidence (2nd consecutive, read it TWICE). (3) duplicate Grep: mandate
  parallel calls + pre-list algorithm (3× contains_section, 2× ## Summary).
- 20260314T083240: No fixes needed. Record-low $1.55 run. All WATCHING patterns
  clean. ToolSearch fixes confirmed for tech-lead ($1.03→$0.38) and developer
  ($0.49→$0.21). QA double-deno-check broken after 6 consecutive violations.

## Lessons Learned
- Total pipeline cost baseline for M-effort issue: ~$2.25 (down from ~$5.00).
- Run artifacts under .sdlc/runs/ are gitignored — agents must use `git add -f`.
- QA self-approval fails (same user can't approve own PR). Need fallback path.
- **Blacklist approach fails for Bash commands.** WHITELIST is correct.
- **Rule placement matters.** Before # Role heading = strongest position.
- **Cross-agent patterns:** Fix in one agent, apply to ALL.
- **Positive algorithms > prohibition.** Ban-only HARD STOP fails for entrenched
  behavior. Positive algorithm (WHAT to do) works.
- **Skill tool is the most persistent anti-pattern.** Fix: anti-Skill as FIRST
  content (before # Role heading). 3 clean runs confirm.
- **Cost trajectory:** $5.09→$2.31→$4.67→$5.73→$3.38→$3.16→$4.09→$3.16→$1.75→$2.25→$2.28→$1.96→$1.83→$2.64→$1.55.
- **Git archaeology is wasteful.** Agents should plan from current checkout.
- **Scattered HARD STOPs cause rule fatigue.** Single execution algorithm better.
- **Text checkpoint technique:** Requiring agent to WRITE analysis in text
  response creates commitment device.
- **Grep-first for multi-file verification.** One Grep replaces N Reads.
- **--force-with-lease fails without tracking ref.** Use `git push -f`.
- **Background Bash is an anti-pattern for short commands.** deno task check
  takes ~30s — not worth background mode overhead.
- **Double git commit pattern:** `.sdlc/runs/` is gitignored. Agents must use
  `git add -f` on FIRST attempt, not try without -f then retry.
- **Incremental context search is wasteful.** Use sufficient `-A`/`-C` from
  the first call.
- **gh issue view with comments can exceed 25k tokens.** Always use `--jq` to
  filter fields. Exclude comments or limit to last N.
- **Anti-pattern mutation:** Fixing one symptom (background deno check) can
  produce a new variant (double deno check with pipe). Track mutations.
- **Pre-flight checks > prohibition.** When agents ignore "don't do X", adding
  a self-check step ("before calling Bash, verify X is absent") works better.
- **Positive alternatives with exact syntax.** Bash grep persists because agents
  don't know the Grep tool equivalent. Providing exact call syntax eliminates gap.
- **ToolSearch for built-in tools is a cross-agent anti-pattern.** Read, Write,
  Edit, Bash, Grep, Glob are always available. Applied ban to tech-lead, developer,
  QA. Must monitor all agents for this.
