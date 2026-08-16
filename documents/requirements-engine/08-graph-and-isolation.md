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
