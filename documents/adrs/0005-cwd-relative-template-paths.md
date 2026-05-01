# ADR-0005: TemplateContext path fields are workDir-relative; engine consumers wrap via `workPath`

## Status

Accepted

## Context

`TemplateContext` (`template.ts`) carries `node_dir`, `run_dir`, and
`input.<id>` path fields that flow into both:

- **Template rendering** — values reach subprocess prompts whose cwd
  is `workDir` (the per-run worktree). Subprocesses must see paths
  resolvable from cwd = workDir.
- **Engine-internal FS I/O** — the engine process itself never
  `chdir`s; its cwd is the main repo root.

Pre-FR-E52 the engine's `node-dispatch.ts` and friends emitted these
paths as repo-rooted absolutes, which broke subprocess prompts under
worktree mode. The Variant A fix in commit `b0db7e6` (FR-E7) made
all three fields workDir-relative — correct for the subprocess
channel.

But the engine still has a handful of internal consumers that read
the same fields for FS operations from the main-repo cwd:
`agent.ts::resolveInputArtifacts`, `validate.ts::runSingleValidation`,
loop and HITL handlers. After the fix those consumers were silently
broken — relative paths resolved from the wrong cwd, producing empty
verbose-input listings and `Loop 'implementation': condition_field
'verdict' not found` (`github-inbox` run `20260501T020329`, issue
#196).

## Decision

Codify the contract:

- `TemplateContext.node_dir`, `.run_dir`, and `.input.<id>` are emitted
  **workDir-relative** by the engine. This is the canonical form.
- `template.ts` is the only legitimate raw-emission consumer — its
  values flow into prompts whose cwd is `workDir`.
- Every other consumer of these fields must wrap via
  `workPath(ctx.workDir, …)` before any `Deno.stat`, `readDir`,
  `readTextFile`, or path arithmetic.
- An audit test in `template_paths_test.ts::FR-E52 — bare ctx.node_dir
  / ctx.run_dir restricted to template.ts` greps every non-test root-
  level `*.ts` source for bare references to the fields and fails CI
  if any line outside `template.ts` lacks a `workPath` wrapper.

Subprocess invocations (`Deno.Command(..., { cwd: workDir })`) and
template-rendered shell commands do NOT need wrapping — their cwd
already aligns with workDir.

## Consequences

- **Positive.** One contract, one form, one audit point. Any new
  consumer that adds an unwrapped reference fails CI before merge.
  The verbose-input bug and the `validate.ts` interpolated-path bug
  cannot recur as long as the audit holds.
- **Negative.** The audit is a regex over source files — it detects
  literal `ctx.node_dir`/`ctx.run_dir` mentions but cannot reach
  through indirection (e.g., paths threaded via `interpolate(rule.path,
  ctx)` inside `validate.ts`). Such cases need their own targeted
  regression tests (see `validate_test.ts::FR-E52 — file_exists under
  worktree wraps path with workDir`).
- **Invariants.** `template.ts` is the audit allowlist. Adding a new
  emission site requires updating the allowlist AND adding a
  regression test for any indirect consumer it implies.
- **Cross-link.** Implements FR-E52 (see
  `documents/requirements-engine/04b-worktree-isolation.md` §3.52).
  Closes a contract gap left by the Variant A fix `b0db7e6` (FR-E7).

## Alternatives Considered

- **Emit absolute paths from the engine.** Rejected — subprocess
  prompts under worktree mode expect cwd-relative paths so the agent
  can write back; absolute paths created the original FR-E48 leak
  (writes outside workDir) the FR-E50 guardrail had to catch.
- **Have the engine `chdir` to `workDir` for the duration of a node.**
  Rejected — engine is multi-node and can interleave async I/O on the
  main repo (state.json, locks). A process-wide cwd change is racy and
  spreads worktree concerns into every unrelated I/O call site.
- **Provide a single `ctx.absoluteNodeDir` field alongside the
  relative one.** Rejected — doubles the surface area without
  clarifying which field a given consumer should pick. The
  `workPath()` wrapper already collapses both forms into a single
  call, with a lint-enforced policy.
