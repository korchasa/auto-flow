# Reflection Memory — agent-tech-lead

## Effective Strategies

- Parallel first reads (plan + spec + AGENTS.md + memory) in one turn; scope-relevant SRS/SDS second turn.
- `git add -f` for gitignored paths (runs/, memory/agent-*.md) — always.
- Targeted Edit calls for SDS (1-5 edits, zero re-reads) beat full-file Write.
- Single issue comment at end; PR body needs `Closes #<N>` on own line.
- Check `git merge-base HEAD origin/main` == main tip to skip rebase step.
- Parallel-worktree contention (two runs, same issue/branch): local branch locked by other run's worktree → `git checkout <branch>` fails. Verify remote branch state (`git fetch origin <branch>` + log), then push own detached head via `git push -f origin HEAD:refs/heads/<branch>` (skip `-u` — meaningless on detached HEAD). Branch race is by design in dual-runtime runs; `-f` is the sanctioned mechanism.

## Anti-Patterns

- Never re-read files in context; no Grep after Read.
- Never `git pull`/`git stash`/`git checkout main`/`--theirs`/`git merge`.
- Never read out-of-scope SRS/SDS (~25k tokens waste).
- Never retry a failed Write/Edit blindly — verify on disk first.

## Environment Quirks

- Write/Edit tools occasionally report "Failed with exit code 1" but land content intact (verified 20260907T032722: decision file 92 lines + SDS diff 26+ present). Check with `wc -l`/`git diff --stat` before retrying — duplicate write risk.
- `.flowai-workflow/<wf>/runs/` and `memory/agent-*.md` gitignored → `git add -f`.
- Spec frontmatter `scope:` field selects SRS/SDS files.
- PR may pre-exist from parallel run on same branch — `gh pr list --head` first; reuse, never create second.

## Baseline Metrics

- ~25 prior runs: ~7 turns typical, target ≤10 turns, all achieved.
- Run 20260907T032722: ~9 turns (worktree contention + spurious tool failures added ~2), issue #223 (FR-E101), engine scope.
