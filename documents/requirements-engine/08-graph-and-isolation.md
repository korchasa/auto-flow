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
