# ADR-0013: HITL via engine-owned MCP server, library is HITL-agnostic

## Status

Accepted

## Context

`flowai-workflow` runs agent CLIs in headless mode. When an agent
needs a human decision mid-task, the engine pauses the run, delivers
the question via a workflow-supplied `ask_script`, polls
`check_script`, and resumes the agent with the reply.

Until library `@korchasa/ai-ide-cli` v0.7.0 the trigger surface was
asymmetric per runtime:

- **Claude** raised HITL via its built-in `AskUserQuestion` tool.
  Engine matched `tool_name === "AskUserQuestion"` against
  `permission_denials` and parsed two distinct input shapes
  (`{questions:[…]}` and flat `{question,…}`).
- **OpenCode / Codex** raised HITL via a stdio MCP server bundled in
  the library (`hitl-mcp.ts`), exposing a single tool
  `request_human_input`. Each adapter normalised the tool-call event
  into `CliRunOutput.hitl_request`.
- **Cursor** had no HITL — Cursor CLI offers no per-invocation MCP
  config flag (per the library's `cursor/AGENTS.md`).

The asymmetry leaked into engine code (Claude-specific
`permission_denials` parser plus an OpenCode/Codex-specific
`output.hitl_request` reader) and into the library/consumer
boundary (consumer-supplied `hitlMcpCommandBuilder` callback,
`hitlConfig` invoke option, `hitl_request` output field, `hitl`
capability flag — all HITL semantics inside a thin CLI wrapper).

In v0.8.0 the library removed the entire HITL layer
(`@korchasa/ai-ide-cli` ADR `2026-05-02-remove-hitl.md`,
alternative D = "remove entirely; push to consumer"). The library
then added a generic per-invocation `mcpServers` option in v0.8.1
(FR-L35, `runtime/mcp-injection.ts`) so consumers can register any
MCP server through a single typed field that each adapter renders
to its native plumbing.

This ADR records how the engine absorbs the HITL stack on top of
those new generic primitives.

## Decision

The engine owns the entire HITL stack. The library stays
HITL-agnostic — it only ships the generic `mcpServers` injection
and the runtime-neutral `onToolUseObserved` hook.

Engine layout:

- **`hitl-mcp-server.ts`** — absorbed stdio JSON-RPC NDJSON server
  (lifted from the deleted library `hitl-mcp.ts`). Exports
  `runFlowaiHitlMcpServer`, `INTERNAL_HITL_MCP_ARG` (CLI dispatch
  flag), `HITL_MCP_SERVER_NAME = "flowai-workflow-hitl"`,
  `HITL_TOOL_NAME = "request_human_input"`,
  `normalizeHumanInputRequest`, `buildHitlMcpServerArgv` (dev-mode
  vs. compiled-binary spawn argv).
- **`hitl-injection.ts`** — pure helpers used by `agent.ts` and
  `hitl.ts`:
  - `buildHitlMcpServers()` returns the `McpServers` record with
    one stdio entry under `flowai-workflow-hitl`.
  - `hitlToolNameFor(runtime)` returns the runtime-prefixed tool
    name the observer matches (`mcp__<srv>__<tool>` for Claude,
    `<srv>_<tool>` for OpenCode, `<srv>.<tool>` for Codex).
  - `createHitlObserver(runtime)` returns
    `{observer, getQuestion, reset}` — closure-based capture of the
    first matching tool call; observer returns `"abort"` on match.
- **`agent.ts::runAgent`** — when `defaults.hitl` is configured AND
  `adapter.capabilities.mcpInjection === true`, builds `mcpServers`
  and a `HitlObserver`, passes both to every `adapter.invoke()`
  call (initial + continuations). Returns
  `AgentResult.hitl_question` populated from `getQuestion()`.
- **`hitl.ts::runHitlLoop`** — gates on `capabilities.mcpInjection`
  (replaces the dropped `capabilities.hitl` flag). Resume call
  re-injects the same `mcpServers` and a fresh observer so a
  resumed session can raise nested HITL.
- **`node-dispatch.ts`** — routes `result.hitl_question` to
  `handleAgentHitl({mode: "detect"})` (replaces the old
  `detectHitlRequest(result.output)` call site).
- **Audit artefact** — `runHitlLoop` appends one Q+A record per
  round to `workPath(ctx.workDir, ctx.node_dir)/hitl.jsonl`
  immediately before the resume invoke (FR-E64).
- **Library pin** — `deno.json#imports`
  `@korchasa/ai-ide-cli@^0.8.1`. The legacy
  `INTERNAL_OPENCODE_HITL_MCP_ARG` dispatch and
  `hitl-mcp-command.ts` are deleted.

## Consequences

- **Positive.** Engine no longer pattern-matches `AskUserQuestion`;
  the Claude-specific branch and both input-shape parsers in the
  former `hitl.ts:detectHitlRequest` are deleted. Cross-runtime
  detection collapses to one observer that matches a per-runtime
  prefix derivation. Library boundary is clean: zero HITL surface
  inside `@korchasa/ai-ide-cli`. Workflow YAML and agent prompts
  remain IDE-agnostic — the agent finds the tool via its runtime
  catalogue under the same MCP server name regardless of runtime.
  Cross-runtime invariant becomes auditable: `hitl_question`
  capture goes through one code path in `hitl-injection.ts`. New
  adapter contributors don't write HITL code; they only need to
  ship `capabilities.mcpInjection === true`.
- **Negative.** ~210 LOC of NDJSON MCP server now lives in the
  engine instead of the library. The CLI binary embeds the server
  and dispatches it via `INTERNAL_HITL_MCP_ARG` (renamed from the
  library's old `INTERNAL_OPENCODE_HITL_MCP_ARG`). Cursor stays
  without HITL — same as before, gap formally pinned to upstream
  Cursor's missing per-invocation `--mcp-config`.
- **Invariants.**
  - `engine/*.ts` MUST NOT pattern-match runtime-native tool names
    except via `hitlToolNameFor(runtime)` in
    `hitl-injection.ts`. Audit (planned): `scripts/check.ts` greps
    engine code for the literal `"AskUserQuestion"` and asserts
    zero matches.
  - `.flowai-workflow/<wf>/agents/*.md` and
    `.flowai-workflow/<wf>/workflow.yaml` MUST NOT mention
    `AskUserQuestion`, `request_human_input`, or any
    runtime-specific HITL tool name. Lint rule planned in
    `scripts/check.ts`.
  - `request_human_input` MCP schema is the cross-runtime contract.
    Schema lives in `hitl-mcp-server.ts::REQUEST_HUMAN_INPUT_TOOL`;
    any breaking change requires an engine major bump.
  - HITL flow gates on `capabilities.mcpInjection` exclusively;
    the legacy `capabilities.hitl` flag was removed in library
    v0.8.0 and MUST NOT be reintroduced.

## Alternatives Considered

- **Keep library-side HITL detection (the path of ADR-0002 in this
  repo).** Rejected — the library's own
  `documents/adr/2026-05-02-remove-hitl.md` chose alternative D
  (remove entirely): "ai-ide-cli is a thin CLI wrapper; HITL is
  workflow-layer policy". Reintroducing HITL into the library
  contradicts its own scope statement.
- **Per-runtime HITL injection in the engine via `extraArgs` /
  `env` on each adapter.** Rejected — ExtraArgsMap (`Record<string,
  string|null>`) cannot represent repeated flags (Codex needs
  multiple `--config mcp_servers.<name>.*` overrides). Pushing
  consumers to work around this in user code re-implements
  argv-assembly the library already owns. Resolved upstream by
  library FR-L35 (`mcpServers` typed field).
- **Agent-side `Bash` tool calling a shell script that delivers
  the question and waits for a reply.** Rejected — Bash tool
  timeout caps wait at ≤10 min in Claude Code (`timeout` parameter
  max 600000 ms), no crash-resume across engine restarts, no
  node-level dashboard visibility, no Q+A audit artefact. The
  user's audit requirement (FR-E64) decisively rules this out.
- **Status quo (Claude `AskUserQuestion` + OpenCode/Codex
  `hitl_request` field, no Cursor support).** Rejected — engine
  carries asymmetric detection paths; library couldn't be cleaned
  up; Cursor would never get HITL even if it shipped
  `--mcp-config`.
