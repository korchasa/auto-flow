---
name: agent-tech-lead-review reflection
description: Operational learnings for the tech-lead-review agent
type: feedback
---

## Key Learnings

- **Draft PR gate:** Always run `gh pr ready <N>` before `gh pr merge` — Tech Lead creates draft PRs by default. Merge fails with "Pull Request is still a draft" otherwise.
- **Self-approval blocked:** `gh pr review --approve` fails when the bot is the PR author ("Cannot approve your own pull request"). Skip approval step and go straight to merge.
- **No CI = no gate:** This repo has no `.github` directory — no GitHub Actions. Absence of CI runs is expected, not a failure. QA's `deno task check` (run locally by QA agent) serves as the quality gate.
- **Output dir must exist:** Create `report/tech-lead-review/` directory with `mkdir -p` before writing the review file (`08-review.md` for old pipeline runs; `06-review.md` after PR #161 merged).
- **QA report location:** Run artifacts live at `.auto-flow/runs/<run-id>/verify/05-qa-report.md`.
- **git add -f required:** `.auto-flow/runs/` is gitignored; use `git add -f` for run artifacts.
- **gh pr merge --squash --delete-branch local checkout:** The squash merge succeeds remotely first (GitHub API), then tries to checkout main locally. If dirty files block local checkout, the merge already happened — verify with `gh pr view`. Do NOT retry merge.
- **Dirty run artifacts (stream.log, impl-summary):** Force-tracked run artifacts in `.auto-flow/runs/` will often be dirty during a live pipeline run. Commit them with `git add -f` to unblock the merge checkout.
- **Post-QA deno.json drift:** If `deno.json` is locally modified without commit, flag as non-blocking if QA already passed with that state. Requires separate cleanup outside this agent's scope.
- **Duplicate Appendix C row pattern:** When developer adds new FR rows to SRS Appendix C, they may inadvertently duplicate the preceding row (e.g., FR-S32 duplicated after adding FR-S33). Cosmetic, non-blocking — flag as non-blocking finding only.
- **Parallel first turn:** Read spec + decision + QA report + `gh pr list` + `git status` + `gh run list` all in ONE turn. Then read diff in turn 2. Maximum efficiency.
