<!-- section file — index: [documents/design-engine.md](../design-engine.md) -->

# SDS Engine — Engine Modules (loop, hitl, human, scope-check, output, dispatch, engine, cli, mod, interfaces, flags)


  - `loop.ts` — loop node execution with condition extraction, per-iteration
    `AgentResult` accumulation into `LoopResult.bodyResults`.
    `buildLoopBodyOrder()` reads from inline `nodes` sub-object (replaces
    `body` array), topo-sorts body nodes by their `inputs` declarations.
    `buildContext()` resolves `inputs` against both sibling body nodes and
    top-level nodes. Accepts `streamLogPath` pattern from engine; computes
    iteration-qualified path `${nodeId}-iter-${i}.jsonl` per body node
    invocation; forwards to inner `runAgent()` calls.
    **Runtime condition_field presence check (FR-E36):**
    `extractConditionValue()` — after search loop completes, if return value
    is `undefined`, throws:
    `Error("Loop '<loopId>': condition_field '<field>' not found in condition
    node '<condId>' output at '<nodeDir>'")`. Requires `loopId` threaded
    through call (closure capture or param addition). Prevents silent undefined
    behavior on missing field — fail-fast at first loop iteration
  - `hitl.ts` — HITL detection (`detectHitlRequest`) and poll loop
    (`runHitlLoop`); injectable `scriptRunner`/runtime runner for testing.
    The engine normalizes runtime-native HITL requests into one
    `HumanInputRequest` shape. Claude uses `permission_denials`; OpenCode uses
    structured `tool_use` events emitted by an injected local MCP tool.
  - `human.ts` — terminal user input, abort logic
  - `scope-check.ts` — scope-based file modification detection (FR-E37).
    Exports:
    - `snapshotModifiedFiles(): Promise<Set<string>>` — runs
      `git diff --name-only HEAD` + `git ls-files --others --exclude-standard`.
      Returns combined set of modified/untracked files relative to repo root.
    - `findViolations(before: Set<string>, after: Set<string>, allowedPaths: string[]): string[]`
      — pure function. Computes `after − before` (new modifications since
      snapshot), filters against `allowedPaths` globs. Returns violation paths
      (empty = no violations). Glob matching via path prefix or pattern.
    Integration: `agent.ts` calls `snapshotModifiedFiles()` before each
    `invokeClaudeCli()` when `node.allowed_paths` exists. After invocation,
    snapshots again, calls `findViolations()`. Violations → synthetic
    `ValidationResult` (type `scope_check`, failed) injected into validation
    results array. Shares `max_continuations` budget with artifact validation.
    Skipped entirely when `allowed_paths` undefined on node (AC #1).
    Pre-existing uncommitted changes excluded by before/after diff (AC #5).
    Sub-second latency for ≤1000 tracked files (AC #6) — git index-based.
  - ~~`git.ts`~~ — **deleted** (FR-E14: domain-specific git code removed from
    engine). Functions relocated to `.flowai-workflow/scripts/rollback-uncommitted.sh`.
    Failure handling replaced by configurable `on_failure_script` hook
  - `output.ts` — terminal output manager (quiet/normal/semi-verbose/verbose),
    verbose methods for detailed agent-node diagnostics.
    `nodeOutput()` gate: shown when `verbosity === "verbose"` or
    `verbosity === "semi-verbose"`. In semi-verbose, tool-call lines already
    excluded upstream by `formatEventForOutput()` — `nodeOutput()` passes
    through whatever it receives.
    `dryRunPlan(levels, labels, postWorkflowNodeIds?, runOnMap?)`: renders
    regular DAG levels, then optional "Post-workflow" section listing `run_on`
    nodes with their conditions (FR-E13).
    `nodeResult(nodeId, output: CliRunOutput)`: multi-line agent result
    display (FR-E15). Guarded by `verbosity !== "quiet"`. Format:
    line 1: `[HH:MM:SS] <nodeId padded>  RESULT:` (header),
    lines 2..N: each non-empty line of `output.result` indented 2 spaces,
    last line: `  cost=$X.XXXX | duration=Xs | turns=N` (footer).
    `extractResultExcerpt()` removed — excerpt logic inlined at state-
    persistence call sites in `engine.ts` and `node-dispatch.ts`.
    `RunSummary.nodeResults?: Record<string, string>` (FR-E22): optional
    per-node result excerpts. `summary()` renders per-node result lines after
    "Nodes:" when `nodeResults` present: `  <nodeId padded>  <excerpt>`.
    Imports `CliRunOutput` from `types.ts`
  - `node-dispatch.ts` — node-type executor dispatch module (FR-E30).
    Exports `EngineContext` interface (parameter bag: `config`, `state`,
    `output`, `options`, `userInput`, `buildContext()`, `saveState()`) and
    4 free functions: `executeAgentNode()` (agent invocation, HITL check,
    log save), `executeMergeNode()` (directory copy), `executeLoopNode()`
    (loop delegation + callbacks), `executeHumanNode()` (terminal prompt),
    plus `copyDir()` utility. Enables `engine.ts` to act as pure orchestrator
    by delegating all node-type-specific logic to this module.
  - `engine.ts` — main orchestrator: config loading, state management,
    level iteration, delegation to `node-dispatch.ts` executors (FR-E30),
    node result summary display (FR-E15/E22),
    phase registry init via `setPhaseRegistry(config)` at engine startup,
    pre-post-workflow `on_failure_script` execution.
    Two-phase config loading (FR-E24): `run()` reads raw YAML →
    `extractPreRun()` → `runPreRunScript()` if present → `loadConfig()`
    re-reads (potentially updated) config.
    **Pipeline Prepare Command (FR-E30):** `runPrepareCommand(cmd, runDir,
    runId, env, args, output): Promise<void>` — exported free function.
    Builds workflow-level `TemplateContext` (`node_dir: ""`, `input: {}`,
    real `run_dir`/`run_id`/`env`/`args`), calls `interpolate()` from
    `template.ts`, executes via `Deno.Command("sh", ["-c", interpolated])`.
    Non-zero exit throws → caught by `run()` → state saved → workflow aborts.
    Call site: `runWithLock()`, after `ensureRunDirs()` + `saveState()`,
    before level loop. Guarded by `!this.options.resume && cmd` (skipped on
    resume — environment already prepared by original run).
    `executeNode()`: passes `extractResultExcerpt(result.output.result)` to
    `markNodeCompleted()` as `result` param (FR-E22).
    `executeLoopNode()`: passes result excerpt in `onNodeComplete` callback.
    `printSummary()`: builds `nodeResults` from `state.nodes[*].result`,
    passes to `summary()` for per-node result rendering.
  - `cli.ts` — CLI entry point with subcommand routing (FR-E45):
    `--internal-opencode-hitl-mcp` → HITL MCP server,
    `run` → `runEngine(args)` (DAG workflow — former default),
    `--version`/`--help` → global handlers,
    bare `--` flags → backward-compat shim (deprecated, delegates to `run`),
    default (no args) → dynamic import `repl/mod.ts` → `launchRepl()`.
    `runEngine()` extracted as named function shared by `run` and compat shim.
    `parseArgs()` unchanged (synchronous).
    `VERSION` constant: `Deno.env.get("VERSION") ?? "dev"`.
  - `repl/mod.ts` — interactive REPL module (FR-E46):
    `resolveRuntime()` — flag → persisted config
    (`~/.config/flowai-workflow/runtime.json`) → terminal prompt.
    `loadBundledSkills()` — `parseSkill()` for each subdir of
    `engine/repl/skills/` (uses `import.meta.url` for compiled binary compat).
    `launchRepl()` — orchestrates: resolve runtime, check `interactive`
    capability, load skills, build system prompt, call
    `adapter.launchInteractive()`. MVP skills: `init`, `adapt-agents`.
  - `repl/skills/init/SKILL.md` — guided project initialization skill
    (replaces removed `flowai-workflow init` subcommand).
  - `repl/skills/adapt-agents/SKILL.md` — agent adaptation after framework
    update.
  - `mod.ts` — barrel re-export serving as `deno doc --lint` entry point
    (not a runtime public API; sole non-redundant consumer is
    `scripts/check.ts` JSDoc validation)
- **Module JSDoc and Why-Comments (FR-E30):** All 6 engine modules require
  module-level `/** @module */` JSDoc (purpose, responsibility, deps) and
  function-level JSDoc on exported functions. 4 complex functions require
  inline `// Why:` comments explaining non-obvious design decisions:
  (1) `runAgent()` in `agent.ts` — continuation/resume semantics with shared
  session_id; (2) `validateNode()` in `config.ts` — recursive validation with
  dual input-ID namespace; (3) `mergeDefaults()` in `config.ts` — 3-tier
  cascade order and legacy normalization; (4) `checkFrontmatterField()` in
  `validate.ts` — regex-over-YAML-parser for partial-document handling.
- **Legacy Test Task Removal (FR-E29):** Verified complete. No `test:*` tasks
  referencing `.flowai-workflow/scripts/stage-*_test.ts` remain in `deno.json`. No "Stage
  Scripts" section in SDS (§3.2 is Phase Registry). No `.flowai-workflow/scripts/stage-*`
  references in this document. Current valid test tasks: `test`, `test:lib`,
  `test:engine`.
- **Test Suite Integrity (FR-E27):** Every `engine/` test function must
  contain ≥1 explicit assertion. `lock_test.ts` "releaseLock — no error if
  lock file already removed" test: `assertEquals(result, undefined)` +
  `Deno.stat` file-absence verification (asserting `NotFound` error).
  Pattern consistent with adjacent test at line 122-138.
- **`scripts/check.ts` CLI help (FR-E23):** `printUsage()` static function
  outputs: description of checks performed, usage line, note about no accepted
  options, example. `--help`/`-h` in `Deno.args` → `printUsage()` +
  `Deno.exit(0)`. Any other arg → error referencing `--help` + `Deno.exit(1)`.
  Follows `engine/cli.ts` format. Exported `printUsage()`/`checkArgs()` for
  unit testing
- **Interfaces:**
  - CLI: `flowai-workflow` (REPL), `flowai-workflow run [--prompt <text>]
    [--config <path>] [--resume <run-id>] [--dry-run] [-v|-s|-q]
    [--env KEY=VAL] [--skip nodes] [--only nodes]`, `--version|-V`, `--help`
  - Config: `.flowai-workflow/workflow.yaml` (YAML, version "1")
  - State: `.flowai-workflow/runs/<run-id>/state.json` (JSON)
- **Node types:** `agent`, `merge`, `loop` (with inline `nodes` sub-object
    for body node definitions), `human`
- **Node flags:**
  - `run_on?: "always" | "success" | "failure"` — execution condition for
    post-workflow nodes. When set, node is excluded from DAG levels and executes
    in a post-workflow step after all DAG levels complete:
    - `"always"` — execute regardless of workflow outcome.
    - `"success"` — execute only if workflow succeeded.
    - `"failure"` — execute only if workflow failed. Skipped nodes get
      `markNodeSkipped()` status.
    Backward compat: `run_always: true` in YAML normalized to `run_on: "always"`
    by config loader (see `config.ts` normalization). `run_always` deleted
    post-normalization — not visible to engine runtime.
  - `phase?: string` — optional phase grouping label (e.g., `plan`, `impl`,
    `report`). When set, node artifacts are stored under
    `<run-dir>/<phase>/<node-id>/` instead of `<run-dir>/<node-id>/`. User-
    defined (no enum constraint). Validated: must be non-empty string if present.
    Backward-compatible: omitting `phase` preserves flat layout.
  - `env?: Record<string, string>` — optional node-level environment variables.
    Merged with global env (node-level overrides global defaults). Accessible
    in template context via `{{env.<key>}}`.
  - `model?: string` — per-node Claude model override (FR-E12, implemented).
    Overrides `defaults.model`. Absent = defaults.model or CLI default (no flag).
    Emitted as `--model <value>` on initial invocations only; `--resume` calls
    exclude `--model` (session inherits original). Resolution chain:
    `node.model ?? defaults.model ?? undefined`. Centralized in
    `buildClaudeArgs()` via `InvokeOptions.model` field.
- **Commit strategy:** Engine does not auto-commit. Developer agent owns commits
  (`git add`, `git commit`, `git push` per task). No dedicated committer nodes.
- **Verbose Output (Direct Injection pattern):**
  - `output.ts` exposes 4 verbose-guarded methods on `OutputManager`:
    `verbosePrompt(nodeId, prompt)`,
    `verboseInputs(nodeId, inputs: {path, sizeBytes}[])`,
    `verboseValidation(nodeId, results: {rule, passed, detail?}[])`,
    `verboseContinuation(nodeId, attempt, max, failures)`.
    `verboseSafety()` and `verboseCommit()` removed (engine no longer performs
    safety checks or commits — FR-E14 domain-agnostic cleanup).
    All no-op when `verbosity !== "verbose"`. Output: human-readable stderr with
    section headers. Note: AC #5 (agent stdout streaming) already implemented
    via existing `nodeOutput()` method — no new work needed.
  - `agent.ts`: `AgentRunOptions` gains optional `output?: OutputManager` and
    `nodeId?: string`. `runAgent()` calls `verbosePrompt()` after prompt
    construction, `verboseValidation()` after each `runValidations()` call,
    `verboseContinuation()` before resume invocation. Guarded by `if (output)`.
  - `loop.ts`: `LoopRunOptions` gains optional `output?: OutputManager`.
    Forwarded to `runAgent()` calls. Enables prompt/validation/continuation
    verbose for loop body nodes. Safety/commit verbose for loop body nodes:
    deferred (loop body bypasses `executeAgentNode()`).
  - `engine.ts`: `executeAgentNode()` resolves input artifact paths+sizes by
    walking `ctx.input` directories via `Deno.stat()`; calls
    `this.output.verboseInputs()` before `runAgent()`. Passes `this.output`
    and `nodeId` to `runAgent()`. Safety check and commit verbose removed
    (engine no longer performs these — FR-E14). `runFailureHook(script?)`:
    private method (~10 lines), executes `on_failure_script` via
    `Deno.Command()` on workflow failure. Swallows errors (failure hook must
    not crash engine). Replaces hard-wired `rollbackUncommitted()`.
  - All existing callers pass no `output` arg — zero behavioral change.
- **Deps:** `claude` CLI, `deno`, `git`, `jsr:@std/yaml`.


