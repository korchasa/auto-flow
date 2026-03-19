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
- **gh pr diff -- <file> not supported:** `gh pr diff` accepts at most 1 arg (the PR number). Cannot filter by file path. Read implementation files directly via the Read tool when diff is too large.
- **SDS error message format:** SDS may describe error format intent rather than exact string — non-blocking if test assertions pass against actual implementation string.
- **pipeline.yaml fix as necessary side-effect:** When engine adds a new validation rule that rejects a config pattern, pipeline.yaml must be fixed simultaneously. This is in-scope, not out-of-scope.
- **Engine file touch in SDLC-scoped issue:** If decision explicitly lists `engine/hitl.ts` as a task file, touching it for generic template interpolation (no domain-specific logic) is in-scope — not a violation of engine domain-agnosticism.
- **Integration-style tests via executePostPipeline:** FR-E34 tests use mocked `executeNode` + real `OutputManager` capture + explicit `pipelineSuccess` derivation loop pattern. This is the standard pattern for testing post-pipeline behavior — valid even when it doesn't call `engine.ts` directly.
- **bodyNodeIds array vs Set micro-pattern:** In FR-E35, `bodyNodeIds` is a string array checked with `.includes()` while `loopInputs` uses a `Set`. For typical pipeline sizes this has no correctness impact — flag as non-blocking only.
- **Shell wrapper no-pipefail:** When reviewing wrapper scripts that capture exit codes (`code=$?`), absence of `set -euo pipefail` is CORRECT — strict mode would exit before the capture. Flag as non-blocking observation, not a defect.
- **SDLC-scope wrapper scripts in diff:** Agent memory files + run artifacts appearing in diff are expected pipeline artifacts — not out-of-scope modifications. Only source files / docs outside scope are flagged.
- **Exported function for testing:** When a previously private function is exported to enable unit tests (e.g., `extractConditionValue` in loop.ts), this is in-scope and correct — not an unwanted API surface increase. The export is required by test files that import it directly.
- **Return type narrowing:** Changing `Promise<string | undefined>` to `Promise<string>` (with a throw replacing `return undefined`) is a breaking change to internal API but correct when the caller is updated to handle the throw via try/catch. Verify the call site converts throw to a safe return value.
- **Necessary test inversion:** When a migration removes a feature (e.g., `prompt:` field), the corresponding structural test must be inverted. If decision lists only `pipeline.yaml` but test file also changes — this is a non-blocking necessary side-effect, not an out-of-scope modification.
