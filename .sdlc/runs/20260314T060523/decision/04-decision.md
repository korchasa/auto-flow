---
variant: "Variant A: Inline class in agent.ts (implemented)"
tasks:
  - desc: "Verify FR-39 implementation in engine/agent.ts"
    files: ["engine/agent.ts", "engine/agent_test.ts"]
  - desc: "Verify FR-39 in SRS (requirements.md section 3.38)"
    files: ["documents/requirements.md"]
  - desc: "Verify FR-39 in SDS (design.md section 3.6)"
    files: ["documents/design.md"]
---

# Decision: Variant A — Inline `FileReadTracker` in `agent.ts`

## Justification

**Variant A selected** because FR-39 is already implemented (commit `ebe7cb2`,
QA PASS) and the design is sound:

1. **Simplicity (AGENTS.md: "avoid over-engineering"):** Single-consumer class
   co-located with its only call site (`executeClaudeProcess()`). No indirection,
   no new modules, no API surface expansion. Aligns with project vision of
   keeping the engine domain-agnostic — `FileReadTracker` is a pure engine
   concern (observability), not domain logic.

2. **Variant B rejected — premature abstraction:** Extracting to
   `engine/read-tracker.ts` adds a module boundary for a class with exactly one
   consumer. The plan correctly identifies YAGNI risk. No second consumer exists
   or is planned. Module extraction can be done later if needed (refactor, not
   feature work).

3. **Variant C rejected — over-engineering:** Event processor middleware pattern
   (`onEvent` callback) adds API surface, testing complexity, and architectural
   commitment for a hypothetical future need. No second event hook exists.
   YAGNI applies strongly. The plan flags this: "No current second consumer
   exists."

4. **Risk acknowledged:** `executeClaudeProcess()` is long (~200 lines) and the
   tracker adds to its complexity. The duplicated event-loop logic (main loop vs
   buffer-remainder block) is a pre-existing concern not introduced by FR-39.
   Acceptable trade-off: complexity is localized and the class itself is pure
   (unit-testable without I/O).

## Task Descriptions

### Task 1: Verify FR-39 implementation in engine/agent.ts

Confirm `FileReadTracker` class exists with `track(path): string | null` method,
`Map<string, number>` backing, threshold >2 warning, `[WARN]` format. Verify
integration in `executeClaudeProcess()` event loop for `tool_use` blocks with
`name === "Read"`. Verify unit tests in `agent_test.ts` cover: count tracking,
threshold behavior, warning format, per-invocation reset.

### Task 2: Verify FR-39 in SRS

Confirm `documents/requirements.md` section 3.38 contains FR-39 with acceptance
criteria and `[x]` status with evidence (file paths + line numbers).

### Task 3: Verify FR-39 in SDS

Confirm `documents/design.md` section 3.6 documents `FileReadTracker`: class
location, `track()` method, Map-based tracking, warning format, per-invocation
lifecycle, log-file-only output, pure-logic testability. Current SDS (lines
246-253) already accurately reflects Variant A — no update required.
