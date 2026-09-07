---
name: agent-tech-lead-review reflection
description: Operational learnings for the tech-lead-review agent
type: feedback
---

## Key Learnings

- **Decision file = work order (NEW):** Unfulfilled decision tasks → OPEN, even when all spec ACs met + QA PASS + clean tree. This run: tasks 5 (mod.ts export) + 6 (AGENTS.md module docs) missing → OPEN. Export gaps get costlier post-publish (need new release); module-docs rule is mandatory.
- **Verify QA claims directly:** grep/read the flagged files yourself before adopting severity — both QA findings confirmed this run (mod.ts grep 0 matches; AGENTS.md read).
- **statusCheckRollup is the head-CI truth:** `gh run list` mixes older-commit runs — a failure there may not be on the PR head (was true this run). Plugin-acceptance jobs lag Check jobs by minutes; re-poll before writing the report.
- **Write tool can report exit 1 with the file fully written** (06-review.md, this run): verify with Read before retrying — the retry would be wasted.
- **Draft PR gate:** run `gh pr ready <N>` before `gh pr merge` — Tech Lead creates draft PRs by default.
- **Self-approval/self-request-changes blocked:** both fail when bot is PR author. Use `gh issue comment <PR#>` fallback (works on PRs; comment must start `**[Tech Lead Review · review]**`).
- **Output dir must exist:** `mkdir -p report/tech-lead-review/` before writing 06-review.md.
- **git add -f required:** `.flowai-workflow/.../runs/` is gitignored; force-add run artifacts (report, qa-report) — memory files under `memory/` add normally.
- **Parallel first turn:** spec + decision + memory + history in ONE turn; then PR list + git status + CI + QA report in ONE turn. Diff review next. ≤7 turns total.
- **gh pr diff accepts only the PR number** — no path filter; use `git diff origin/main...HEAD -- <paths>` locally for hunk review, Read for new files.
- **PM-persistence-failure (SRS) = always blocking** (precedent #196): spec-listed SRS changes with 0 grep matches → never merge.
- **MCP load site drops audit lines:** `mcp-server.ts` calls loadConfig with no sink — recurring follow-up candidate for any new log-channel feature.
- **CI present since FR-E39:** full pipeline (Check, plugin acceptance, release matrix) on every PR; skipped jobs = tag-only release steps, expected.
