---
variant: "Variant A: Filter at formatEventForOutput() (SDS-aligned)"
tasks:
  - desc: "Extend Verbosity union type with 'semi-verbose'"
    files: ["engine/types.ts"]
  - desc: "Add -s/--semi-verbose CLI flag, update printUsage()"
    files: ["engine/cli.ts"]
  - desc: "Add verbosity param to formatEventForOutput(), filter tool_use blocks for semi-verbose; wire onOutput path in executeClaudeProcess()"
    files: ["engine/agent.ts"]
  - desc: "Update nodeOutput() gate to include semi-verbose"
    files: ["engine/output.ts"]
  - desc: "Add unit tests: formatEventForOutput semi-verbose filtering, nodeOutput gate, CLI flag parsing"
    files: ["engine/agent_test.ts", "engine/output_test.ts", "engine/cli_test.ts"]
---

## Justification

**Variant A selected** over B and C for three reasons:

1. **SDS-aligned.** The current SDS already describes this exact approach:
   `formatEventForOutput(event, verbosity?)` with optional param, tool_use block
   filtering at source, log writes unchanged (design.md:255-260). Implementing
   Variant A requires zero SDS design changes — only FR number correction
   (FR-40 -> FR-41).

2. **Type-safe filtering at source.** Variant B filters formatted strings by
   prefix convention (`[stream] tool:`) — fragile, breaks silently if output
   format changes. Variant A filters `content.type === "tool_use"` on structured
   data before formatting — type-safe, immune to format changes.

3. **Minimal complexity.** Variant C adds a new `formatEventForTerminal()`
   function that partially duplicates `formatEventForOutput()` logic. The plan
   itself notes "marginal benefit over Variant A." Per AGENTS.md vision:
   "avoid over-engineering" — a 3-line filter in the existing function is
   simpler than a new abstraction.

**Risk mitigation:** The key risk (log files accidentally receiving verbosity
param) is addressed by the existing architecture — log writes and terminal
`onOutput` are separate call sites. Tests will verify log path calls without
verbosity param.

## Task Descriptions

### Task 1: Extend Verbosity union type
Add `"semi-verbose"` to the `Verbosity` type union in `engine/types.ts`.
Currently `"quiet" | "normal" | "verbose"` — becomes
`"quiet" | "normal" | "semi-verbose" | "verbose"`. Foundation for all
subsequent tasks.

### Task 2: Add CLI flag
Add `-s`/`--semi-verbose` flag to `engine/cli.ts` argument parser. When present,
set `verbosity = "semi-verbose"`. Update `printUsage()` help text to document
the new flag. Mutually exclusive with `-v` and `-q` (last-wins or error).

### Task 3: Filter in formatEventForOutput()
Add optional `verbosity?: Verbosity` param to `formatEventForOutput()` in
`engine/agent.ts`. When `verbosity === "semi-verbose"` and event type is
`assistant`: filter `contents` array to exclude `block.type === "tool_use"`,
emit only `text` blocks. Default (undefined) = all blocks (backward-compatible).
Add `verbosity` field to `AgentRunOptions`. In `executeClaudeProcess()`: pass
verbosity to `onOutput` callback path; log file path continues calling without
verbosity (full output preserved).

### Task 4: Update nodeOutput() gate
In `engine/output.ts`, change `nodeOutput()` gate from
`if (this.verbosity !== "verbose") return` to
`if (this.verbosity !== "verbose" && this.verbosity !== "semi-verbose") return`.
No additional filtering needed — tool_use blocks already excluded upstream by
Task 3.

### Task 5: Unit tests
- `engine/agent_test.ts`: Test `formatEventForOutput` with semi-verbose —
  text blocks emitted, tool_use blocks suppressed, default (no verbosity)
  unchanged.
- `engine/output_test.ts`: Test `nodeOutput` shown when `semi-verbose`.
- `engine/cli_test.ts`: Test `-s` flag parses to `semi-verbose`.
