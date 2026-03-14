---
variant: "Variant C: Verbosity-aware formatEventForOutput (middle ground)"
tasks:
  - desc: "Extend Verbosity type with 'semi-verbose'"
    files: ["engine/types.ts"]
  - desc: "Add -s/--semi-verbose CLI flag"
    files: ["engine/cli.ts"]
  - desc: "Gate nodeOutput() for semi-verbose; add CLI flag tests"
    files: ["engine/output.ts", "engine/cli_test.ts"]
  - desc: "Pass verbosity into formatEventForOutput; skip tool_use blocks when semi-verbose"
    files: ["engine/agent.ts"]
  - desc: "Thread verbosity from OutputManager through AgentRunOptions into executeClaudeProcess"
    files: ["engine/agent.ts", "engine/engine.ts", "engine/loop.ts"]
  - desc: "Add unit tests for formatEventForOutput filtering and nodeOutput gating"
    files: ["engine/agent_test.ts", "engine/output_test.ts"]
---

## Justification

**Selected: Variant C** over A (string-prefix filtering) and B (split callbacks).

- **vs Variant A:** A filters formatted strings by `[stream] text:` prefix in
  `OutputManager`. This couples `output.ts` to `agent.ts` output format — a
  fragile contract that breaks silently if format changes. Variant C filters at
  the source (`formatEventForOutput`) where block types are already known,
  eliminating string-parsing fragility.

- **vs Variant B:** B refactors `executeClaudeProcess()` stream processing to
  split into `onText`/`onTool` callbacks. This touches a critical execution path,
  changes function signatures across 3 files, and increases merge conflict
  surface — all for a feature that only needs to suppress tool blocks. Over-
  engineered for the requirement.

- **Vision alignment (AGENTS.md):** "Observability: 3 verbosity levels" —
  extending to 4 is a natural evolution. "Engine is domain-agnostic" — Variant C
  keeps the change within engine's generic output subsystem without introducing
  domain-specific logic. Effort S, minimal blast radius.

- **Technical fit:** `formatEventForOutput()` already inspects `content[].type`
  to distinguish `text` vs `tool_use` blocks. Adding a verbosity parameter to
  skip `tool_use` is a natural extension of existing logic — no new abstractions,
  no string parsing, no callback refactoring.

## Task Descriptions

1. **Extend Verbosity type:** Add `"semi-verbose"` to the `Verbosity` union in
   `engine/types.ts:172`. No other type changes needed.

2. **Add CLI flag:** Add `-s`/`--semi-verbose` flag in `engine/cli.ts` argument
   parsing (near existing `-v`/`-q` flags). Sets `verbosity = "semi-verbose"`.
   Update `printUsage()` help text.

3. **Gate nodeOutput + CLI tests:** In `engine/output.ts`, change `nodeOutput()`
   guard from `verbosity !== "verbose"` to allow both `"verbose"` and
   `"semi-verbose"`. Add CLI flag parsing tests in `engine/cli_test.ts` to
   verify `-s` and `--semi-verbose` set correct verbosity.

4. **Verbosity-aware formatting:** Add optional `verbosity?: Verbosity` param to
   `formatEventForOutput()` in `engine/agent.ts`. When
   `verbosity === "semi-verbose"`, skip `tool_use` content blocks in `assistant`
   events — only emit `text` blocks. Default `undefined` = emit all (backward-
   compatible). Log file writes continue to call without verbosity param (full
   output preserved in logs).

5. **Thread verbosity:** Pass verbosity from `OutputManager` through
   `AgentRunOptions` into `executeClaudeProcess()` for the `onOutput` callback
   path. In `engine/engine.ts`, pass `output.verbosity` into `runAgent()`. In
   `engine/loop.ts`, forward verbosity to inner `runAgent()` calls. Only affects
   the terminal output path — log file writes remain unfiltered.

6. **Unit tests:** Test `formatEventForOutput` with `semi-verbose` verbosity
   (text blocks pass, tool_use blocks suppressed). Test `nodeOutput` gating
   (shown for verbose+semi-verbose, hidden for normal+quiet). Verify backward
   compatibility (no verbosity param = all blocks emitted).
