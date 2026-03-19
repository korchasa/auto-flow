---
name: agent-tech-lead-review reflection
description: Operational learnings for the tech-lead-review agent
type: feedback
---

## Key Learnings

- **Draft PR gate:** Always run `gh pr ready <N>` before `gh pr merge` — Tech Lead creates draft PRs by default. Merge fails with "Pull Request is still a draft" otherwise.
- **Self-approval blocked:** `gh pr review --approve` fails when the bot is the PR author ("Cannot approve your own pull request"). Skip approval step and go straight to merge.
- **No CI = no gate:** This repo has no `.github` directory — no GitHub Actions. Absence of CI runs is expected, not a failure. QA's `deno task check` (run locally by QA agent) serves as the quality gate.
- **Output dir must exist:** Create `report/tech-lead-review/` directory with `mkdir -p` before writing `08-review.md`.
- **QA report location:** Run artifacts live at `.auto-flow/runs/<run-id>/verify/05-qa-report.md`, not `report/qa/`.
