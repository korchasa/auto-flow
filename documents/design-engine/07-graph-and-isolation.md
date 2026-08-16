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

## 4. Data-Driven Fan-Out (FR-E90)

**Modules:** `src/engine/for-each.ts` (new),
`src/engine/engine.ts#executeForEach`, `src/config/template.ts` (`each.*`),
`src/config/config.ts#validateForEach`.

**Public surface:**

```ts
export interface ForEachItem { index: number; value: string; key: string }

export function parseForEachSource(text: string): string[];
export function slugifyKey(value: string): string;
export function assignKeys(values: string[], cfg: ForEachConfig): ForEachItem[];
export function resolveForEachItems(
  node: NodeConfig, ctx: TemplateContext, cwd?: string,
): Promise<ForEachItem[]>;
export function itemContext(ctx: TemplateContext, item: ForEachItem): TemplateContext;
export function ensureItemDir(ctx: TemplateContext, cwd?: string): Promise<void>;
```

**Source parsing is a pure function** so the format's edge cases — a JSON array
that does not parse, an array of objects, a bare object, trailing blank lines —
are unit-testable without a filesystem. The `[`-prefix branch throws rather than
falling back to line parsing: a truncated array would otherwise fan out once
over the literal text, which reads as a successful run.

**No new state records.** Item executions run through the ordinary
`executeAgentNode` / `executeCommandNode`, but with an `EngineContext` whose
`nodeStarted`/`nodeCompleted`/`nodeFailed` are replaced by no-ops and a failure
collector. The parent node keeps exactly one `completed`/`failed` transition.
The alternative — synthetic `nodeId#key` state entries — would put ids into
`state.json` that no config declares and that `--skip`, `--only` and the DAG
have no way to address.

**Context derivation.** `itemContext` appends the item's key to `node_dir` and
attaches `each`. It composes a workDir-relative path from another
workDir-relative one, which is why `for-each.ts` is on the allowlist of the
FR-E52 audit test in `template_paths_test.ts` — no filesystem access happens
there. `ensureItemDir` does the wrapping (`workPath`) and creates the directory
before the execution writes into it; without it an agent's first `>` redirect
into `{{node_dir}}` fails on a missing parent.

**Key collisions.** `key_by: value` slugifies, and two distinct items can
slugify to one name (`a/b` and `a-b`). `assignKeys` suffixes the later one, so
each item keeps its own directory instead of silently overwriting.

**Concurrency.** Items run in chunks of `max_concurrent` via `Promise.all`,
mirroring `executeLevel`'s chunking. `fail_fast` breaks after the chunk that
produced the first failure — mid-chunk cancellation would leave half-written
artifacts with no record of which item was interrupted.

**Template layer.** `each` joins `loop` as a context-scoped namespace: unknown
suffixes are rejected outright, and a known suffix outside a fan-out throws.
`validateTemplateVars` gains an `allowEach` parameter (default `false`) that
`validateNode` sets from the node's own `for_each` — so `{{each.value}}` on a
node that never fans out is a load-time error.

**Validation.** `validateForEach` normalises defaults in place (`key_by:
index`, `max_concurrent: 1`, `failure_mode: fail_fast`), rejects unknown keys
inside the block, and restricts the block to `agent` and `command` nodes.
`merge`, `loop` and `human` are excluded deliberately: fanning out a merge has
no meaning, and a fanned-out loop or human prompt would multiply a control
structure rather than a unit of work.

## 5. Node-Scoped Isolation (FR-E91)

**Modules:** `src/isolation/guardrail.ts`, `src/engine/engine.ts`,
`src/engine/node-dispatch.ts`.

### 5.1 Level-scoped guardrail bracket

`GuardrailOptions` gains two fields:

```ts
enabled?: boolean;              // false → no snapshot, no rollback, no log
scopeKind?: "node" | "level";   // attribution word in the leak message
```

`runWithGuardrail` treats `enabled: false` exactly like the existing
`workDir === "."` fast path: it awaits `fn` and returns without touching git.
`formatLeakMessage(scope, leaks, kind = "node")` renders `[guardrail]
<kind>=<scope> …`, so the default keeps every existing message byte-identical.

`Engine` decides the scope per level. `executeLevel` computes `concurrent =
maxParallel !== 1 && filtered.length > 1` after the `when`/`--skip` filter has
run — a level of one runnable node is sequential no matter what `max_parallel`
says, and paying for a second bracket there would only widen attribution for
free. A concurrent level goes through `executeLevelWithLevelGuardrail`, which
unions the `allowed_paths` of every node in the level, sets
`levelGuardrailActive` inside a `try/finally`, and wraps `runLevelNodes` in one
`runWithGuardrail` call with `scopeKind: "level"` and the node ids joined into
the scope string.

The per-node switch travels through `EngineContext.nodeGuardrail`
(`!this.levelGuardrailActive`), which `node-dispatch.ts` passes as `enabled`.
Threading it through the context rather than reading engine state inside the
dispatcher keeps the dispatcher a pure function of its context, which is what
makes its node handlers unit-testable without an `Engine`.

**Why the union of `allowed_paths` and not the intersection.** Under one
bracket the engine cannot tell which node wrote a path, so the narrower rule
would fail nodes for writing what they were allowed to write. The union
loosens the check exactly as much as concurrency has already loosened the
evidence.

### 5.2 Per-node worktree

**Modules:** `src/isolation/worktree.ts` (lifecycle),
`src/isolation/node-isolation.ts` (context derivation), `Engine.maybeIsolated`.

```ts
export function getNodeWorktreePath(runId, workflowDir, key): string;
export function worktreeKey(nodeId: string, itemKey?: string): string;
export function resolveTreeHead(treeDir: string): Promise<string>;
export function createNodeWorktree(runId, workflowDir, key, ref): Promise<string>;
export function isolatedContext(ctx, sharedWorkDir, nodeWorkDir): TemplateContext;
```

`Engine.maybeIsolated(eng, node, key, fn, succeeded)` wraps one node
execution. Without `isolation: worktree` it calls `fn(eng)` and returns.
With it: resolve the run tree's HEAD, create the node tree at that commit,
mirror gitignored files in, run `fn` against a derived `EngineContext`, then
remove the tree on success (after `pinDetachedHead`) or keep it on failure.
The same helper serves plain nodes and `for_each` items — the item path passes
`worktreeKey(nodeId, item.key)` and an `EngineContext` whose `buildContext` is
already item-scoped, so isolation composes on top of fan-out rather than
duplicating it.

**Two working directories, not one.** `EngineContext` splits `workDir` (the
run's tree — artifact I/O and the FR-E50 guardrail) from `nodeWorkDir` (the
tree this node's subprocesses run in). Only `cwd` and the FR-S28 memory check
follow `nodeWorkDir`; the guardrail deliberately stays on the run tree, because
its job is to catch writes into the main repository and the node tree lives
under the gitignored `runs/` umbrella either way.

**Why absolute artifact paths.** FR-E52 makes context paths relative to the
directory the node's processes run in. An isolated node has two directories:
its own tree for source, the shared tree for artifacts. `isolatedContext`
resolves `node_dir`, `run_dir` and every `input.<id>` against the shared tree,
which makes them mean the same directory from any cwd. `workPath` gained one
line for this — an already-absolute path is returned untouched — so every
existing call site keeps working without knowing isolation exists.
`workflow_dir` stays relative on purpose: it names a directory present in every
checkout, and a `flow_file()` lookup should read the node's own tree.

**Base ref is the run tree's HEAD, not `origin/main`.** Checking out the base
branch again would drop everything earlier nodes committed during the run; the
run tree's HEAD carries it. Uncommitted edits in the run tree do not travel —
that is the isolation being asked for, and it is the reason the workflow's
agents are expected to commit.

**Cost.** Every isolated node pays a `git worktree add` plus an FR-E58 copy of
the gitignored files (`node_modules` and friends). That is the whole argument
for opt-in: a workflow that turns it on for one build node pays once, and a
workflow that never turns it on pays nothing.

## 6. Journal Hash Chain (FR-E92)

**Module:** `src/state/run-journal.ts`; CLI surface in `src/cli.ts`
(`verify` subcommand).

**Public surface:**

```ts
export function canonicalJson(value: unknown): string;
export function hashJournalEvent(event: RunJournalEvent): Promise<string>;
export type JournalChainBreakReason = "hash_mismatch" | "prev_hash_mismatch";
export interface JournalChainVerification {
  ok: boolean; verified: number; unchained: number;
  broken?: { seq: number; event_id: string; kind: RunJournalEventKind;
             reason: JournalChainBreakReason };
}
export function verifyJournalChain(runDir: string): Promise<JournalChainVerification>;
```

**Why canonical JSON.** `JSON.stringify` emits keys in insertion order, and a
record read back from disk carries the file's order, not the writer's. Hashing
the raw stringification would therefore make a verifier disagree with the
writer on untouched bytes. `canonicalJson` sorts keys at every depth and drops
`undefined` values.

**What the digest covers.** `hash` is SHA-256 over the record's canonical JSON
with `hash` itself removed — `prev_hash` stays in. That single link is what
makes the digest transitive: verifying record N verifies every record before
it, so an edit anywhere in the prefix surfaces.

**Writer state.** `RunJournalWriter` keeps `#prevHash` beside `#nextSeq` and
recovers it in `open()` from the last record's `hash`. `append` is already
async, so `crypto.subtle.digest` costs no API change.

**Backward compatibility.** `prev_hash`/`hash` are optional on
`RunJournalEventBase`. A journal from before this FR replays unchanged, counts
as `unchained` in verification, and a writer reopened on it starts a fresh
chain from `""` rather than rewriting history it cannot vouch for. In
`verifyJournalChain` an unhashed record resets `expectedPrev` to `undefined`,
which makes the next hashed record's link unconstrained while still checking
its own digest.

**First divergence, not last.** Verification returns on the first mismatch. One
edited record breaks every subsequent link, so a report of the last mismatch
would point at an untouched record and bury the real one.

**CLI.** `verify [--workflow <path>] <run-id>` resolves the workflow through
the shared `resolveActiveWorkflow` rule (FR-E78), prints the verification JSON
on stdout and a sentence on stderr, and exits 1 on a broken chain so CI and
supervising agents can branch on it.

## 7. HITL Node (FR-E93)

**Modules:** `src/hitl/hitl-node.ts` (new),
`src/engine/node-dispatch.ts#executeHitlNode`, `src/engine/engine.ts`
(`case "hitl"`).

**Public surface:**

```ts
export interface HitlNodeResult {
  success: boolean; response: string; aborted: boolean;
  error?: string; error_category?: ErrorCategory;
}
export interface HitlNodeOptions {
  nodeId: string; runDir: string;
  scriptRunner?: ScriptRunner; cwd?: string; output?: OutputManager;
}
export function runHitlNode(
  node: NodeConfig, ctx: TemplateContext,
  config: HitlConfig | undefined, opts: HitlNodeOptions,
): Promise<HitlNodeResult>;
```

**Reuse, not a second transport.** `hitl.ts`'s helpers — `buildScriptArgs`,
`defaultScriptRunner`, `readAndConsumeInbox`, `appendHitlAuditRecord`,
`formatScriptFailure`, `sleep` — became exported and are called from here, so
a node-initiated question reaches the operator through exactly the same
scripts, argument shape and inbox file as an agent-initiated one. What the new
module does NOT reuse is `runHitlLoop`'s second half: there is no session to
resume and no runtime to invoke, so the ACP capability check, MCP re-injection
and resume call have no counterpart on this path.

**`runDir` is an option, not `ctx.run_dir`.** The scripts run with cwd inside
the worktree, where the workDir-relative run directory does not exist;
`executeHitlNode` passes `resolve(getRunDir(...))`, mirroring
`handleAgentHitl`. This also keeps `hitl-node.ts` clear of the FR-E52 audit's
bare-`ctx.run_dir` rule.

**Artifact compatibility with `type: human`.** The reply lands in
`response.txt` under the node's directory and option numbers resolve to option
text, so swapping `type: human` for `type: hitl` changes who is asked and how,
not what downstream nodes read.

**Abort handling.** `executeHitlNode` calls `markRunAborted` before failing the
node, matching `executeHumanNode`. A human's "reject" is meant to stop the
workflow; failing only that node would leave the rest of the level running.

**Validation.** `validTypes` gains `"hitl"`, and the type-specific branch
requires a non-empty `question` and validates its template variables.
