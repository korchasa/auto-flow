# Reflection Memory — agent-tech-lead

## Effective Strategies

- Parallel reads (plan + spec + AGENTS.md + scope-relevant SDS) in first turn saves 3-4 turns.
- `git add -f` for runs directory files (gitignored) — always use, never try without.
- `git push -f -u` avoids --force-with-lease stale-ref failures.
- Write SDS in ONE Edit call — plan changes before writing, no re-read needed.
- Single issue comment at end, not multiple progress updates.

## Anti-Patterns

- Never re-read files already in context. One read per file, zero Grep after Read.
- Never use `git pull`, `git stash`, `git rebase` in push flow.
- Never read out-of-scope SRS/SDS (waste ~25k tokens).
- Never use `git checkout --theirs` on branch conflict — just `git checkout <branch>`.

## Environment Quirks

- `.auto-flow/runs/` is gitignored — `git add -f` mandatory for all files there.
- Scope field in spec frontmatter determines which SRS/SDS to read.
- Draft PR body must include `Closes #<N>` on its own line.

## Baseline Metrics

- Run 20260315T003418: ~8 turns, scope sdlc, issue #121 (FR-S29).
- Target: ≤10 turns. Achieved.
