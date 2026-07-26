# Module: state

Run state, the durable lifecycle journal, run locking, and every
`runs/<run-id>/...` path helper.

- `state.ts` — in-memory `RunState` transitions, `PhaseRegistry`, path
  builders (`getRunDir`, `getNodeDir`, `getHitlInboxPath`), path-safety
  guards.
- `run-journal.ts` — append-only `journal.jsonl` writer + replayer. The
  journal, not a snapshot file, is the recovery contract.
- `lock.ts` — per-workflow-folder run lock at `<workflowDir>/runs/.lock`.
- `log.ts` — per-node agent log persistence.

## Key decisions

- **Env VALUES are never persisted.** `run_started` records `env_keys` only:
  the map is fed from `.env`/`--env` and routinely holds API tokens, which
  used to land in `journal.jsonl` and reach the model through the MCP
  `get_state` tool. Resume re-derives values from the live environment, so a
  key that disappeared fails fast at `{{env.X}}` instead of resolving to
  stale text. `event.env` is read-only back-compat for old journals.
- **Path helpers are dumb concatenators.** Any boundary accepting a run/node
  id from outside (MCP tools, CLI) MUST call `assertSafeSegment` /
  `assertSafeRelativePath` first — otherwise `..` walks out of `runs/`.
- **The lock is published via a temp file + `Deno.link`.** `Deno.open
  {createNew}` makes an EMPTY file visible before its content is written; a
  racer reading that empty file classifies it as corrupt debris, deletes it,
  and both processes end up holding the lock.
- **Only `ESRCH` proves a PID is dead.** `EPERM` means the process exists
  under another user and counts as alive — reclaiming on a guess is the
  destructive option.
- **`readLockInfo` validates shape**, so "corrupt lock" is one handled
  category instead of a TypeError from the first property access.
- **`PhaseRegistry` is per-run**, never module-level (FR-E59).
