---
variant: "Variant A"
tasks:
  - desc: "Add nodeResult() method to OutputManager"
    files: ["engine/output.ts", "engine/output_test.ts"]
  - desc: "Change executeAgentNode() to propagate AgentResult to executeNode()"
    files: ["engine/engine.ts"]
  - desc: "Call nodeResult() in executeNode() after agent completion"
    files: ["engine/engine.ts", "engine/engine_test.ts"]
  - desc: "Call nodeResult() in executeLoopNode() onNodeComplete callback"
    files: ["engine/engine.ts", "engine/engine_test.ts"]
---

## Critique

### Variant A: OutputManager.nodeResult() with engine-side calls

- **Gap:** Plan states `executeAgentNode()` currently returns `boolean` and
  proposes changing to `AgentResult | null`. However, `executeAgentNode()`
  already has access to `result` (the `AgentResult`) locally and calls
  `markNodeFailed()` with error data. The simpler path is storing the
  `ClaudeCliOutput` on the node state or passing it back via a class field,
  avoiding a return-type change that propagates through the `switch` in
  `executeNode()`. Alternatively, `executeNode()` can call `nodeResult()` using
  data already saved in `state.nodes[nodeId]` — but `ClaudeCliOutput` is not
  persisted there. A local instance variable (e.g., `lastAgentOutput`) is
  cleanest.

### Variant B: Callback-based nodeResult via AgentRunOptions

- **Issue:** Output ordering problem acknowledged in plan but not resolved.
  `nodeResult` fires inside `runAgent()` before `executeNode()` emits
  `nodeCompleted()` — user sees `RESULT` before `COMPLETED`, which is confusing.
  Also adds yet another callback to `AgentRunOptions`, increasing coupling
  between agent module and output layer. Agent module should remain output-
  agnostic per engine's domain-agnostic principle.

### Variant C: Embed result summary into existing nodeCompleted()

- **Issue:** Conflates lifecycle event (node finished) with data display (what
  did agent produce). `nodeCompleted()` has existing callers passing `extra`
  string; overloading with `ClaudeCliOutput?` parameter creates ambiguous API.
  Future FRs wanting richer result display (multi-line, cost breakdown) would
  require further signature changes. Violates single-responsibility.

## Justification

**Selected: Variant A** — `OutputManager.nodeResult()` with engine-side calls.

- **Technical fit:** Cleanest separation of concerns. New `nodeResult()` method
  on `OutputManager` is self-contained. Engine calls it at the right moment
  (after `markNodeCompleted()`, before/alongside `nodeCompleted()`) ensuring
  correct output ordering. No callback proliferation in agent module.
- **Vision alignment:** AGENTS.md states "Engine is domain-agnostic: Engine is a
  generic DAG executor." Variant A keeps output formatting in `OutputManager`
  (its responsibility) and orchestration in engine (its responsibility). Agent
  module stays output-agnostic. This preserves the domain-agnostic engine
  principle.
- **Complexity/maintainability:** Smallest API surface change. One new method on
  `OutputManager`. Engine changes are localized to two call sites
  (`executeNode()` for top-level agents, `onNodeComplete` for loop body nodes).
  Return type change from `boolean` to `AgentResult | null` in
  `executeAgentNode()` is well-scoped — only `executeNode()` calls it.

## Task Descriptions

### Task 1: Add nodeResult() method to OutputManager

Add `nodeResult(nodeId: string, output: ClaudeCliOutput)` to `OutputManager`.
Guarded by `verbosity !== "quiet"`. Format:
`[HH:MM:SS] <nodeId padded>  RESULT: <first line of result, ≤120 chars> | cost=$X.XXXX | duration=Xs | turns=N`

Import `ClaudeCliOutput` from `types.ts`. Unit test: normal mode shows line,
quiet mode suppressed, verbose mode shows line, handles empty/multiline result.

### Task 2: Change executeAgentNode() to propagate AgentResult

Modify `executeAgentNode()` return type from `Promise<boolean>` to
`Promise<AgentResult | null>`. Return the `AgentResult` on success (with output),
`null` on failure or non-agent paths (HITL). Adjust `executeNode()` switch to
capture the return value.

### Task 3: Call nodeResult() in executeNode() after agent completion

In `executeNode()`, after `markNodeCompleted()` and `nodeCompleted()` call,
check if result from `executeAgentNode()` contains `output` field. If so, call
`this.output.nodeResult(nodeId, result.output)`. Only for agent nodes — merge,
human, loop handled separately.

### Task 4: Call nodeResult() in executeLoopNode() onNodeComplete callback

In `executeLoopNode()`'s `onNodeComplete` callback, after the existing
`this.output.status(id, "COMPLETED")` call, add
`this.output.nodeResult(id, result.output)` when `result.output` exists.
Integration test: verify nodeResult called for loop body completions.
