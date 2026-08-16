<!-- section file — index: [documents/design-engine.md](../design-engine.md) -->

# SDS Engine — Graph Expressiveness and Isolation

Design for FR-E87..FR-E93. Kept in its own section file because
`02-engine-modules-flow.md` and `04-data-and-logic.md` are both within 5 %
of the `documents/` byte cap.

## 1. Shell-Predicate Loop Exit (FR-E87)

**Module:** `src/engine/loop.ts`.

**Public surface:**

```ts
export interface UntilPredicateResult {
  satisfied: boolean;  // exit code === 0
  code: number;
  stderr: string;
}

export function evaluateUntilPredicate(
  command: string,
  ctx: TemplateContext,
  cwd?: string,
): Promise<UntilPredicateResult>;
```

**Why a separate exported function.** The predicate is the whole feature;
keeping it out of `runLoop` makes exit-code semantics, interpolation and cwd
scoping unit-testable without spinning up a runtime adapter or a body node.

**Interpolation before execution.** `interpolate(command, ctx, cwd ??
ctx.workDir)` runs first, so the predicate sees the same variable surface as
a prompt. Interpolation throws on an unknown variable; `runLoop` catches that
and fails the loop with the interpolation message. Swallowing it would leave
a predicate that can never match, i.e. a loop that always exhausts
`max_iterations` — the exact silent-failure shape the fail-fast rule forbids.

**Execution.** `bash -c <resolved>` with `cwd = cwd ?? Deno.cwd()`, stdout and
stderr piped. Only the exit code decides; stdout is ignored, stderr is
captured for diagnostics.

**Control flow inside `runLoop`.** `usesUntil` is computed once from
`loopNode.until`. After the body-node sequence of an iteration:

- `usesUntil` → evaluate the predicate, set `lastConditionValue` to
  `exit <code>`, return `{success: true, exit_reason: "until_satisfied"}` when
  satisfied, otherwise emit a status line carrying the exit code and stderr
  and `continue`.
- otherwise → the pre-existing `extractConditionValue` path, unchanged.

`LoopExitReason` gains `until_satisfied` rather than reusing `exit_value`, so
a consumer reading the reason can tell which contract ended the loop.

The exhaustion message branches on the same flag: the `until` branch reports
the predicate text and its last exit code, the triple branch keeps the
`field=value, expected` wording.

**Validation (`src/config/config.ts`, `validateNode`).** Inside the `loop`
branch, before any triple-specific check:

1. `hasUntil = node.until !== undefined`;
   `declaredTriple = ["condition_node","condition_field","exit_value"].filter(present)`.
2. Both present → reject, naming the declared triple keys.
3. Neither present → reject, naming both alternatives.
4. `hasUntil` → `until` must be a non-empty string, and
   `validateTemplateVars` must accept it.
5. otherwise → the three original type checks.

Two downstream checks are gated on `!hasUntil`: `condition_node` must be a
body-node key, and the FR-E36 `condition_field` ↔ `frontmatter_field`
agreement check. An `until` loop has no condition node, so both are vacuous.

`NODE_CONFIG_KEYS` gains `"until"`; without it the unknown-key guard would
reject the field before any of the above ran.

## 2. Command Node (FR-E88)

**Module:** `src/engine/command.ts` (new). Dispatch in
`src/engine/node-dispatch.ts#executeCommandNode` and
`src/engine/engine.ts` (`case "command"`); loop-body path in
`src/engine/loop.ts#runCommandBodyNode`.

**Public surface:**

```ts
export interface CommandNodeResult {
  success: boolean;
  code: number;          // -1 when killed by the timeout
  stdout: string;
  stderr: string;
  resolved: string;      // the command after interpolation — what ran
  error?: string;
  error_category?: ErrorCategory;
}

export function runCommandNode(
  node: NodeConfig,
  ctx: TemplateContext,
  settings: ResolvedNodeSettings,
  cwd?: string,
): Promise<CommandNodeResult>;
```

**Why a separate module rather than a branch in `agent.ts`.** The two share
nothing but the artifact directory: no session, no continuation loop, no HITL
interception, no tool filter, no runtime adapter. Folding the command path
into `runAgent` would put a `if (isCommand)` guard in front of a dozen
agent-only concerns.

**Timeout.** `settings.timeout_seconds` drives an `AbortController` passed as
the subprocess `signal`. An aborted subprocess surfaces as a rejection on some
platforms and as a signalled exit on others; both are normalised onto
`{code: -1, error_category: "timeout"}` by re-throwing only when the abort was
*not* ours. `resolved` is quoted in the message so the operator sees the
command that hung, not the template.

**Artifact persistence.** `persistStreams` writes `stdout.txt`, `stderr.txt`
and `exit_code.txt` before the result is classified, so failures keep their
evidence. The path is `workPath(ctx.workDir, ctx.node_dir)` — keyed on
`ctx.workDir`, not the subprocess `cwd`. The artifact contract is defined
against `workDir` (FR-E52), and using the `cwd` argument here would
double-prefix a path when a caller passes both.

**Validation without continuation.** Both call sites run `runValidations`
once after a successful command and fail with `validation_failed` — a new
`ErrorCategory` member. Reusing `continuations_exhausted` would name a
mechanism that never ran; reusing `command_failed` would blame the command
for a rule it satisfied.

**Loop-body projection.** `runCommandBodyNode` maps `CommandNodeResult` onto
`AgentResult` (`continuations: 0`, `output` left undefined) so the loop's
budget accounting, journal writes and per-node state transitions stay on one
code path. `output` stays undefined deliberately: a synthetic `CliRunOutput`
with `total_cost_usd: 0` would flow into `state.total_cost_usd` and the run
summary as a real measurement.

**Validation (`src/config/config.ts`, `validateNode`).**
`NODE_CONFIG_KEYS` gains `"command"`, `validTypes` gains `"command"`. Then:
`command` present on a non-command node → reject; command node without a
non-empty string `command` → reject; command node carrying `prompt` →
reject; `validateTemplateVars(node.command)` must pass.

## 3. Conditional Node Execution (FR-E89)

**Modules:** `src/engine/predicate.ts` (new, shared with FR-E87),
`src/engine/engine.ts#executeLevel`, `src/engine/loop.ts` (body-node gate).

**Shared predicate.** FR-E87's `evaluateUntilPredicate` and FR-E89's `when`
are the same mechanism — interpolate, `bash -c`, exit 0 means yes. The
implementation moved to `evaluateShellPredicate` in `predicate.ts`;
`evaluateUntilPredicate` is now a thin wrapper that keeps the loop's
vocabulary at its call sites and its FR-E87 tests intact.

**Where the gate sits.** In `executeLevel`'s filter loop, after the
`--skip`/`--only` filters and before `executeNode`. Levels run in dependency
order, so by the time a node's level runs, every one of its inputs has already
been decided — no extra pass is needed to know whether an input was gated out.

**Two skip vocabularies.** `NodeStatus.skipped` already covers `--skip` and
`--only`. Those mean "the operator handled this", and their dependents must
still run; changing that would break existing resume workflows. So FR-E89
keeps its own `Engine#whenSkipped: Set<string>` and propagates only from it. A
node whose `inputs` intersect that set is added to the set and skipped with
the offending input named.

The set is in-memory and per-run. On resume, non-completed nodes are
re-evaluated from scratch — including their gates — which is the correct
reading: a predicate over the working tree may legitimately answer differently
after the fix that prompted the resume.

**Loop bodies.** `runLoop` keeps a `skippedThisIteration` set, allocated fresh
at the top of each iteration, and applies the same two checks (input-gated,
then own predicate) before the agent/command branch. Resetting per iteration is
the point: a gate that closed on iteration 1 is expected to open later, which
is precisely why one would gate inside a loop.

**Validation (`src/config/config.ts`, `validateNode`).** `when` is checked
before the type-specific branches, since it applies to every node type:
non-empty string, and `validateTemplateVars` must accept it. `NODE_CONFIG_KEYS`
gains `"when"`.
