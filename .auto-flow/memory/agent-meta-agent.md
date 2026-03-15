# Meta-Agent Memory

## Agent Baselines

- PM (specification): 5-11 turns, $0.31-0.61
- Architect (design): 7-13 turns, $0.18-0.45
- Tech Lead (decision): 13-15 turns, $0.32-0.49
- Developer (build): 4-17 turns, $0.21-0.51
- QA (verify): 14-16 turns, $0.35-0.39
- Tech Lead Review: no data yet

## Active Patterns

- No active patterns. All prior patterns resolved.

## Applied Fixes Log

- 20260315T003418: agent-developer — SCOPE-STRICT STAGING rule → RESOLVED (35→16t, $2.23→$0.51)
- 20260315T011256: agent-qa — HARD STOP rules with evidence → RESOLVED (25→16t, $0.90→$0.39)
- 20260315T012827–20260315T030032: 13 consecutive clean runs, no fixes needed.

## Lessons Learned

- `deno fmt` checks ALL .md files in repo. Developer must not stage formatting fixes outside task scope.
- QA `gh pr review --approve` always fails on own PRs — expected behavior.
- HARD STOP rules need explicit evidence from violations to be effective. Abstract rules get ignored.
- Developer pre-flight git-log check prevents duplicate work on already-committed changes.
- No-op tasks (already implemented) cost ~$1.61-1.99 total — stable baseline for pass-through runs.
