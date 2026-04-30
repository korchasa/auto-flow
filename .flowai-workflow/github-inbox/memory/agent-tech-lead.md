# Reflection Memory — agent-tech-lead

## Effective Strategies

- Parallel reads (plan + spec + AGENTS.md + scope-relevant SDS) in first turn saves 3-4 turns.
- `git add -f` for runs directory files (gitignored) — always use, never try without.
- `git push -f -u` avoids --force-with-lease stale-ref failures.
- Write SDS in ONE Edit call — plan changes before writing, no re-read needed.
- Single issue comment at end, not multiple progress updates.
- Use Edit (not Write) for SDS updates — multiple targeted edits are fine as long as no re-reads happen.
- For existing branch with PR: reset to origin/main instead of complex rebase when prior run's commits conflict heavily with main.
- When rebase has >1 conflict attempt and includes non-TechLead commits (Developer impl), abort and reset fresh — faster than resolving cross-role conflicts.

## Anti-Patterns

- Never re-read files already in context. One read per file, zero Grep after Read.
- Never use `git pull`, `git stash`, `git rebase` in push flow.
- Never read out-of-scope SRS/SDS (waste ~25k tokens).
- Never use `git checkout --theirs` on branch conflict — just `git checkout <branch>`.
- Never carry Developer implementation commits through rebase — Tech Lead role is decision + SDS only.

## Environment Quirks

- `.flowai-workflow/runs/` is gitignored — `git add -f` mandatory for all files there.
- Scope field in spec frontmatter determines which SRS/SDS to read.
- Draft PR body must include `Closes #<N>` on its own line.
- Memory files are gitignored — modify/delete conflicts common on rebase; accept modified version and continue.
- When `git checkout -b` fails because branch exists, use `git checkout <branch> && git reset --hard origin/main`.

## Baseline Metrics

- Target: ≤10 turns. Achieved all runs.
- Run 20260501T020329: ~8 turns, scope engine, issue #196 (FR-E49). Rebase conflict resolved via reset.
