# SRS: Engine — Fork/Join (FR-E95..FR-E97)

Explicit splitting and merging of execution flows. Section of
[requirements-engine.md](../requirements-engine.md).

### 3.95 FR-E95: Explicit Fork/Join

- **Description:** Splitting and merging are written down instead of inferred
  from edges. A node MAY carry `fork`, declaring that it opens a branch of a
  named group; exactly one node per group carries `join`, and it runs once,
  after every branch has finished.

  **Two fork shapes.** The string form `fork: "<group>.<branch>"` opens one
  static branch. The object form expands the node into one branch per element
  of a list an earlier node produced, so the split can be decided by an agent
  at runtime rather than only by the config author:

  ```yaml
  refactor:
    type: agent
    inputs: [plan]
    fork: work.refactor            # one static branch
    allowed_paths: ["src/api/**"]
    prompt: "..."

  do:
    type: agent
    inputs: [split]
    fork:                          # one branch per list element
      group: work
      branches: "{{input.split}}/tasks.json"
      key: value.id
      max_concurrent: 3
    prompt: "{{branch.value.prompt}}"

  integrate:
    type: command
    join: work
    failure_mode: collect
    command: "..."
  ```

  **Membership propagates.** `fork` is declared once, on the node that opens
  the branch; every node reachable from it along `inputs` belongs to the same
  branch until the group's `join`. A static branch is therefore as many nodes
  as it needs — an agent that edits and a command that checks the edit are one
  branch, and one worktree. A branch produced at runtime is one node long: its
  expansions live inside that node, so a downstream node would run once for N
  branches and read whichever finished last.

  **Branch list and variables.** The `branches` source is a JSON array of
  strings, numbers or objects, or one item per non-empty line. `key` names the
  branch: absent numbers them, `value` slugifies a scalar item, `value.<field>`
  reads a field of an object item. Inside a branch the item is addressable as
  `{{branch.value}}`, `{{branch.value.<field>}}`, `{{branch.key}}` and
  `{{branch.index}}`; outside one those variables are a config error. A static
  branch has no list item, so its own name is its value: `{{branch.key}}` and
  `{{branch.value}}` are the branch name and `{{branch.index}}` its position
  among the group's branches. Unlike a runtime branch this does not move the
  node's artifact directory — a static branch is spelled out in the config, so
  there is nothing to disambiguate.

  **Failure mode.** `failure_mode` on the join decides what a failed branch
  does to its siblings: `fail_fast` (default) stops the group at the first
  failure, `collect` lets every branch finish and records the failures in the
  manifest, `all_or_nothing` fails the group without running the join.

  **Rejected at config load:** a group with no `join`; a `join` naming a group
  nothing forks into; two `join` nodes for one group; a node carrying both
  fields; two branches declaring the same `<group>.<branch>`; a node whose
  inputs come from two branches of one group; a `.` inside a group or branch
  name; `fork` or `join` on a node type that runs no work of its own, or
  inside a loop body; a `loop` node that inherits branch membership; branch
  names that collide after slugification.
- **Tasks:** [explicit-fork-join](../tasks/2026-08-30-explicit-fork-join.md)
- **Dep:** FR-E88, FR-E97.
- **Supersedes:** FR-E90.
- **Acceptance criteria:**
  - **Tests:** `branch_test.ts`, `config_fork_test.ts`, `fork_join_e2e_test.ts`
    (FR-E95; regression-locked; both fork shapes and their rejections, branch
    naming from scalars and object fields, duplicate-name rejection, membership
    propagation along `inputs`, group/join pairing errors, `branch.*` scope and
    its static-branch values,
    one execution per branch, per-branch artifact directories, `fail_fast`
    versus `collect`, empty and unreadable branch sources).

### 3.96 FR-E96: Captured Node Answers and Branch Manifest

- **Description:** Every node hands back one piece of output that is not a file
  it chose to write — its **answer**. For an agent it is the final message, for
  a command its stdout, and for either it is the `after` hook's stdout when the
  node declares one. The answer is stored as `<node_dir>/.answer`.

  **The engine does not parse it.** A verdict and a unified diff travel the
  same way, which is what makes one mechanism serve both a branch that judges
  and a branch that edits code. A code-editing branch declares
  `after: "git add -A -N . && git diff"` and its patch becomes its answer; a
  bare `git diff` would report tracked modifications only and silently drop
  every file the branch created, so the `-N` is not optional.

  **Manifest for the join.** Before a `join` node starts, the engine writes
  into its artifact directory:

  - `branches.json` — `{group, branches: [{branch, status, nodes: [{id,
    status, answer}]}]}`, where `answer` is a path relative to the join's node
    directory, or `null` when that node left none.
  - `branches/<branch>/<node>.answer` — a copy of each answer.

  The join reads ordinary files rather than a template variable, because an
  answer may be a whole patch and because applying one is a `command` node the
  workflow author writes (`git apply`). The engine adds no git invocation of
  its own for this.
- **Tasks:** [explicit-fork-join](../tasks/2026-08-30-explicit-fork-join.md)
- **Dep:** FR-E95.
- **Acceptance criteria:**
  - **Tests:** `answer_test.ts`, `isolation_e2e_test.ts` (FR-E96;
    regression-locked; a command's stdout as its answer, an `after` hook's
    stdout replacing it, the manifest and answer copies in the join's
    directory, and two code-editing branches whose patches an authored join
    applies — one modifying a tracked file, one creating a new one).

### 3.97 FR-E97: Input-Driven Node Scheduling

- **Description:** A node starts when the nodes it depends on have finished,
  not when its DAG level has. Levels remain the picture of the graph that
  `--dry-run`, the bootstrap journal and drift detection read; they are no
  longer the schedule. Under level execution a one-node branch waits for its
  three-node sibling because they share a level.

  **One dependency map.** `buildDependencies` is the single source: edges from
  `inputs`, plus the edge `inputs` cannot express — a `join` waits for every
  terminal node of every branch of its group. `buildLevels` is a projection of
  it, so the plan a reader sees and the order the engine follows cannot
  disagree. Cycle detection lives in the same place and still throws at load,
  including for a cycle closed through a join edge.

  **Concurrency.** `defaults.max_parallel` stays the global cap on how many
  nodes run at once; its default of 1 keeps the order one node at a time. Two
  scheduling constraints protect attribution: the FR-E50 guardrail brackets the
  set of nodes actually running together rather than a level, and a branch node
  with no write scope of its own runs alone, because its FR-E37 check compares
  repository-wide snapshots and a sibling's write would fail it (FR-E91).
- **Tasks:** [explicit-fork-join](../tasks/2026-08-30-explicit-fork-join.md)
- **Dep:** FR-E95.
- **Acceptance criteria:**
  - **Tests:** `scheduling_test.ts`, `config_fork_test.ts` (FR-E97;
    regression-locked; a successor released before its level sibling finishes,
    a join running after every branch, join edges naming branch terminals only,
    a cycle through a join edge failing at load, `fork`/`join` rejected inside
    a loop body, and a `loop` node rejected inside a branch).
  - [x] `--dry-run` renders a fork graph in execution order — every branch
    before its join — because `buildLevels` projects the dependency map the
    executor reads. Evidence: `src/engine/dag.ts:buildLevels`; a two-branch
    fixture prints `a1`/`b1` on level 2, the alpha terminal `a2` on level 3
    and `integrate` on level 4.
