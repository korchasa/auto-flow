<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Graph Expressiveness and Isolation

Requirements from the 2026-08-16 peer comparison
([documents/competitors.md](../competitors.md)): every mature peer ships
conditional transitions, dynamic fan-out, command nodes and per-task
isolation. Reference shapes are named per FR.


### 3.87 FR-E87: Shell-Predicate Loop Exit (`until`)

- **Description:** A `loop` node MAY declare its exit condition as
  `until: "<shell predicate>"` instead of the
  `condition_node`/`condition_field`/`exit_value` triple. After every
  iteration the engine interpolates the predicate against the loop node's
  template context and runs it through `bash -c`. Exit code `0` ends the
  loop; any other code starts the next iteration.

  **Config schema:**
  ```yaml
  fix-until-green:
    type: loop
    label: "Fix until the suite is green"
    until: "deno task check"
    max_iterations: 5
    nodes:
      build:
        type: agent
        label: "Developer"
        prompt: "Fix the failing tests. Iteration {{loop.iteration}}."
  ```

  **Mutual exclusivity.** `until` and the triple are mutually exclusive, and
  a loop MUST declare exactly one of them. Config load rejects both-set with
  the offending triple keys named, and neither-set with both alternatives
  named. This removes the earlier implicit state where a loop with no exit
  contract ran silently to `max_iterations`.

  **Engine behaviour:**
  - cwd for the predicate is the run's working directory (the worktree when
    isolation is on), so relative paths mean the same thing they mean to an
    agent node.
  - The full template surface applies: `{{loop.iteration}}`, `{{node_dir}}`,
    `{{run_dir}}`, `{{env.*}}`, `{{args.*}}`, `{{input.*}}`.
  - An unresolvable template variable fails the loop with the interpolation
    error rather than degrading to a predicate that never matches.
  - A non-zero exit is reported at status level with the captured stderr, so
    a broken predicate names itself instead of looking like a stubborn agent.
  - `LoopResult.exit_reason` is `until_satisfied` on this path, distinct from
    the triple's `exit_value`.
  - `lastConditionValue` carries `exit <code>` so exhaustion diagnostics stay
    meaningful for both exit contracts.
- **Motivation:** The triple expresses exactly one predicate shape — "this
  frontmatter field equals this literal". Loops that should end on "the test
  suite passes", "no TODOs remain", or "PASS on the third attempt" had to
  route the answer through an agent writing a frontmatter field, which makes
  the agent the arbiter of a fact the shell can establish directly. Bernstein
  demonstrates the cheaper contract (`loop: {until: "<bash>", max_iterations}`)
  without introducing an expression language, since the shell is already a
  dependency of every workflow through `before`/`after`/`custom_script`.
- **Acceptance criteria:**
  - **Tests:** `loop_until_test.ts`, `config_loop_until_test.ts` (FR-E87;
    regression-locked; predicate exit-code semantics, interpolation, cwd
    scoping, fail-fast on unresolved variables, stderr capture, mutual
    exclusivity both ways, non-string and empty rejection, template
    validation at load, triple-path unchanged).

### 3.88 FR-E88: Command Node (`type: command`)

- **Description:** A node MAY declare `type: command` and carry a `command:`
  string instead of a `prompt:`. The engine interpolates the command against
  the node's template context, runs it through `bash -c` in the run's working
  directory, and treats exit `0` as success. It is a full DAG citizen: it
  takes `inputs:`, participates in levels, may sit inside a loop body, and
  may carry `validate:` rules.

  **Config schema:**
  ```yaml
  tests:
    type: command
    label: "Run the suite"
    inputs: [developer]
    command: "deno task check > {{node_dir}}/report.txt"
    validate:
      - type: file_not_empty
        path: "{{node_dir}}/report.txt"
  ```

  **Field rules.** `command` is required, non-empty, and valid only on
  `type: command` nodes — declaring it elsewhere is a load error rather than
  a silently ignored key. A command node MUST NOT carry `prompt`. Template
  variables in `command` are validated at config load, alongside the checks
  already applied to agent prompts.

  **Engine behaviour:**
  - Artifacts: `stdout.txt`, `stderr.txt` and `exit_code.txt` are written into
    the node's artifact directory on every run, success or failure, so
    downstream `{{input.<node-id>}}` references and post-mortems see the same
    bytes.
  - `settings.timeout_seconds` applies. A command killed by the timeout fails
    with `error_category: timeout`; a non-zero exit fails with
    `command_failed`.
  - `validate:` rules run once after a successful command. Failure yields
    `error_category: validation_failed` — there is no continuation loop,
    because re-running an unchanged deterministic command reproduces the same
    artifacts.
  - Cost, session id and result text stay undefined: a shell command has no
    model output, and a synthetic zero-cost record would put fictional numbers
    into the run summary.
  - Inside a loop body the result is projected onto the same `AgentResult`
    shape the loop's budget, journal and condition bookkeeping already use.
- **Motivation:** Deterministic steps — run the suite, build, lint, publish —
  were only expressible as `before`/`after` hooks bolted onto an agent node,
  or as an agent instructed to run one command. The first hides the step from
  the DAG (no id, no artifacts, no resume granularity, no place to hang
  `validate`); the second spends a model call and a context window on work
  with no judgement in it, and lets the agent misreport the outcome. Every
  peer surveyed in [competitors.md](../competitors.md) ships a command step —
  Bernstein `command`, Conductor's non-agent step types, goose recipe shell
  steps.
- **Dep:** FR-E87.
- **Acceptance criteria:**
  - **Tests:** `command_test.ts`, `config_command_node_test.ts` (FR-E88;
    regression-locked; exit-code mapping, artifact persistence, interpolation,
    cwd scoping, timeout, fail-fast on unresolved variables, wrong-type
    rejection, field-rule validation at load, loop-body execution and
    failure).
  - [x] Dispatch wired for top-level nodes. Evidence:
    `src/engine/engine.ts:553`, `src/engine/node-dispatch.ts:527`.

### 3.89 FR-E89: Conditional Node Execution (`when`)

- **Description:** Any node MAY carry `when: "<shell predicate>"`. The engine
  evaluates it immediately before the node would run: exit `0` runs the node,
  any other code skips it. The skip propagates — every node that lists a
  gated-out node in its `inputs` is skipped too, transitively.

  **Config schema:**
  ```yaml
  hotfix-review:
    type: agent
    label: "Extra review for hotfixes"
    inputs: [developer]
    when: "test '{{args.kind}}' = hotfix"
    prompt: "Review the hotfix."
  ```

  **Engine behaviour:**
  - The predicate runs through `bash -c` in the run's working directory (the
    worktree when isolation is on) with the node's full template context:
    `{{args.*}}`, `{{env.*}}`, `{{input.*}}`, `{{node_dir}}`, `{{run_dir}}`,
    and `{{loop.iteration}}` for body nodes.
  - A gated-out node reaches status `skipped`, not `failed`; the run's own
    status is unaffected and downstream levels continue.
  - Skip propagation is scoped to `when` gates. `--skip` and `--only` also
    produce `skipped` nodes, but those mean "the operator handled this
    already", so their dependents keep running — the existing behaviour is
    unchanged.
  - Inside a loop body the gate is re-evaluated on every iteration, and the
    within-iteration propagation resets each time: a node skipped on iteration
    1 runs on iteration 2 if its predicate then passes.
  - An unresolvable template variable throws rather than degrading into a gate
    that always closes.
- **Motivation:** Every branch was an unconditional node, so a workflow that
  should take one of two paths had to run both and instruct the unwanted one
  to do nothing — spending a model call and a context window on a no-op, and
  trusting the agent to actually no-op. Conductor expresses this as
  `routes: [{to, when}]` and pi-workflows as `decisionEdge`; the node-level
  form fits this engine's `inputs:`-based edges, where an edge has no config
  object of its own to hang a predicate on.
- **Dep:** FR-E87.
- **Acceptance criteria:**
  - **Tests:** `when_test.ts`, `config_when_test.ts` (FR-E89;
    regression-locked; gate open and closed, transitive skip, argument
    interpolation, gated branch is not a run failure, per-iteration
    re-evaluation in a loop body, non-empty-string and template validation at
    load).

### 3.90 FR-E90: Data-Driven Fan-Out (`for_each`)

- **Description:** An `agent` or `command` node MAY carry a `for_each` block.
  The engine reads a list produced by an earlier node and runs that one node
  once per item, giving each item its own artifact directory and its own
  `{{each.*}}` variables.

  **Config schema:**
  ```yaml
  review:
    type: agent
    label: "Review one file"
    inputs: [plan]
    for_each:
      source: "{{input.plan}}/files.txt"   # required
      key_by: index                        # index (default) | value
      max_concurrent: 1                    # default 1
      failure_mode: fail_fast              # fail_fast (default) | collect
    prompt: "Review {{each.value}} and write the verdict to {{node_dir}}."
  ```

  **Source format.** The path is interpolated, then resolved against the run's
  working directory. Its content is either a JSON array of strings/numbers or
  one item per non-empty line. Content that starts with `[` but does not parse
  as JSON is an error, not a single item — fanning out once over a broken
  array would look like success. Objects inside the array are rejected: the
  fan-out variable is a string.

  **Template variables.** `{{each.value}}` (the item), `{{each.index}}`
  (zero-based), `{{each.key}}` (the item's directory name). They are valid only
  on a node that declares `for_each`; used elsewhere they fail at config load,
  not mid-run.

  **Engine behaviour:**
  - Artifacts land in `<node-dir>/<key>/`. `key_by: index` names them `0`, `1`,
    `2`; `key_by: value` slugifies the item (path separators and whitespace
    become dashes, `..` segments cannot escape the node directory) and suffixes
    collisions.
  - The parent node owns exactly one state transition. Item executions are not
    separate state records, so a fan-out over forty files leaves one verdict in
    the run state rather than forty overwrites of one record.
  - `fail_fast` (default) stops at the end of the chunk containing the first
    failure; `collect` runs every item and then fails the node with a
    `<n> of <total> items failed` tally listing each failure.
  - An empty source completes the node without running anything — "no files to
    review" is an answer, not an error — and downstream nodes proceed.
  - An unreadable source fails the node with the resolved path named.
  - `max_concurrent > 1` warns for the same reason `defaults.max_parallel > 1`
    does: all items share one worktree, so the FR-E50 guardrail can
    mis-attribute one item's writes to another (see FR-E91).
- **Motivation:** The DAG was fixed at config-authoring time, so "review each
  file the planner listed" had to become one agent handling all N files in one
  context — the reviews compete for one context window, one artifact and one
  verdict, and a failure on file 7 loses files 8..N. Conductor ships `for_each`
  over a step's output for exactly this; goose reaches it through subrecipes.
- **Dep:** FR-E88.
- **Acceptance criteria:**
  - **Tests:** `for_each_test.ts`, `for_each_e2e_test.ts`,
    `config_for_each_test.ts` (FR-E90; regression-locked; source parsing in
    both formats and its rejections, key slugification and traversal safety,
    one execution per item, per-item artifact directories under both `key_by`
    modes, `fail_fast` versus `collect`, empty and unreadable sources, config
    defaults, node-type restriction, `each.*` scope).

### 3.91 FR-E91: Node-Scoped Isolation

- **Description:** Two related guarantees for nodes that run at the same time.

  **Part 1 — leak attribution follows the execution scope.** The FR-E50
  guardrail brackets an agent node with two `git status` snapshots of the main
  repository tree. When a level runs one node at a time, the difference between
  the snapshots belongs to that node. When a level runs several nodes at once
  (`defaults.max_parallel != 1` and the level holds more than one runnable
  node), it does not: the snapshots are global, so a file written by node B
  appears inside node A's bracket and is rolled back under A's name. The engine
  therefore switches the per-node guardrail off for a concurrent level and
  brackets the whole level once instead. The level bracket unions the
  `allowed_paths` of every node it covers, and its leak message is attributed to
  the level, not to a node:

  ```
  [guardrail] level=<level-index> (<node-ids>) leaked <n> file(s): <paths> (rolled back)
  ```

  A leak still fails the run and is still rolled back; only the attribution
  widens, because a wrong name is worse than an honest "one of these".

  **Part 2 — `isolation: worktree`.** An `agent` or `command` node MAY carry
  `isolation: worktree`, which gives that node its own git worktree instead of
  the run's shared one. The node's edits are then invisible to every other node,
  including its own `for_each` items, which each get a worktree of their own.
  This is opt-in and off by default, because the shared worktree is the very
  mechanism by which one node's source edits reach the next: making it the
  default would break every sequential workflow the engine runs today.

- **Motivation:** Intra-level concurrency has been implemented but unusable
  since FR-E50 landed: `defaults.max_parallel > 1` emits a warning that the
  guardrail will mis-attribute writes, so no workflow turns it on. The two
  failure modes hiding behind that warning are different problems — a snapshot
  scoped too narrowly (fixable without touching the worktree model) and two
  nodes editing the same file (fixable only by separating their trees) — and
  they are fixed separately.
- **Dep:** FR-E50, FR-E57, FR-E90.
- **Acceptance criteria:**
  - **Tests:** `guardrail_level_test.ts` (FR-E91; regression-locked; the
    per-node guardrail switch and the level attribution in the leak message).

### 3.92 FR-E92: Journal Hash Chain and Verification

- **Description:** Every `journal.jsonl` record carries `prev_hash` (the
  preceding record's hash, `""` for the first) and `hash` (SHA-256 of the
  record's canonical JSON with `hash` removed). Because `prev_hash` is inside
  the hashed payload, each digest transitively covers the whole prefix.
  `flowai-workflow verify [--workflow <path>] <run-id>` checks the chain and
  reports the FIRST divergent record.

  **Command output.** JSON on stdout (`{ok, verified, unchained, broken?}`) and
  a human-readable line on stderr. Exit 0 when the chain holds, 1 when it does
  not — so a CI job or a supervising agent can act on it, not just a reader.

  **Break reasons.** `hash_mismatch` — the named record's own bytes changed.
  `prev_hash_mismatch` — a record before it was edited, removed or inserted.

  **Engine behaviour:**
  - Canonicalisation sorts object keys at every depth and drops `undefined`
    values, so a record round-tripped through `JSON.parse` (which preserves
    file order, not writer order) hashes identically.
  - Verification stops at the first divergence. After one edited record every
    later link mismatches; reporting the last one would name a record that is
    fine and hide the one that is not.
  - Records without a `hash` — journals written before this FR — are counted as
    `unchained` rather than failed, and a writer reopened on such a journal
    starts a fresh chain instead of rewriting history.
  - A writer reopened on a hashed journal continues the chain from the last
    record's hash, so resume does not break verification.
- **Motivation:** `journal.jsonl` was already the recovery contract and the
  replay source, but nothing distinguished the file the engine wrote from a
  file someone edited afterwards — including an agent with filesystem access
  and a reason to make a run look successful. Bernstein makes its lineage
  checkable and signs the receipt; this is the additive first half of that,
  over the journal the engine already keeps.
- **Acceptance criteria:**
  - **Tests:** `journal-chain_test.ts` (FR-E92; regression-locked; canonical
    encoding independence from key order, per-record hash and link, intact
    chain, edited record, removed record, first-divergence reporting,
    pre-hash journals, reopened writer).
  - [x] `verify` subcommand wired with exit codes and usage text. Evidence:
    `src/cli.ts:628`, `src/cli.ts:786`.

### 3.93 FR-E93: Human Node Over the HITL Transport (`type: hitl`)

- **Description:** A node MAY declare `type: hitl`. It asks its `question`
  through the workflow's configured HITL transport (`defaults.hitl`
  `ask_script`/`check_script`), waits for the answer, and writes it to
  `<node-dir>/response.txt`.

  **Config schema:**
  ```yaml
  approve-plan:
    type: hitl
    label: "Approve the plan"
    inputs: [architect]
    question: "Approve the plan for {{args.issue}}?"
    options: ["approve", "reject"]
    abort_on: ["reject"]
  ```

  **Relation to the two pre-existing human paths.** `type: human` prompts on
  the terminal, so it only works while an operator sits at the run.
  `defaults.hitl` handles a question an *agent* raised mid-invocation and
  resumes that agent's session with the reply. `type: hitl` is neither: the
  workflow author decides where the human belongs in the graph, and the answer
  is an artifact rather than a resumed agent turn.

  **Engine behaviour:**
  - `question` is interpolated before delivery, and `options` travel with it in
    the `--question-json` payload the `ask_script` receives.
  - Two answer channels are polled until `defaults.hitl.timeout` elapses: the
    local inbox (written by MCP `provide_human_input` / CLI `answer`) and
    `check_script`. The inbox is read once before the first sleep, so an answer
    that arrived ahead of the question is not delayed by a whole poll interval.
  - A numeric reply resolves to the matching entry of `options`, matching
    `type: human`.
  - The reply is written to `<node-dir>/response.txt` — the same artifact
    `type: human` produces, so a workflow can move from terminal prompting to
    an external channel without touching its downstream nodes — and appended
    to `<node-dir>/hitl.jsonl` for the audit trail.
  - A reply listed in `abort_on` aborts the run, as with `type: human`.
  - No answer within the timeout fails the node with `hitl_timeout`; a failing
    `ask_script` fails it with the script's stderr; HITL scripts not configured
    fail it naming `defaults.hitl`.
- **Motivation:** An approval gate could be expressed only two ways, both
  wrong for an unattended run: a terminal prompt that requires someone watching
  the console, or an agent instructed to ask a question — which makes the model
  responsible for a decision that was supposed to be the human's, and buries
  the question inside an agent turn. The transport for asking a human already
  existed; it was reachable only by agents.
- **Dep:** FR-E89.
- **Acceptance criteria:**
  - **Tests:** `hitl-node_test.ts` (FR-E93; regression-locked; question
    delivery and interpolation, reply capture, option-number resolution,
    polling until an answer arrives, inbox precedence, `abort_on`, timeout,
    ask-script failure, unconfigured transport, audit record).
  - [x] Dispatch wired for the new node type. Evidence:
    `src/engine/engine.ts:646`, `src/engine/node-dispatch.ts:570`.
