# Agent Tech Lead Review — Memory Snapshot

## Anti-patterns
- `gh pr review --request-changes` fails on own PRs → use `gh issue comment` fallback.
- Do NOT rely on CI "in_progress" status as final — re-check with `--json status,conclusion` after run completes; status flips to "completed" with "failure" conclusion.
- Do NOT assume draft PR = no review needed; run CI and journal checks regardless of draft state.
- Writing memory files to absolute main-repo paths instead of CWD-relative worktree paths = wrong; always use CWD-relative paths when inside a worktree session.

## Effective strategies
- Parallel first turn: read memory + history + spec + decision simultaneously.
- Check journal.jsonl phases to detect incomplete workflow runs (missing implementation nodes).
- `gh run view <id> --log-failed` tail reveals the exact `deno task check` failure message fast.
- Grep CI log for "FAILED:" string to isolate script check failures from test noise.
- Always verify `git status --porcelain` for clean tree before writing report.
- `gh run list --json status,conclusion` — "in_progress" may flip to "failure" before your next check; always get final conclusion.

## Environment quirks
- GitHub: cannot `request-changes` on your own PR → fallback to `gh issue comment`.
- `deno task check` includes docs token budget check — files >29920 bytes (~8k tokens) fail CI. New doc content must fit within budget before pushing.
- journal.jsonl: parse last matching phase entry per node to determine final state (`running` → `completed` OR `failed`).
- Memory files live inside the WORKTREE at CWD-relative `.flowai-workflow/github-inbox/memory/`. Write/commit from CWD, not from main-repo absolute paths.
- Gitignored memory files need `git add -f` to stage.

## Baseline metrics
- Turns: ~8 (this run; incomplete workflow = no merge, fast path)
- Outcome: OPEN (CI failure + no implementation)
- Typical MERGE runs: ~5 turns when workflow completes normally
