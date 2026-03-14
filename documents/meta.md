# Meta-Agent Memory

## Agent Baselines
- pm (specification): 12t/$0.37/77s — stable. 2 Grep after Read remain.
- architect (design): 13t/$0.29/69s — stable. 2 Grep after Read on requirements.md.
- tech-lead (decision): 21t/$0.53/119s — REGRESSED (19→21t, $0.39→$0.53). Triple design.md access + double git commit.
- developer (build): 15t/$0.31/69s — REGRESSED (6→15t, $0.17→$0.31). 4 searches on pipeline.yaml + double git commit. (Previous run was verify-and-close = less work.)
- qa (verify): 23 calls/$0.75/91s — REGRESSED ($0.58→$0.75). 7 individual SKILL.md reads + background deno check + ToolSearch/TaskOutput.
- Total run cost: $2.25 (up from $1.75 but previous was verify-and-close)
- 1 iteration (QA passed first try)

## Active Patterns
- pm-grep-after-read-v3: WATCHING, last seen 074859. Still 2 Grep calls on
  requirements.md after Read. 4th consecutive violation.
- qa-individual-file-reads-v2: WATCHING, last seen 074859. QA read 7 SKILL.md
  files individually. Fix: added HARD STOP "Do NOT Read SKILL.md files" + scope
  clarification (verify implementation, not agent prompts).
- qa-background-deno-check: WATCHING, last seen 074859. 2nd consecutive run.
  Fix: stronger FOREGROUND mandate with exact Bash call syntax.
- tl-design-md-reread: WATCHING, last seen 074859. 2nd consecutive run. Triple
  access (Read + Grep + 2 partial Reads). Fix: added ALGORITHM requiring text
  extraction after parallel reads.
- double-git-commit: NEW, first seen 074859. Both tech-lead and developer tried
  `git add` without `-f` for .sdlc/runs/ paths, failed, retried. Fix: explicit
  chained `git add -f` + commit in one Bash call in both prompts.
- dev-bash-grep: NEW, first seen 074859. Developer used `grep -A1` + `grep -A3`
  via Bash on pipeline.yaml after 2 Grep tool calls = 4 total searches. Fix:
  added ALGORITHM for single-call search with sufficient context.
- architect-grep-after-read-v2: WATCHING, last seen 074859. 6th consecutive
  violation. 2 Greps on requirements.md after Read. Evidence updated.

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
- qa-deno-check-double: RESOLVED → MUTATED into qa-background-deno-check
- pm-edit-requirements-v2: RESOLVED (3 clean runs: 073009, 074913, 074859)
- pm-skill-self-invocation: RESOLVED (3 clean runs: 073009, 074913, 074859)
- qa-skill-self-invocation: RESOLVED (3 clean runs: 073009, 074913, 074859)
- pm-branch-shortcut-v3: RESOLVED (3 clean runs: 073009, 074913, 074859)
- recursive-skill-call: RESOLVED (3+ clean runs)
- tech-lead-merge-conflicts: RESOLVED (3+ clean runs)
- architect-git-archaeology: RESOLVED (3+ clean runs)
- architect-reread-offset: RESOLVED (3+ clean runs)
- dev-individual-file-reads: RESOLVED (3 clean runs: 073009, 074913, 074859)
- architect-bulk-file-reads: RESOLVED (3 clean runs: 073009, 074913, 074859)
- tl-push-force-with-lease: RESOLVED (1 clean run: 074859). git push -f worked.
- qa-bash-grep-v2: WATCHING → not violated in 074859. Keep watching.

## Applied Fixes Log
- 20260313T021326–20260314T062600: (compressed — see git history for details)
- 20260314T072450: pm/qa — anti-Skill before # Role heading. dev — Grep-first.
- 20260314T073009: qa — deno check algorithm + Bash grep prohibition.
  architect — HARD STOP for cross-file checks.
- 20260314T074913: qa — FOREGROUND mandatory, banned ToolSearch/TaskOutput.
  tech-lead — git push -f, forbidden git commands, read-once evidence.
- 20260314T074859: qa — HARD STOP "Do NOT Read SKILL.md files" (7 individual
  reads → should be 0 or 1 Grep). Stronger FOREGROUND mandate with exact Bash
  syntax. ToolSearch/TaskOutput prohibition with causal link to background mode.
  tech-lead — text-extraction ALGORITHM after parallel reads (triple design.md
  access). Chained `git add -f && commit` in one Bash call.
  developer — ALGORITHM for single-call Grep with sufficient context (4 searches
  → 1). Chained `git add -f` for .sdlc/runs/ artifacts.
  architect — updated Grep-after-Read evidence (6th consecutive violation).

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
- **Cost trajectory:** $5.09→$2.31→$4.67→$5.73→$3.38→$3.16→$4.09→$3.16→$1.75→$2.25.
- **Git archaeology is wasteful.** Agents should plan from current checkout.
- **Scattered HARD STOPs cause rule fatigue.** Single execution algorithm better.
- **Text checkpoint technique:** Requiring agent to WRITE analysis in text
  response creates commitment device.
- **Grep-first for multi-file verification.** One Grep replaces N Reads.
- **--force-with-lease fails without tracking ref.** Use `git push -f`.
- **Background Bash is an anti-pattern for short commands.** deno task check
  takes ~30s — not worth background mode overhead.
- **Double git commit pattern:** `.sdlc/runs/` is gitignored. Agents must use
  `git add -f` on FIRST attempt, not try without -f then retry. Chain
  `git add -f <path> && git commit` in one Bash call to prevent this.
- **Incremental context search is wasteful.** When searching for a pattern, use
  sufficient `-A`/`-C` from the first call. Don't do Grep(-C 0) → Grep(-A 5) →
  bash grep -A1 → bash grep -A3.
