# Reflection Memory — agent-tech-lead

## Effective Strategies

- Parallel reads (plan + spec + AGENTS.md + scope-relevant SDS) in first turn saves 3-4 turns.
- `git add -f` for runs directory files (gitignored) — always use, never try without.
- `git push -f -u` avoids --force-with-lease stale-ref failures.
- Write SDS in ONE Edit call — plan changes before writing, no re-read needed.
- Single issue comment at end, not multiple progress updates.
- Use Edit (not Write) for SDS updates — multiple targeted edits are fine as long as no re-reads happen. More precise than full file Write for large SDS files.
- For rename/renumber issues: prefer minimal blast radius variant that directly satisfies the FR — no scope creep.

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
- Run 20260315T213641: ~7 turns, scope engine, issue #128 (FR-E32).
- Run 20260315T215901: ~7 turns, scope sdlc, issue #129 (FR-S31).
- Run 20260319T180115: ~7 turns, scope engine, issue #146 (FR-E33).
- Run 20260319T182156: ~7 turns, scope sdlc, issue #147 (FR-S32).
- Run 20260319T192055: ~7 turns, scope sdlc, issue #148 (FR-S33).
- Run 20260319T194808: ~7 turns, scope sdlc, issue #149 (FR-S34).
- Run 20260319T201620: ~7 turns, scope engine, issue #150 (FR-E33).
- Run 20260319T204544: ~7 turns, scope sdlc, issue #151 (FR-S35).
- Run 20260319T211036: ~7 turns, scope engine, issue #152 (FR-E34).
- Run 20260319T213344: ~7 turns, scope engine, issue #153 (FR-E35).
- Run 20260319T215851: ~7 turns, scope sdlc, issue #154 (FR-S36).
- Target: ≤10 turns. Achieved all runs.
