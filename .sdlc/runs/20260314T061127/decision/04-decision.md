---
variant: "Variant A: Inline FileReadTracker in agent.ts"
tasks:
  - desc: "Implement FileReadTracker class in engine/agent.ts"
    files: ["engine/agent.ts"]
  - desc: "Add unit tests for FileReadTracker"
    files: ["engine/agent_test.ts"]
  - desc: "Wire FileReadTracker into executeClaudeProcess() event loop"
    files: ["engine/agent.ts"]
  - desc: "Update SRS with FR-39 acceptance criteria"
    files: ["documents/requirements.md"]
  - desc: "Update SDS with FileReadTracker component details"
    files: ["documents/design.md"]
---

## Justification

**Variant A selected** — inline `FileReadTracker` co-located in `engine/agent.ts`.

**Technical fit:** FR-39 requires a ~25-line pure-logic class tracking `Read`
tool-use events per `executeClaudeProcess()` invocation. The class has zero
external dependencies, no I/O, and single call-site wiring. Co-location in
`agent.ts` is proportional to scope — no module boundary overhead for a class
this small.

**Vision alignment (AGENTS.md):** Project vision emphasizes engine as a
domain-agnostic DAG executor. `FileReadTracker` is engine-internal observability
(log-file warnings on repeated reads). It operates within the agent execution
layer without introducing domain-specific logic, preserving the engine's
pipeline-independence invariant. The feature directly supports the Meta-Agent's
ability to detect and remediate anti-patterns — aligned with the autonomous
pipeline optimization goal.

**Complexity trade-off:** Variant B (separate module) adds file/test overhead
for ~25 lines — over-engineering. Variant C (generic ToolUseTracker) violates
YAGNI: spec explicitly defers non-Read tool tracking and configurable
thresholds. Variant A is minimal, tested (7 unit tests), and already
QA-verified.

**Status:** Implementation complete (commit `ebe7cb2`). QA PASS confirmed in
run `20260314T060523`. SRS (section 3.38) and SDS (section 3.6) updated.

## Task Descriptions

1. **Implement FileReadTracker class in engine/agent.ts** — Pure-logic class
   with `Map<string, number>` counter. `track(path): string | null` returns
   warning when count > threshold (default 2). No I/O, no deps.

2. **Add unit tests for FileReadTracker** — 7 tests covering: first read (no
   warning), second read (no warning at threshold), third read (warning emitted),
   warning format, counter independence across paths, threshold boundary, reset
   semantics via new instance.

3. **Wire FileReadTracker into executeClaudeProcess() event loop** — Instantiate
   per invocation. In `assistant` event handler: detect `tool_use` blocks with
   `name === "Read"`, call `tracker.track(block.input.file_path)`. Non-null
   result written to log file via `stampLines()`. Terminal output unchanged.

4. **Update SRS with FR-39 acceptance criteria** — Add FR-39 section to
   `documents/requirements.md` (section 3.38) with acceptance criteria and
   evidence links.

5. **Update SDS with FileReadTracker component details** — Document
   `FileReadTracker` in SDS section 3.6 (agent.ts component): class API,
   instantiation scope, log output format, wiring points.
