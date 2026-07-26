# Module: isolation

Per-run git worktree lifecycle plus the two scope guards that keep an agent
inside it.

- `worktree.ts` — create/remove worktrees under
  `<workflowDir>/runs/<run-id>/worktree`, mirror gitignored files, pin a
  detached HEAD to a rescue branch before teardown (FR-E51).
- `guardrail.ts` (FR-E50) — detects files an agent wrote in the MAIN tree
  outside its worktree and rolls them back.
- `scope-check.ts` (FR-E37) — the inside-worktree counterpart, enforcing
  `node.allowed_paths`.
- `memory-check.ts`, `glob.ts`.

## Key decisions

- **The guardrail is single-node by construction.** It brackets one node with
  a before/after `git status` of the shared main tree, so it cannot attribute
  changes when two nodes run at once. This is why `max_parallel` defaults
  to 1.
- **It only sees NEWLY dirty paths.** A file already modified before the node
  ran stays invisible — set arithmetic on `git status` output cannot
  distinguish "modified again".
- **Snapshots fail closed:** a failing `git status` throws and the node
  fails; a silent empty snapshot would disable leak detection entirely.
- **The pre-checkout fetch follows the requested ref.** `parseRemoteRef`
  splits `<remote>/<branch>`; non-remote refs (SHA, tag, local branch) fetch
  nothing and resolve from the local object store.
- **`copyIgnoredIntoWorktree` skips `<workflowDir>/runs/`** — without it,
  sibling worktrees get copied into the new one and nest exponentially until
  `ENAMETOOLONG`.
