---
variant: "Variant A: Inline tracking in executeClaudeProcess()"
tasks:
  - desc: "Add formatRepeatedReadWarning() pure function and unit tests"
    files: ["engine/agent.ts", "engine/agent_test.ts"]
  - desc: "Add checkRepeatedRead() helper and integrate into executeClaudeProcess() event loop"
    files: ["engine/agent.ts"]
  - desc: "Add integration test simulating multiple Read events verifying warning in log"
    files: ["engine/agent_test.ts"]
  - desc: "Update SRS (FR-40 section) and SDS (agent.ts component docs)"
    files: ["documents/requirements.md", "documents/design.md"]
---

## Justification

**Selected: Variant A** over B (extracted class) and C (callback-based).

1. **Minimal complexity, maximum alignment with existing patterns.** FR-39 turn
   separators and summary footer were implemented inline in
   `executeClaudeProcess()` — same pattern. Adding read tracking inline follows
   the established convention. Per AGENTS.md: "avoid over-engineering" and
   "keep solutions simple and focused."

2. **Variant B is over-engineering.** ~15 lines of counter + threshold logic
   does not warrant a new module + class. `ReadTracker` class adds a file, an
   import, and a coupling decision (extracting `shortenPath()`) for zero
   behavioral benefit. Violates AGENTS.md principle: "Don't create helpers,
   utilities, or abstractions for one-time operations."

3. **Variant C is premature abstraction.** Designing an extensible
   `onStreamEvent` callback pattern for hypothetical future stream analyzers
   adds indirection without a second use case. Violates: "Don't design for
   hypothetical future requirements."

4. **Testability preserved.** Variant A extracts `formatRepeatedReadWarning()`
   as a pure function for unit testing — same testability as B/C without the
   abstraction overhead. Integration test follows existing `turn separators +
   footer` test pattern.

5. **Effort: S** — smallest of all three variants. Fits the scope of the issue
   (informational warning, no behavioral change to execution).

## Task Descriptions

### Task 1: Add `formatRepeatedReadWarning()` pure function and unit tests

Create exported pure function `formatRepeatedReadWarning(path: string, count:
number): string` in `engine/agent.ts`. Returns
`[WARN] repeated file read: <path> (<N> times)`. Add unit tests in
`engine/agent_test.ts` verifying format with various paths and counts. TDD:
write tests first, then implement.

### Task 2: Add `checkRepeatedRead()` helper and integrate into event loop

Add `checkRepeatedRead(readCounts: Map<string, number>, filePath: string):
string | null` helper in `engine/agent.ts`. Increments count in map; returns
formatted warning when count > 2, else null. In `executeClaudeProcess()`:
declare `readCounts` map, detect `tool_use` events with `name === "Read"`,
extract `input.file_path`, call helper, write non-null result to `logFile` via
`stampLines()`. Log-only (no `onOutput` callback).

### Task 3: Add integration test for repeated read warning in stream log

Add test in `engine/agent_test.ts` simulating stream-json output with multiple
`Read` tool-use events for the same file path. Verify that warning lines
appear in the log file after 2nd occurrence. Follow existing test pattern from
FR-39 turn separators test.

### Task 4: Update SRS and SDS

- **SRS:** Add FR-40 acceptance criteria with `[ ]` status markers in
  `documents/requirements.md` section 3.39+.
- **SDS:** Update `agent.ts` component description in `documents/design.md`
  section 3.6 to document `formatRepeatedReadWarning()`,
  `checkRepeatedRead()`, and the `readCounts` map lifecycle within
  `executeClaudeProcess()`.
