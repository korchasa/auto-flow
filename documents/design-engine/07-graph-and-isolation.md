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
