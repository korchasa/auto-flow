---
variant: "Variant B: Extract helper + call from event loop"
tasks:
  - desc: "Add FileReadTracker class to engine/agent.ts"
    files: ["engine/agent.ts"]
  - desc: "Integrate tracker into executeClaudeProcess() event loop"
    files: ["engine/agent.ts"]
  - desc: "Add unit tests for FileReadTracker and integration test for log output"
    files: ["engine/agent_test.ts"]
---

## Justification

**Selected: Variant B** — extract `FileReadTracker` class in `engine/agent.ts`,
call from event loop.

**Why not Variant A (inline counter):** `executeClaudeProcess()` is already
~170 lines. Inlining counter + threshold logic + format string further bloats
the function and makes the warning logic untestable without full CLI I/O
simulation. The event iteration duplication (existing tech debt from turn
separators) would be compounded.

**Why not Variant C (separate module):** Two new files (`read-tracker.ts` +
`read-tracker_test.ts`) for ~30 lines of logic is disproportionate. The tracker
is tightly coupled to `executeClaudeProcess()` — it consumes the same event
stream and writes to the same log file. Separate module adds import overhead
without meaningful separation of concerns.

**Why Variant B:** Isolates tracking logic into a testable class without I/O
dependencies. Pure `track(path): string | null` method enables direct unit
tests (threshold boundary, per-path independence, format validation) without
process mocking. Same file keeps the tracker co-located with its only consumer.
Aligns with AGENTS.md vision: engine remains domain-agnostic (tracker is generic
file-read counting, not git/GitHub-specific). Effort is S — minimal risk.

## Task Descriptions

### Task 1: Add FileReadTracker class to engine/agent.ts

Create `FileReadTracker` class with:
- `threshold` parameter (default 2)
- `Map<string, number>` for per-path counts
- `track(path: string): string | null` — increment count, return formatted
  warning `[WARN] repeated file read: <path> (<N> times)` when count >
  threshold, else null
- `reset()` — clear map (for testing)

Place below exports, before `executeClaudeProcess()`.

### Task 2: Integrate tracker into executeClaudeProcess() event loop

In `executeClaudeProcess()`:
- Instantiate `FileReadTracker` after existing `turnCount` declaration
- In NDJSON event loop, for `event.type === "assistant"`: iterate
  `event.message.content[]` blocks. For `block.type === "tool_use" &&
  block.name === "Read"`: call `tracker.track(block.input.file_path)`
- If result non-null and `logFile` exists: write via `stampLines()` (consistent
  with turn separator writes)
- Counter resets per invocation (new tracker instance per call)

### Task 3: Add unit tests for FileReadTracker and integration test

In `engine/agent_test.ts`:
- **FileReadTracker unit tests** (pure logic, no I/O):
  - Threshold boundary: 2 reads = null, 3rd read = warning string
  - Per-path independence: path A 3x warns, path B 2x returns null
  - Warning format: matches `[WARN] repeated file read: <path> (<N> times)`
  - Consecutive warnings: 4th read returns `(4 times)`, not just 3rd
- **Integration test:** Simulated event stream with repeated reads produces
  expected warning lines in log file output
