---
date: "2026-05-05"
status: to do
implements: [FR-E24, FR-E50, FR-E51, FR-E54, FR-E57, FR-E58, FR-E62, FR-E63, FR-E64]
tags: [decision, engine, isolation, hooks, breaking, proposed]
related_tasks:
  - 2026/05/isolation-provider.md
  - 2026/05/isolation-provider-plugin.md
supersedes: 2026/05/isolation-provider.md
---
# Remove git from engine — isolation is workflow concern

> **Status:** Proposed. Supersedes
> `2026/05/isolation-provider.md` — full removal preferred over
> a permanent indirection layer.

## Goal

Eliminate every `Deno.Command("git", …)` invocation and every import of
`worktree.ts` / `guardrail.ts` / `scope-check.ts` from engine code, by
moving isolation/leak-detection into workflow-owned shell hooks
(`before_run` / `after_run` / `before_node` / `after_node`) wired through
a small generic engine surface.

## Overview

### Context

`AGENTS.md#Key-Decisions` and `requirements-engine/00-meta.md` (NFR
"Domain-agnostic") forbid git/GitHub/branch/PR logic in `engine/*.ts`.
The current code violates that mandate from three call-sites:

- [`worktree.ts`](../../../worktree.ts) shells out to `git worktree`,
  `git fetch`, `git branch`, `git ls-files`, `git symbolic-ref`,
  `git rev-parse` (~12 spawn sites).
- [`guardrail.ts`](../../../guardrail.ts) runs
  `git -c status.showUntrackedFiles=normal status --porcelain` and
  `git checkout HEAD -- <path>` for FR-E50 leak detection and rollback.
- [`scope-check.ts`](../../../scope-check.ts) snapshots changes via
  `git diff --name-only HEAD` and `git ls-files --others`.

Both [`engine.ts`](../../../engine.ts) and
[`node-dispatch.ts`](../../../node-dispatch.ts) import these modules
directly. FR-E24, FR-E50, FR-E51, FR-E52, FR-E54, FR-E57, FR-E58
encode "git worktree" as if it were the only isolation primitive.
The half-built escape hatch `defaults.worktree_disabled: true`
([`config.ts:51`](../../../config.ts#L51),
[`engine.ts:108`](../../../engine.ts#L108)) skips worktree creation but
leaves git-importing modules in the build, leaks git-aware error
messages, and never exercised in a no-`git`-binary environment.

`2026/05/isolation-provider.md` (Proposed, never implemented)
proposed plugging git behind an `IsolationProvider` interface with
`git-worktree` and `none` as in-tree implementations. That preserves
git in the engine's transitive surface and adds a permanent
indirection layer to keep one provider out of another's way.

Triggering force: a new requirement that "git usage must be optional
or absent in engine" — the user explicitly rejects the dual-mode
status quo and the plugin layer in favour of removal.

### Constraints

- Hook env-var names (`RUN_ID`, `RUN_DIR`, `WORKFLOW_DIR`, `WORKDIR`,
  `NODE_ID`, `NODE_DIR`, `ALLOWED_PATHS`, `RETRY_COUNT`, `RUN_STATUS`,
  `RESUMING`, `AGENT_EXIT_CODE`, `AGENT_STDOUT_PATH`,
  `AGENT_STDERR_PATH`) are part of the engine's public API.
- `before_node` / `after_node` (and per-node `before` / `after`)
  fire ONLY for `agent`-type nodes.
- Workflow-owned `git-isolation.sh` reference scripts live ONLY
  under `.flowai-workflow/<wf>/scripts/`; the engine MUST NOT
  reference them by name.

## Definition of Done

- [ ] FR-E24 marked `Status: Superseded by remove-git-from-engine` in
      `documents/requirements-engine/04b-worktree-isolation.md`.
- [ ] FR-E50 / FR-E51 / FR-E58 marked
      `Status: Superseded by remove-git-from-engine`; FR-E54 / FR-E57 retain text
      with the worktree references stripped.
- [ ] [`worktree.ts`](../../../worktree.ts), [`guardrail.ts`](../../../guardrail.ts),
      [`scope-check.ts`](../../../scope-check.ts) and their `*_test.ts`
      files deleted from repo. Audit test
      `engine_no_git_imports_test.ts` walks repo root for `*.ts` files
      and asserts no `Deno.Command("git", …)` and no imports of the
      three deleted modules.
- [ ] [`engine.ts`](../../../engine.ts) two-phase YAML pre-parse
      (`extractWorktreeDisabled`) removed; `workDir` resolution
      simplified to "respect `before_run` stdout contract".
- [ ] [`config.ts`](../../../config.ts) `worktree_disabled` field
      removed from `WorkflowDefaults`; YAML containing it under
      `defaults:` raises a `ConfigError` with a migration message.
- [ ] `defaults.before_run` field added (FR-E62; replaces
      `prepare_command`). Engine invokes once per run before any
      node, with env `RUN_ID`, `RUN_DIR`, `WORKFLOW_DIR`,
      `RESUMING`. Stdout contract: last `^WORKDIR=(.+)$` line
      rebinds `workDir`. Non-zero exit fails the run.
- [ ] `defaults.after_run` field added (FR-E63). Engine invokes
      once per run after the last node, regardless of outcome, with
      `RUN_STATUS` env. Failure logs warn; does not alter run state.
- [ ] `defaults.before_node` + `defaults.after_node` (workflow
      defaults) and `nodes.<id>.before` + `nodes.<id>.after` (per-node
      overrides) fields added (FR-E64). Engine invokes them around
      every `agent`-type node with the env contract.
      `before_node` non-zero → skip node + `before_node_violation`;
      `after_node` non-zero → `after_node_violation`. Per-node field
      REPLACES the workflow default (does not merge); explicit `""`
      disables.
- [ ] Hook env-var contract audit test
      `engine_hook_env_contract_test.ts` enumerates the env vars set
      on each of the four hooks and asserts the set EXACTLY matches
      this task's "Hook Contract" subsection.
- [ ] `defaults.prepare_command` and `defaults.on_failure_script`
      deprecated. When either is set, engine emits a one-time
      warning at run start naming the replacement and "will be
      removed in the next major release".
- [ ] Each dogfood workflow gains `scripts/git-isolation.sh`
      dispatcher + four `defaults.*` wirings.
- [ ] FR-E58 mirror semantics (gitignored files into worktree)
      reproduced inside `scripts/git-isolation.sh`.
- [ ] CHANGELOG.md gains a `### BREAKING` section under the next
      release explaining the migration.
- [ ] AGENTS.md "Key Decisions" list edits — drop the worktree-
      related bullet for isolation-provider/0003/0004; add remove-git-from-engine.

## Solution

### Decision

Remove git from the engine. Engine source contains zero
`Deno.Command("git", …)` invocations and zero imports of `worktree.ts` /
`guardrail.ts` / `scope-check.ts`. These three modules are deleted from
the JSR-published package; their semantics move to workflow-owned shell
scripts wired via a small, generic hook surface that the engine
exposes.

`defaults.worktree_disabled` is removed (no longer meaningful — there
is no worktree mode to disable). The dogfood workflows under
`.flowai-workflow/github-inbox*/` and `.flowai-workflow/autonomous-sdlc/`
ship a new `scripts/git-isolation.sh` reference dispatcher script that
workflow authors copy/adapt.

Supersedes `2026/05/isolation-provider.md`: the plugin-provider
abstraction is no longer the chosen path; removal is preferred over a
permanent indirection.

### Hook Contract for Workflow-Owned Capabilities

The engine exposes four hook fields. Two fire per-run, two fire
per-agent-node. Hooks are plain shell commands; the engine spawns
them with `Deno.Command(..., { cwd: workDir, env: hookEnv })`. The
hook surface replaces every git-aware behaviour removed from the
engine.

Field placement:

- `defaults.before_run`, `defaults.after_run` — workflow-level only
  (no per-node form; they fire ONCE per run).
- `defaults.before_node`, `defaults.after_node` — workflow-wide
  default; applied to every `agent`-type node.
- `nodes.<id>.before`, `nodes.<id>.after` — per-node override.
  REPLACES the workflow default (does not merge). Empty string
  `""` disables the hook for that node.

#### `defaults.before_run` (replaces `prepare_command`)

- **Fires:** once per run, BEFORE any node executes, AFTER the run
  lock is acquired and the per-run state directory exists.
- **Skipped on:** `--dry-run`. On `--resume` it still fires (must be
  idempotent — see `RESUMING` env below).
- **Env:** `RUN_ID`, `RUN_DIR=<workflowDir>/runs/<run-id>`,
  `WORKFLOW_DIR=<workflowDir>` (workflow folder, repo-relative),
  `RESUMING=1` when invoked under `--resume` (else unset).
- **Stdout contract (FR-E62, NEW):** the script MAY emit exactly
  one line `WORKDIR=<absolute-path>` on stdout. After the script
  exits 0, the engine scans stdout for the LAST line matching
  `^WORKDIR=(.+)$`, validates the path exists and is a directory,
  and rebinds `workDir` for the rest of the run. No match → cwd
  unchanged. Multiple matches → last wins. All other stdout lines
  are treated as informational and forwarded to engine verbose
  log (`-v`); they are NOT parsed.
- **Failure:** non-zero exit → run fails before any node executes;
  engine surfaces script's stderr verbatim. No retry.
- **Use cases:** create git worktree (`git worktree add`), mirror
  gitignored files, fetch dependencies, set up Docker container,
  acquire external lease.

#### `defaults.after_run` (NEW field)

- **Fires:** once per run, AFTER the last node finishes, regardless
  of run outcome (success, failure, interrupt). ALWAYS fires if
  `before_run` succeeded — guarantees teardown for setup work.
- **Skipped on:** `--dry-run`. Fires on `--resume` runs that reach
  a terminal state.
- **Env:** all of `before_run`'s vars PLUS
  `WORKDIR=<absolute-path-of-current-workDir>`,
  `RUN_STATUS=completed|failed|interrupted`.
- **Stdout contract:** none. Engine logs stdout/stderr at verbose
  level; no parsing.
- **Failure:** non-zero exit → engine logs a warning
  (`after_run failed: <stderr>`) but does NOT alter
  `RUN_STATUS`.
- **Use cases:** remove git worktree (`git worktree remove --force`),
  pin detached HEAD to a rescue branch BEFORE removal (FR-E51
  semantics), tear down Docker container, archive run artefacts,
  release external lease.

#### `defaults.before_node` / `nodes.<id>.before` (NEW fields)

- **Fires:** for every `agent`-type node, immediately BEFORE the
  agent process is spawned. Skipped for `merge` / `loop` / `human`
  nodes.
- **Resolution:** `nodes.<id>.before` (if set, including `""` to
  disable) wins; otherwise `defaults.before_node`; otherwise no
  hook fires.
- **Env:** `RUN_ID`, `RUN_DIR`, `WORKFLOW_DIR`, `WORKDIR`,
  `NODE_ID`, `NODE_DIR=<workDir>/<run_dir>/<node-id>`,
  `ALLOWED_PATHS=<comma-separated-glob-list>` (from node config;
  empty string when unset), `RETRY_COUNT=<n>` (continuation index
  per FR-E11).
- **Failure:** non-zero exit → engine SKIPS the node invocation,
  marks the node `failed` with `error_category: "before_node_violation"`
  and stderr as the message.
- **Use cases:** snapshot main-repo state for later diffing, enforce
  pre-conditions, log metrics, allocate scratch space.

#### `defaults.after_node` / `nodes.<id>.after` (NEW fields)

- **Fires:** for every `agent`-type node, AFTER the agent process
  exits, BEFORE the engine evaluates validation/continuation. Fires
  on EVERY agent invocation including continuation rounds.
- **Resolution:** `nodes.<id>.after` (if set, including `""` to
  disable) wins; otherwise `defaults.after_node`; otherwise no
  hook fires.
- **Env:** all of `before_node`'s vars PLUS
  `AGENT_EXIT_CODE=<n>`, `AGENT_STDOUT_PATH=<file>`,
  `AGENT_STDERR_PATH=<file>`.
- **Failure:** non-zero exit → node marked `failed` with
  `error_category: "after_node_violation"` and stderr as message;
  the agent's actual exit code is preserved in `state.json` for
  diagnostics. This is the FR-E50 leak-detection equivalent.
- **Use cases:** detect leaks outside `WORKDIR`/`ALLOWED_PATHS`,
  roll back unauthorised writes, enforce post-conditions, ship
  metrics, validate exit codes.

### FR mapping — what replaces what

- **FR-E24 (Worktree Isolation):** `before_run` creates the
  worktree, returns its path via `WORKDIR=` stdout contract.
  `after_run` removes it.
- **FR-E50 (Worktree Isolation Guardrail):** `before_node`
  snapshots, `after_node` diffs + rolls back. Engine no
  longer touches `git status` or `git checkout`.
- **FR-E51 (Detached-HEAD Rescue Branch):** `after_run`
  runs `git symbolic-ref HEAD` and creates the rescue branch
  BEFORE `git worktree remove`.
- **FR-E54 (Per-Workflow Run Lock):** stays in engine. Generic
  `<workflowDir>/runs/.lock` file, no git semantics.
- **FR-E57 (Per-Run Worktree Co-Location):** stays in engine for
  the state-directory part. The worktree sibling directory is
  created by `before_run`, conventionally at `<RUN_DIR>/worktree/`.
- **FR-E58 (Copy Gitignored into Worktree):** `before_run`
  runs `git ls-files --others --ignored --exclude-standard
  --directory -z` + `cp -a` after `git worktree add`.

### Consequences

**Positive.**

- Engine becomes truly domain-agnostic — `engine.ts`,
  `node-dispatch.ts`, `validate.ts` no longer import
  `worktree.ts`/`guardrail.ts`. The AGENTS.md "Engine is
  domain-agnostic" invariant holds without qualification.
- JSR tarball shrinks: `worktree.ts` (~410 lines), `guardrail.ts`
  (~190 lines), `scope-check.ts` (~70 lines), and their tests are
  excluded.
- Engine runs in environments without a `git` binary.
- Decomposition of `engine.ts` becomes mechanical — no git surface
  to thread through the new modules.
- isolation-provider retired before implementation; one less in-flight design
  to maintain.

**Negative.**

- Breaking change for every existing workflow. All four dogfood
  workflows under `.flowai-workflow/` need new wirings plus a
  workflow-owned `git-isolation.sh`.
- **FR-E50 safety net is lost in its current form — security
  regression risk class P0.** Workflow authors are LLM-prompt
  engineers, not security engineers; expecting every workflow to
  ship correct snapshot/rollback shell is unrealistic. Mitigation:
  ship a CANONICAL `scripts/git-isolation.sh` reference with
  snapshot+rollback baked in.
- FR-E51 detached-HEAD rescue branch logic moves to the workflow's
  cleanup script. Easy to forget; a missing rescue means commits
  garbage-collected after run end.
- `before_run` stdout-contract is new and untested.
- **Per-node hook latency.** ~1.4–5.6 s of overhead per run.
- **Hook contract is the new public surface.** Renaming an env var
  is a breaking change for every external workflow author.

### Alternatives Considered

- **Keep `worktree_disabled` flag, document it as the no-git mode.**
  Rejected — git modules still imported into engine, AGENTS.md
  invariant violated, JSR tarball still carries git code.
- **Implement isolation-provider (`IsolationProvider` plugin) with `none`
  provider.** Rejected — adds permanent indirection layer; user
  explicitly chose removal over plugin abstraction.
- **Extract git into a sibling JSR package
  (`@korchasa/flowai-isolation-git`).** Rejected — requires runtime
  plugin loader (security surface explicitly rejected by isolation-provider
  rationale); two-repo synchronisation cost is not justified.
