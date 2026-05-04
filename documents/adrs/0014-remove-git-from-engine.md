# ADR-0014: Remove git from engine — isolation is workflow concern

## Status

Proposed

## Context

`AGENTS.md#Key-Decisions` and `requirements-engine/00-meta.md` (NFR
"Domain-agnostic") forbid git/GitHub/branch/PR logic in `engine/*.ts`.
The current code violates that mandate from three call-sites:

- [`worktree.ts`](../../worktree.ts) shells out to `git worktree`,
  `git fetch`, `git branch`, `git ls-files`, `git symbolic-ref`,
  `git rev-parse` (~12 spawn sites).
- [`guardrail.ts`](../../guardrail.ts) runs
  `git -c status.showUntrackedFiles=normal status --porcelain` and
  `git checkout HEAD -- <path>` for FR-E50 leak detection and rollback.
- [`scope-check.ts`](../../scope-check.ts) snapshots changes via
  `git diff --name-only HEAD` and `git ls-files --others`.

Both [`engine.ts`](../../engine.ts) and
[`node-dispatch.ts`](../../node-dispatch.ts) import these modules
directly. FR-E24, FR-E50, FR-E51, FR-E52, FR-E54, FR-E57, FR-E58
encode "git worktree" as if it were the only isolation primitive.
The half-built escape hatch `defaults.worktree_disabled: true`
([`config.ts:51`](../../config.ts#L51),
[`engine.ts:108`](../../engine.ts#L108)) skips worktree creation but
leaves git-importing modules in the build, leaks git-aware error
messages, and never exercised in a no-`git`-binary environment.

[ADR-0001](0001-isolation-provider.md) (Proposed, never implemented)
proposed plugging git behind an `IsolationProvider` interface with
`git-worktree` and `none` as in-tree implementations. That preserves
git in the engine's transitive surface and adds a permanent
indirection layer to keep one provider out of another's way.

Triggering force: a new requirement that "git usage must be optional
or absent in engine" — the user explicitly rejects the dual-mode
status quo and the plugin layer in favour of removal.

## Decision

Remove git from the engine. Engine source contains zero `Deno.Command("git",
…)` invocations and zero imports of `worktree.ts` / `guardrail.ts` /
`scope-check.ts`. These three modules are deleted from the JSR-published
package; their semantics move to workflow-owned shell scripts wired via
a small, generic hook surface that the engine exposes.

`defaults.worktree_disabled` is removed (no longer meaningful — there
is no worktree mode to disable). The dogfood workflows under
`.flowai-workflow/github-inbox*/` and `.flowai-workflow/autonomous-sdlc/`
ship a new `scripts/git-isolation.sh` reference dispatcher script that
workflow authors copy/adapt.

Supersedes ADR-0001: the plugin-provider abstraction is no longer the
chosen path; removal is preferred over a permanent indirection.

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

The shorter `before` / `after` names live ONLY at the node level
because the context (a single node) is unambiguous; at `defaults:`
the longer `before_run` / `after_run` / `before_node` /
`after_node` names disambiguate between the two firing scopes.

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
  `RUN_STATUS`. The run is already terminal; cleanup is best-effort
  to mirror current `removeWorktree` semantics (FR-E51 already
  treats rescue-branch failure as warn-only).
- **Use cases:** remove git worktree (`git worktree remove --force`),
  pin detached HEAD to a rescue branch BEFORE removal (FR-E51
  semantics), tear down Docker container, archive run artefacts,
  release external lease.

#### `defaults.before_node` / `nodes.<id>.before` (NEW fields)

- **Fires:** for every `agent`-type node, immediately BEFORE the
  agent process is spawned. Skipped for `merge` / `loop` / `human`
  nodes (they don't invoke external processes that could leak —
  matches current FR-E50 scope).
- **Resolution:** `nodes.<id>.before` (if set, including `""` to
  disable) wins; otherwise `defaults.before_node`; otherwise no
  hook fires.
- **Env:** `RUN_ID`, `RUN_DIR`, `WORKFLOW_DIR`, `WORKDIR`,
  `NODE_ID`, `NODE_DIR=<workDir>/<run_dir>/<node-id>`,
  `ALLOWED_PATHS=<comma-separated-glob-list>` (from node config;
  empty string when unset), `RETRY_COUNT=<n>` (continuation index
  per FR-E11).
- **Stdout contract:** none. Logged at verbose level.
- **Failure:** non-zero exit → engine SKIPS the node invocation,
  marks the node `failed` with `error_category: "before_node_violation"`
  and stderr as the message. No agent retry. Counts toward run
  failure unless the node is `optional: true`.
- **Use cases:** snapshot main-repo state for later diffing
  (`git -c status.showUntrackedFiles=normal status --porcelain >
  $RUN_DIR/$NODE_ID.snapshot`), enforce pre-conditions, log
  metrics, allocate scratch space.

#### `defaults.after_node` / `nodes.<id>.after` (NEW fields)

- **Fires:** for every `agent`-type node, AFTER the agent process
  exits, BEFORE the engine evaluates validation/continuation. Fires
  on EVERY agent invocation including continuation rounds (matches
  current FR-E50 — guardrail wraps each `runAgent` call). Skipped
  for non-agent nodes.
- **Resolution:** `nodes.<id>.after` (if set, including `""` to
  disable) wins; otherwise `defaults.after_node`; otherwise no
  hook fires.
- **Env:** all of `before_node`'s vars PLUS
  `AGENT_EXIT_CODE=<n>`, `AGENT_STDOUT_PATH=<file>` (engine-managed
  stdout capture), `AGENT_STDERR_PATH=<file>`.
- **Stdout contract:** none. Logged at verbose level.
- **Failure:** non-zero exit → node marked `failed` with
  `error_category: "after_node_violation"` and stderr as message;
  the agent's actual exit code is preserved in `state.json` for
  diagnostics. This is the FR-E50 leak-detection equivalent —
  the script compares pre/post snapshots and exits non-zero on a
  leak, having FIRST rolled the leaked paths back via
  `git checkout HEAD -- <path>`.
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
  BEFORE `git worktree remove`. Same algorithm as
  [`worktree.ts:160-185`](../../worktree.ts#L160-L185), in shell.
- **FR-E54 (Per-Workflow Run Lock):** stays in engine. Generic
  `<workflowDir>/runs/.lock` file, no git semantics.
- **FR-E57 (Per-Run Worktree Co-Location):** stays in engine for
  the state-directory part (`<workflowDir>/runs/<run-id>/` holds
  `state.json` + node artefacts). The worktree sibling directory
  is created by `before_run`, conventionally at
  `<RUN_DIR>/worktree/` — but the engine no longer enforces the
  path; whatever `WORKDIR=` returns is used.
- **FR-E58 (Copy Gitignored into Worktree):** `before_run`
  runs `git ls-files --others --ignored --exclude-standard
  --directory -z` + `cp -a` after `git worktree add`. Same skip-
  prefix guard (skip `<workflowDir>/runs/`) implemented in shell.

Composition note: a workflow that needs git-isolation AND another
hook concern (resource quota, container init, …) wraps both in a
single dispatcher script — the hook fields are single-string,
not arrays. The dogfood `scripts/git-isolation.sh` is exactly such
a dispatcher: `git-isolation.sh before-run|after-run|before-node|
after-node` chosen by `$1`, wired from each of the four hook
fields. Workflows extend by editing the dispatcher, not by stacking
engine fields.

## Consequences

**Positive.**

- Engine becomes truly domain-agnostic — `engine.ts`, `node-dispatch.ts`,
  `validate.ts` no longer import `worktree.ts`/`guardrail.ts`. The
  AGENTS.md "Engine is domain-agnostic" invariant holds without
  qualification.
- JSR tarball shrinks: `worktree.ts` (~410 lines), `guardrail.ts`
  (~190 lines), `scope-check.ts` (~70 lines), and their tests are
  excluded.
- Engine runs in environments without a `git` binary (slim Docker
  bases, CI runners with `apk del git`).
- Decomposition of `engine.ts` (`documents/tasks/2026-05-01-engine-decomposition.md`)
  becomes mechanical — no git surface to thread through the new modules.
- ADR-0001 retired before implementation; one less in-flight design
  to maintain.

**Negative.**

- Breaking change for every existing workflow. All four dogfood
  workflows under `.flowai-workflow/` need new `before_run` /
  `after_run` / `before_node` / `after_node` wirings plus a
  workflow-owned `git-isolation.sh`. External users of
  `@korchasa/flowai-workflow` (none known yet) hit the same break.
- **FR-E50 safety net is lost in its current form — security regression
  risk class P0.** The two real incidents that motivated it (issue #196
  + `kazar-fairy-taler` lost commits) recur silently unless the
  workflow author re-implements snapshot/rollback in shell. Workflow
  authors are LLM-prompt engineers, not security engineers; expecting
  every workflow to ship correct snapshot/rollback shell is unrealistic.
  Mitigation: ship a CANONICAL `scripts/git-isolation.sh` reference
  with snapshot+rollback baked in; `flowai-workflow init` uses it by
  default; AGENTS.md documents the regression risk under "Key
  Decisions" so future workflow authors see it before they remove the
  reference script.
- FR-E51 detached-HEAD rescue branch logic moves to the workflow's
  cleanup script. Easy to forget; a missing rescue means commits
  garbage-collected after run end (this was the
  `kazar-fairy-taler` incident pattern).
- `before_run` stdout-contract is new and untested. Need to
  define how a script tells the engine "the new workDir is here"
  — the existing `prepare_command` field was fire-and-forget;
  the renamed `before_run` adds a parsed-stdout protocol.
- `flowai-workflow init` template scaffolds must include the
  `git-isolation.sh` reference script and sample wirings for
  all four hook fields; otherwise `init` produces a workflow
  that runs in the user's main repo working tree (worse than the
  old default).
- **Per-node hook latency.** `before_node` + `after_node`
  fire on EVERY agent invocation (including continuation rounds).
  `git status --porcelain` is ~50–200 ms on a typical repo;
  multiplied across a SDLC workflow's ~7 agents × ~2 continuation
  rounds = ~14× hook pairs per run, so 1.4–5.6 s of overhead.
  Acceptable but not free; reference script SHOULD short-circuit
  when `WORKDIR == "$WORKFLOW_DIR"` (no isolation in use).
- **Hook contract is the new public surface.** Engine semantics
  are now defined by env-var names + exit-code conventions of four
  hooks. Renaming an env var is a breaking change for every
  external workflow author. Lock the contract in
  `documents/requirements-engine/04-runtime-and-hooks.md` (FR-E62/
  E63/E64) and treat it as semver-stable.
- **`on_failure_script` + `prepare_command` rename overlap with
  new hooks.** Existing `defaults.on_failure_script` (fires on
  run failure only) is superseded by `after_run` +
  `RUN_STATUS=failed` check. Existing `defaults.prepare_command`
  is renamed to `defaults.before_run` (fire-and-forget semantics
  preserved when no `WORKDIR=` line emitted). Both old names
  emit one-time deprecation warnings at run start; behaviour
  preserved this release; both removed in next major.
  Documented as a DoD item below.

**Invariants & enforcement.**

- Audit lint in [`scripts/check.ts`](../../scripts/check.ts): grep
  engine-side `*.ts` (root level, excluding `.flowai-workflow/`,
  `scripts/`, `documents/`) for `Deno.Command("git"` or `from
  "./worktree.ts"` / `"./guardrail.ts"` / `"./scope-check.ts"` →
  fail.
- `deno task check` MUST verify that the JSR tarball
  (`deno publish --dry-run`) lists none of the three deleted files.
- Workflow-owned `git-isolation.sh` reference scripts live ONLY
  under `.flowai-workflow/<wf>/scripts/`; the engine MUST NOT
  reference them by name.
- Hook env-var names (`RUN_ID`, `RUN_DIR`, `WORKFLOW_DIR`,
  `WORKDIR`, `NODE_ID`, `NODE_DIR`, `ALLOWED_PATHS`,
  `RETRY_COUNT`, `RUN_STATUS`, `RESUMING`, `AGENT_EXIT_CODE`,
  `AGENT_STDOUT_PATH`, `AGENT_STDERR_PATH`) are part of the
  engine's public API. Changes require a new ADR + major version
  bump. Audit test:
  `engine_hook_env_contract_test.ts` enumerates every env var
  the engine sets on hook invocation and asserts the set matches
  this ADR.
- `before_node` / `after_node` (and per-node `before` / `after`)
  fire ONLY for `agent`-type nodes. Adding hook firing to `merge`
  / `loop` / `human` nodes requires a new ADR (it widens the
  contract and breaks workflow assumptions about hook frequency).

**Definition of Done** (with FR-Test-Evidence tuples):

- [ ] FR-E24 marked `Status: Superseded by ADR-0014` in
  `documents/requirements-engine/04b-worktree-isolation.md`.
  Test: `validate_adrs_test.ts::superseded_FRs_link_to_ADR_0014`
  (new). Evidence: `deno task check`.
- [ ] FR-E50 / FR-E51 / FR-E58 marked
  `Status: Superseded by ADR-0014`; FR-E54 / FR-E57 retain text
  with the worktree references stripped. For each superseded FR,
  the existing `**ADR:** [0001-isolation-provider.md]` back-link
  is rewritten to `**ADR:** [0014-remove-git-from-engine.md]`
  in `documents/requirements-engine/04b-worktree-isolation.md`
  (greppable: 3 occurrences of `0001-isolation-provider`).
  Test: same as above. Evidence: `deno task check`.
- [ ] [`worktree.ts`](../../worktree.ts), [`guardrail.ts`](../../guardrail.ts),
  [`scope-check.ts`](../../scope-check.ts) and their `*_test.ts`
  files deleted from repo. Test: `engine_no_git_imports_test.ts`
  (new) — walks repo root for `*.ts` files, EXCLUDES
  `documents/`, `.flowai-workflow/`, `scripts/`, `*_test.ts`,
  asserts no match for `/Deno\.Command\(\s*["']git["']/` and
  no `import .* from ["']\.\/(?:worktree|guardrail|scope-check)\.ts["']`.
  Evidence: `deno test engine_no_git_imports_test.ts`.
- [ ] [`engine.ts`](../../engine.ts) two-phase YAML pre-parse
  (`extractWorktreeDisabled`) removed; `workDir` resolution
  simplified to "respect `before_run` stdout contract".
  Test: `engine_test.ts::workDir_from_before_run_stdout`
  (new). Evidence: `deno test engine_test.ts`.
- [ ] [`config.ts`](../../config.ts) `worktree_disabled` field
  removed from `WorkflowDefaults`; YAML containing it under
  `defaults:` raises a `ConfigError` with EXACTLY this message:
  `"defaults.worktree_disabled removed (ADR-0014); engine no
  longer manages worktrees. Move git-worktree setup into
  defaults.before_run — see scripts/git-isolation.sh in
  the dogfood workflows for a reference implementation."`
  Modeled on the `pre_run` precedent at
  [`config.ts:131-135`](../../config.ts#L131-L135).
  Test: `config_test.ts::worktree_disabled_rejected_with_migration_message`
  (new). Evidence: `deno test config_test.ts`.
- [ ] `defaults.before_run` field added (FR-E62; replaces
  `prepare_command`). Engine invokes once per run before any
  node, with env `RUN_ID`, `RUN_DIR`, `WORKFLOW_DIR`,
  `RESUMING`. Stdout contract: last `^WORKDIR=(.+)$` line
  rebinds `workDir`. Non-zero exit fails the run. Documented
  in `documents/requirements-engine/04-runtime-and-hooks.md`.
  Test: `engine_test.ts::before_run_workdir_redirect` +
  `engine_test.ts::before_run_resuming_env_set` +
  `engine_test.ts::before_run_failure_aborts_run` (new).
  Evidence: `deno test engine_test.ts`.
- [ ] `defaults.after_run` field added (FR-E63). Engine invokes
  once per run after the last node, regardless of outcome, with
  `RUN_STATUS` env. Failure logs warn; does not alter run state.
  Documented in `documents/requirements-engine/04-runtime-and-hooks.md`.
  Test: `engine_test.ts::after_run_fires_on_success` +
  `engine_test.ts::after_run_fires_on_failure` +
  `engine_test.ts::after_run_failure_does_not_alter_status`
  (new). Evidence: `deno test engine_test.ts`.
- [ ] `defaults.before_node` + `defaults.after_node` (workflow
  defaults) and `nodes.<id>.before` + `nodes.<id>.after` (per-node
  overrides) fields added (FR-E64). Engine invokes them around
  every `agent`-type node with the env contract from ADR-0014.
  `before_node` non-zero → skip node + `before_node_violation`;
  `after_node` non-zero → `after_node_violation`. Per-node field
  REPLACES the workflow default (does not merge); explicit `""`
  disables. Documented in
  `documents/requirements-engine/04-runtime-and-hooks.md`.
  Test: `node_dispatch_test.ts::before_node_skips_on_failure` +
  `node_dispatch_test.ts::after_node_marks_failed_on_violation` +
  `node_dispatch_test.ts::node_hooks_skipped_for_merge_loop_human` +
  `node_dispatch_test.ts::per_node_before_replaces_default` +
  `node_dispatch_test.ts::empty_string_disables_node_hook` (new).
  Evidence: `deno test node_dispatch_test.ts`.
- [ ] Hook env-var contract audit test
  `engine_hook_env_contract_test.ts` enumerates the env vars set
  on each of the four hooks (`before_run`, `after_run`,
  `before_node`, `after_node`) and asserts the set EXACTLY
  matches ADR-0014's "Hook Contract" subsection. Test: same.
  Evidence: `deno test engine_hook_env_contract_test.ts`.
- [ ] `defaults.prepare_command` and `defaults.on_failure_script`
  deprecated. When either is set, engine emits a one-time
  warning at run start naming the replacement
  (`prepare_command` → `before_run`; `on_failure_script` →
  `after_run` + `RUN_STATUS=failed` check) and "will be removed
  in the next major release". `prepare_command` invoked under
  the deprecation alias gets the same env as `before_run` but
  the WORKDIR= stdout contract is NOT honoured (preserves
  fire-and-forget back-compat); workflow authors must rename
  to `before_run` to opt into stdout contract. Both fields
  removed in next major. Test:
  `config_test.ts::prepare_command_deprecation_warning` +
  `config_test.ts::on_failure_script_deprecation_warning` +
  `engine_test.ts::prepare_command_alias_skips_workdir_contract`
  (new). Evidence: `deno test config_test.ts engine_test.ts`.
- [ ] Each dogfood workflow gains `scripts/git-isolation.sh`
  dispatcher + four `defaults.*` wirings:
  - `before_run: bash scripts/git-isolation.sh before-run`
    — runs `git worktree add <RUN_DIR>/worktree origin/main`,
    mirrors gitignored files (FR-E58), emits
    `WORKDIR=<RUN_DIR>/worktree` on stdout. Idempotent under
    `RESUMING=1` (reuse existing worktree path).
  - `after_run: bash scripts/git-isolation.sh after-run`
    — pins detached HEAD to `flowai/run-<RUN_ID>-orphan-rescue`
    (FR-E51 algorithm), runs `git worktree remove --force
    <WORKDIR>` + `git worktree prune`. Best-effort; logs warn
    on failure.
  - `before_node: bash scripts/git-isolation.sh before-node`
    — `git -c status.showUntrackedFiles=normal status
    --porcelain > $RUN_DIR/$NODE_ID.snapshot.before`.
  - `after_node: bash scripts/git-isolation.sh after-node`
    — diffs against `.before`, identifies paths outside
    `$WORKDIR` and outside `$ALLOWED_PATHS`, runs `git checkout
    HEAD -- <leaked-paths>`, exits non-zero with leak report
    on stderr if any leak found.
  Affected: ALL FOUR workflow folders under `.flowai-workflow/`
  (`github-inbox/`, `github-inbox-opencode/`,
  `github-inbox-opencode-test/`, `autonomous-sdlc/`).
  PR merge gate: CI MUST run a smoke `deno task run` on each of
  the four workflows; merge blocked until all four runs reach
  `status: completed` with no `scope_violation` events. The
  smoke matrix MUST also include a synthetic leak-injection
  test: an agent prompted to write to `<repo-root>/leak.txt`
  and assert the post-node hook rolls it back + marks the node
  failed. Test: manual — `<reviewer>: korchasa` reviews CI
  smoke logs. Evidence: CI run URL attached to the PR.
- [ ] FR-E58 mirror semantics (gitignored files into worktree)
  reproduced inside `scripts/git-isolation.sh` via
  `git ls-files --others --ignored --exclude-standard --directory -z`
  + `cp -a`. Test: smoke run in dogfood workflow exercises a
  workflow that depends on a gitignored `.env` file.
  Evidence: same CI run as above; `.env` visible to agent.
- [ ] CHANGELOG.md gains a `### BREAKING` section under the next
  release explaining: removed `worktree_disabled`, removed
  built-in worktree isolation, renamed `prepare_command` →
  `before_run` and `on_failure_script` → `after_run`+`RUN_STATUS`,
  added `before_node` / `after_node` (defaults) +
  `nodes.<id>.before` / `nodes.<id>.after` (overrides), full
  migration recipe (copy `scripts/git-isolation.sh` from a
  dogfood workflow, wire all four hook fields). Test: manual —
  `<reviewer>: korchasa`. Evidence: CHANGELOG.md diff link.
- [ ] [`documents/adrs/README.md`](README.md) ALSO gains an
  ADR-0013 row (pre-existing index drift — currently README
  jumps from 0012 to my new 0014; fix in the same PR to keep
  the index honest). Test: `validateAdrSet` (existing).
  Evidence: `deno task check`.
- [ ] [`documents/adrs/0001-isolation-provider.md`](0001-isolation-provider.md)
  status flipped to `Superseded by ADR-0014`; index in
  `documents/adrs/README.md` updated.
  Test: `validateAdrSet` (existing in `scripts/check.ts`).
  Evidence: `deno task check`.
- [ ] [`documents/adrs/README.md`](README.md) index gains a
  ADR-0014 row under "Proposed".
  Test: same. Evidence: `deno task check`.
- [ ] AGENTS.md "Key Decisions" list edits — drop the worktree-
  related bullet for ADR-0001/0003/0004; add ADR-0014.
  Test: manual — `<reviewer>: korchasa`. Evidence: ADR diff link.

## Alternatives Considered

- **Keep `worktree_disabled` flag, document it as the no-git mode.**
  Rejected — git modules still imported into engine, AGENTS.md
  invariant violated, JSR tarball still carries git code. Doesn't
  satisfy "or absent" half of the requirement.
- **Implement ADR-0001 (`IsolationProvider` plugin) with `none`
  provider.** Rejected — adds permanent indirection layer to keep
  one provider out of another's way; user explicitly chose removal
  over plugin abstraction; future Docker/ZFS providers are
  speculative and can be revisited as new ADRs without paying
  upfront cost now.
- **Extract git into a sibling JSR package
  (`@korchasa/flowai-isolation-git`).** Rejected — requires runtime
  plugin loader (security surface explicitly rejected by ADR-0001
  rationale); two-repo synchronisation cost (see
  `@korchasa/ai-ide-cli` precedent) is not justified for code that
  three workflows can hold as plain shell scripts.
