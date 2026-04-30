---
name: agent-tech-lead-review reflection
description: Operational learnings for the tech-lead-review agent
type: feedback
---

## Key Learnings

- **Draft PR gate:** Always run `gh pr ready <N>` before `gh pr merge` — Tech Lead creates draft PRs by default. Merge fails with "Pull Request is still a draft" otherwise.
- **Self-approval/self-request-changes blocked:** `gh pr review --approve` and `gh pr review --request-changes` both fail when the bot is the PR author. Use `gh issue comment` as fallback for review findings.
- **CI now present:** `.github/workflows/` exists in this repo — `gh run list` returns real CI results. Always check CI before merge decision. 5 green runs = green gate.
- **Output dir must exist:** Create `report/tech-lead-review/` directory with `mkdir -p` before writing the review file (`06-review.md` after PR #161 merged).
- **QA report location:** Run artifacts live at `.flowai-workflow/runs/<run-id>/verify/05-qa-report.md`.
- **git add -f required:** `.flowai-workflow/runs/` is gitignored; use `git add -f` for run artifacts.
- **gh pr merge --squash --delete-branch local checkout:** The squash merge succeeds remotely first (GitHub API), then tries to checkout main locally. If dirty files block local checkout, the merge already happened — verify with `gh pr view`. Do NOT retry merge.
- **Dirty run artifacts (stream.log, impl-summary):** Force-tracked run artifacts in `.flowai-workflow/runs/` will often be dirty during a live workflow run. Commit them with `git add -f` to unblock the merge checkout.
- **Post-QA deno.json drift:** If `deno.json` is locally modified without commit, flag as non-blocking if QA already passed with that state. Requires separate cleanup outside this agent's scope.
- **Duplicate Appendix C row pattern:** When developer adds new FR rows to SRS Appendix C, they may inadvertently duplicate the preceding row. Cosmetic, non-blocking.
- **Parallel first turn:** Read spec + decision + QA report + `gh pr list` + `git status` + `gh run list` all in ONE turn. Then read diff in turn 2. Maximum efficiency.
- **gh pr diff -- <file> not supported:** `gh pr diff` accepts at most 1 arg (the PR number). Read implementation files directly via the Read tool when diff is too large.
- **SDS error message format:** SDS may describe error format intent rather than exact string — non-blocking if test assertions pass against actual implementation string.
- **workflow.yaml fix as necessary side-effect:** When engine adds a new validation rule that rejects a config pattern, workflow.yaml must be fixed simultaneously. This is in-scope, not out-of-scope.
- **Engine file touch in SDLC-scoped issue:** If decision explicitly lists `engine/hitl.ts` as a task file, touching it for generic template interpolation is in-scope.
- **Integration-style tests via executePostWorkflow:** FR-E34 tests use mocked `executeNode` + real `OutputManager` capture + loop pattern. Valid even when it doesn't call `engine.ts` directly.
- **bodyNodeIds array vs Set micro-pattern:** For typical workflow sizes no correctness impact — flag as non-blocking only.
- **Shell wrapper no-pipefail:** Absence of `set -euo pipefail` is CORRECT when script must capture exit code.
- **SDLC-scope wrapper scripts in diff:** Agent memory files + run artifacts in diff are expected workflow artifacts.
- **Exported function for testing:** Exporting a previously private function to enable unit tests is in-scope.
- **Return type narrowing:** `Promise<string | undefined>` → `Promise<string>` correct when caller updated to handle throw via try/catch.
- **Necessary test inversion:** Migration that removes a feature requires inverting the corresponding structural test.
- **Large diff (run artifacts):** Memory files + run artifacts dominate large diffs. SKILL.md/source hunks at top — verify first.
- **QA report dirty on entry:** Always check `git status` and commit with `git add -f` before merge.
- **Config-only PR (workflow.yaml):** Test count stays unchanged. Workflow integrity check is acceptance gate. SRS+SDS always in scope for SDLC issues.
- **scope-check integration test pattern:** `snapshotModifiedFiles` test verifies return type only — git state varies per environment. Correct split.
- **validateTemplateVars pure twin pattern (FR-E7):** Co-location intentional. Loop body nodes inherit combined IDs via existing recursive call.
- **SDS proactive update (spec-excluded):** Developer may update design-engine.md proactively — non-blocking if accurate.
- **Inline frontmatter field presence (FR-E38):** `checkArtifact()` extended with optional `fields?`. Fail-fast order preserved.
- **PM-persistence-failure (SRS) = always blocking:** When spec lists SRS changes (new section + index row) and QA confirms 0 grep matches, this is always a blocking finding — do NOT merge. Issue comment fallback for review when self-request-changes blocked. 28th+ consecutive PM persistence failure pattern across issues #147–#196.
- **CI present since FR-E39:** `.github/workflows/release.yml` added in PR #185. `gh run list` returns real results. 5 green = green gate.
