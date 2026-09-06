# SDS: Engine — Fork/Join (FR-E95..FR-E97)

Design for explicit branching, captured answers and readiness scheduling.
Section of [design-engine.md](../design-engine.md).

## 1. Branching (FR-E95)

**Modules:** `src/engine/branch.ts` (renamed from `for-each.ts`),
`src/config/config.ts` (`validateFork`, `validateJoin`, `parseForkName`,
`resolveBranchMembership`, `validateForkGraph`), `src/engine/dag.ts`
(`buildDependencies`, `branchTerminals`), `src/engine/engine.ts#executeFork`,
`src/config/template.ts` (`branch.*`).

**Public surface:**

```ts
export interface BranchItem { index: number; value: unknown; key: string }

export function parseBranchSource(text: string): unknown[];
export function slugifyKey(value: string): string;
export function assignKeys(values: unknown[], keyPath?: string): BranchItem[];
export function resolveBranchItems(
  node: NodeConfig, ctx: TemplateContext, cwd?: string,
): Promise<BranchItem[]>;
export function branchContext(ctx: TemplateContext, item: BranchItem): TemplateContext;
export function ensureItemDir(ctx: TemplateContext, cwd?: string): Promise<void>;
```

**Membership is computed, not declared per node.** `resolveBranchMembership`
runs a fixpoint over `inputs`: a node with `fork` seeds its own branch, and any
node whose inputs all sit in one branch of a group inherits it, stopping at the
group's `join`. Inheriting from two branches of one group is rejected — the
node would have to run twice with no way to say which run is which. A branch
opened by the object form of `fork` carries the sentinel branch name `*`,
because its real names exist only at runtime; a node inheriting from `*` is
rejected at load with "one node long", which is the honest statement of the
limitation rather than a run that reads whichever expansion finished last.

**One dependency map.** `buildDependencies(config)` returns `inputs` edges plus
join edges, then runs `detectCycles`. A join's dependencies are the *terminal*
nodes of each branch — `branchTerminals` computes them as "no sibling of the
same branch takes this node as input", which is the only edge the config cannot
spell out. `buildLevels` became `topoSort(buildDependencies(config))`, so
`--dry-run`, the bootstrap journal, drift detection and the executor read one
graph. A cycle closed through a join edge therefore fails at load like any
other cycle.

**Validation.** `validateFork` accepts either shape and normalises the object
one (`max_concurrent: 1`, `failure_mode` on the join); `parseForkName` splits
`<group>.<branch>` and rejects a missing half or an extra dot. `validateJoin`
pairs groups with joins: no join for a group, no fork for a join, two joins for
one group, and both fields on one node are all load errors. `fork` and `join`
are restricted to `agent` and `command` nodes and rejected inside a loop body —
a control structure that multiplies a control structure has no defined
iteration count. `for_each` throws a migration message naming `fork`.

**Template layer.** `branch` replaces `each` as the context-scoped namespace,
addressing `index`, `key`, `value` and `value.<field>`. `validateTemplateVars`
gains `allowBranch`, set from the node's own membership, so `{{branch.value}}`
outside a branch is a load-time error.

## 2. Answers and the manifest (FR-E96)

**Modules:** `src/engine/answer.ts` (new), `src/engine/agent.ts`,
`src/engine/node-dispatch.ts`, `Engine.writeBranchManifest`.

```ts
export const ANSWER_FILE = ".answer";
export function persistAnswer(ctx: TemplateContext, answer: string): Promise<void>;
export function readAnswer(nodeDir: string): Promise<string | null>;
```

`runShellCommand` now returns the hook's stdout instead of discarding it, which
is the whole of the `after`-hook change: when a node declares `after`, that
stdout is the node's answer; otherwise the answer is the agent's final message
or the command's stdout. The engine never parses it — a verdict word and a
unified diff take the same path, which is what lets one mechanism serve a
branch that judges and a branch that edits code.

`writeBranchManifest(joinId, group)` runs before the join starts and copies each
branch node's `.answer` into `branches/<branch>/<node>.answer` under the join's
directory, plus a `branches.json` naming every branch, its status and the
relative path of each answer. The join reads files rather than a template
variable because an answer can be a whole patch, and applying one is a
`command` node the workflow author writes (`git apply`) — the engine adds no
git call site for it.

## 3. Readiness scheduling (FR-E97)

**Modules:** `Engine.runNodes`, `Engine.gateNode`, `Engine.runScheduledNode`,
`src/isolation/guardrail.ts#GroupGuardrail`,
`src/isolation/branch-scope.ts` (new), `src/isolation/glob.ts#globsOverlap`.

`runNodes(nodeIds)` replaces `executeLevel`. It loops while work remains:
`ready()` collects nodes whose dependencies have all finished, `exclusive()`
holds back a node that must run alone, the rest start until `max_parallel` is
reached, and `Promise.race` over the running set releases the next wave. The
budget check that used to run per level now runs on every completion, so a run
aborts as soon as it crosses the cap rather than at the next level boundary.
`executeLevel`, `executeLevelWithLevelGuardrail`, `runLevelNodes` and
`warnUnsafeParallelism` are gone.

**Failure modes.** `branchFailureMode(nodeId)` resolves a node's group through
`branchOf` and reads `failure_mode` off that group's join, so one rule governs
static and runtime branches alike. On a node failure `absorbBranchFailure`
decides whether the scheduler stops: `fail_fast` returns false and the run
stops as before; `collect` and `all_or_nothing` return true, and the failed
node is added to `satisfied` — so the join is reached — and to `untaken` as
`failed`, so the rest of ITS branch is skipped the way any untaken path is.
`all_or_nothing` additionally records the group in `failedGroups`, which
`gateNode` reads to skip that group's join and which makes `runNodes` return
false; the per-run state (`failedGroups`, `runningScopes`, `bracketScopes`,
`untaken`, `journalledBranches`) is cleared at the top of `run()` so a reused
Engine does not carry one run's failures into the next — an `untaken` entry
left from a previous run would skip a dependant even after its input re-ran
and succeeded. The outcome wave reaches the same
`satisfied` + `untaken` marking through `continueOnFailure` rather than
through a branch mode — a different reason for the same need, since both
schedule past a failure (FR-E34). Without adding the failed node to `satisfied` the join would simply
never become ready, leaving it `pending` with no reason recorded.

**Durable branch set.** `executeFork` appends a `branches_expanded` journal
record (node id, group, and each branch's index, key and value) the first time
it expands a list. On resume `Engine.run` replays those records into
`journalledBranches` and `expandedBranches`, so a re-run of the fork uses the
recorded items instead of re-reading a source file that may have changed, and
a join reached after the resume still finds every branch in its manifest.

**Per-branch session record (FR-E100).** Every branch runs
`executeAgentNode` under the parent node id, so `state.nodes[id].session_id`
would keep whichever branch finished last. A successful branch attempt
therefore writes `branch_sessions[branch.key]` instead, the
`attempt_completed` record carries `branch_key`, and a downstream fork node
with `session: <node-id>` continues the target's branch with the same key —
`revise` branch `k` re-enters `write` branch `k`. Design in
09-session-continuation.

**Rolling guardrail.** `GroupGuardrail.enter(nodeId, allowedPaths)` /
`leave()` keep a depth counter: the first node to start opens one bracket, every
node that joins while it is open is added to the union of scopes and to the
names in the message, and the last to leave closes it. This replaces the
level bracket, because under readiness scheduling the set of nodes running
together is not a level and has no index to name. `formatLeakMessage` takes
`kind: "node" | "group"`.

**Rolling scope check.** FR-E37 has the same attribution problem and gets the
same answer one layer down. `Engine.forgivenScopes(nodeId)` hands `runAgent`
the run directory plus the scopes of every other node that has been inside the
current bracket — `bracketScopes` is cleared only when the last running node
leaves, because a node that finished early still wrote into the tree the
others are checked against. `findViolations` compares against that union, so a
sibling's in-scope write and the engine's own artifact writes are not reported
against a node, while a write outside all of them still fails everyone in the
bracket.

**Derived isolation.** `effectiveAllowedPaths(node, inBranch)` returns
`node.allowed_paths ?? (inBranch ? [] : undefined)`, `isolatedBranches(config)`
lists the branches that declared a scope, and `branchTreeKey(group, branch)`
names their shared worktree. `Engine.maybeIsolated` was generalised from
`node.isolation` to a boolean, so a branch tree and a per-node tree go through
one lifecycle; a branch tree is created by its first node and removed after its
last.

**Why an empty-scope branch node runs alone.** Its FR-E37 check compares
repository-wide snapshots, so a sibling's legitimate write inside the bracket
would fail it. `exclusive()` gives that node the machine to itself instead of
adding per-node attribution the snapshots cannot support. Overlap between
sibling scopes is rejected at load by `globsOverlap`, which is deliberately
conservative: it reports overlap unless the two glob sets are provably
disjoint, because a false rejection costs one edit and a false acceptance costs
a silent clobber.
