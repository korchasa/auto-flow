# Reflection Memory — agent-tech-lead

## Effective Strategies

- Parallel reads (plan + spec + AGENTS.md + scope-relevant SDS) in first turn saves 3-4 turns.
- `git add -f` for runs directory files (gitignored) — always use, never try without.
- `git push -f -u` avoids --force-with-lease stale-ref failures.
- Write SDS in ONE Edit call — plan changes before writing, no re-read needed.
- Single issue comment at end, not multiple progress updates.
- Use Edit (not Write) for SDS updates — multiple targeted edits are fine as long as no re-reads happen. More precise than full file Write for large SDS files.
- For rename/renumber issues: prefer minimal blast radius variant that directly satisfies the FR — no scope creep.
- For doc-sync issues: verify SDS accuracy first, then add evidence entry — avoids unnecessary rewrites.
- When worktree conflicts lock existing branches, create `-v3` (or higher) suffix and push to same remote PR target via `-f`.

## Anti-Patterns

- Never re-read files already in context. One read per file, zero Grep after Read.
- Never use `git pull`, `git stash`, `git rebase` in push flow.
- Never read out-of-scope SRS/SDS (waste ~25k tokens).
- Never use `git checkout --theirs` on branch conflict — just `git checkout <branch>`.
- Watch for single-line text in SDS files — Edit match strings must match exactly including line breaks.

## Environment Quirks

- `.flowai-workflow/runs/` is gitignored — `git add -f` mandatory for all files there.
- Scope field in spec frontmatter determines which SRS/SDS to read.
- Draft PR body must include `Closes #<N>` on its own line.
- Worktree locking: when branch is used by another worktree, create new branch with `-vN` suffix.

## Baseline Metrics

- Run 20260320T094502: ~7 turns, scope engine, issue #175 (FR-E37).
- Run 20260320T101834: ~7 turns, scope engine, issue #176 (FR-E7).
- Run 20260320T104440: ~7 turns, scope sdlc, issue #178 (FR-S43+FR-S44+FR-S45).
- Run 20260320T213059: ~7 turns, scope engine, issue #182 (FR-E38).
- Run 20260320T220824: ~7 turns, scope engine, issue #183 (FR-E39).
- Run 20260320T223114: ~7 turns, scope engine, issue #183 (FR-E39) re-run.
- Run 20260425T222337: ~8 turns, scope engine, issue #196 (FR-E49).
- Target: ≤10 turns. Achieved all runs.
