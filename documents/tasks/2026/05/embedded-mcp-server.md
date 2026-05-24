---
date: "2026-05-24"
status: done
implements: [FR-E73]
tags: [engine, mcp, host-embedding, distribution]
related_tasks:
  - 2026/05/hitl-via-engine-mcp.md
  - 2026/05/phase-registry-per-run.md
  - 2026/05/signal-handler-boundary.md
---

## Goal

Expose the engine as a Model Context Protocol (MCP) server with seven tools
so any MCP-capable agent (Claude Code, Codex, Cursor) can inspect workflows,
tail artifacts, and drive runs without spawning a CLI subprocess. Aligns
with FR-E59/E60/E61 host-embedding direction and unblocks idea #3 in
`documents/ideas.md` (highest benefit-to-cost item in the shortlist).

## Overview

### Context

Issue #221 requested an embedded MCP surface. The first SDLC attempt
(PR #233, draft) selected Variant B (`npm:@modelcontextprotocol/sdk`) but
failed during the `decision` workflow node: it (a) committed SDS prose that
pushed `documents/design-engine/04-data-and-logic.md` past the 29920-byte
token budget enforced by `scripts/check.ts::docsTokenBudget()` and
(b) never ran the implementation/build/verify nodes. The draft PR is to be
discarded; this task supersedes it and rebuilds the work under a fresh FR
number because `FR-E70` was reassigned to plugin-first distribution
(`d98435d feat(engine+sdlc): plugin-first distribution`). The new FR is
`FR-E73` (next free after FR-E72).

### Current State

- One in-tree MCP server exists: `hitl-mcp-server.ts` (hand-rolled NDJSON
  JSON-RPC, single tool `request_human_input`, dispatched in `cli.ts` via
  `INTERNAL_HITL_MCP_ARG`). It is the contract surface for HITL; it is NOT
  reused here — the seven engine-control tools live in a separate module.
- The engine APIs the seven tools need are already public and stable:
  `loadConfig` (`config.ts`), `replayRunJournal`/`loadStateFromJournal`
  (`run-journal.ts`), `getRunDir`/`getNodeDir` (`state.ts`),
  `readLockInfo`/`defaultLockPath` (`lock.ts`), `new Engine(opts).run()`
  (`engine.ts`). All are re-exported from `mod.ts`.
- `cli.ts` already supports subcommand dispatch (`run`, `init`) plus the
  internal HITL flag — adding `mcp` is one more `if (subcommand === "mcp")`
  branch, no parser changes required.
- `npm:@modelcontextprotocol/sdk` is NOT yet in `deno.json#imports`. Deno's
  npm compat layer supports it; compile compatibility under `deno compile`
  must be re-verified before any further work (blocking gate).
- `documents/design-engine/04-data-and-logic.md` is 29772 / 29920 bytes
  (≈99 % of budget). It CANNOT absorb the MCP §5 algorithm. A new section
  file is mandatory.

### Constraints

- **Engine remains domain-agnostic** (AGENTS.md "Engine is domain-agnostic"):
  the MCP server exposes generic workflow primitives only; no
  git/GitHub/PR awareness in `mcp-server.ts`.
- **No new OS signal handlers inside the server** (FR-E61): the `mcp`
  subcommand calls `installSignalHandlers()` once at entry (mirroring
  `runEngine`), then `runMcpServer` itself never touches signals.
- **Per-run `PhaseRegistry`** (FR-E59): `resume_node` constructs a fresh
  `Engine` instance per call; no module-level state shared across tools.
- **Sequential `Engine.run()`** (FR-E60): concurrent `resume_node` calls
  for the same `run_id` are rejected via the existing per-workflow run
  lock (`defaultLockPath(workflowDir)` + `acquireLock`) — the tool does
  NOT add a second lock layer.
- **Plugin-first distribution stays intact** (FR-E70): the `mcp`
  subcommand must run cleanly under
  `FLOWAI_SUPPRESS_DEPRECATION=1 deno run -A "$CLAUDE_PLUGIN_ROOT/engine/cli.ts" mcp <workflow>`
  so plugin-installed users can wire the server with no extra flags.
- **Doc budget** (`scripts/check.ts::docsTokenBudget`): no SDS section
  file may exceed 29920 bytes. SDS prose for FR-E73 goes into a new
  `documents/design-engine/05-mcp-server.md` (NOT into 04-data-and-logic).

## Definition of Done

- [x] **FR-E73 §3.73 added to SRS.** `documents/requirements-engine/06-distribution-and-housekeeping.md` carries a new section `### 3.73 FR-E73: Embedded MCP Server Over Engine` with **Description**, **Motivation**, **Acceptance**, and a `**Tasks:**` back-pointer to this file. Index file `documents/requirements-engine.md` lists FR-E73. Evidence: `grep -n "FR-E73" documents/requirements-engine.md documents/requirements-engine/06-distribution-and-housekeeping.md`. Acceptance tuple — Test: `scripts/check_test.ts::docsTokenBudget keeps every SRS section under budget` (regression-locked) + manual — korchasa (SRS prose review).
- [x] **SDS §5 algorithm captured in a new section file.** `documents/design-engine/05-mcp-server.md` exists with: server bootstrap, seven tool handlers, transport selection, error mapping. `documents/design-engine.md` index lists section 05. The two carry-over edits from PR #233 in `02-engine-modules-flow.md` (module-list entry + CLI subcommand row + `mod.ts` re-export note + deps line) are reapplied; `04-data-and-logic.md` is NOT touched. Evidence: `deno task check` (incl. token-budget) passes. Acceptance tuple — Test: `scripts/check_test.ts::docsTokenBudget` (regression-locked) + manual — korchasa (SDS prose review).
- [x] **`npm:@modelcontextprotocol/sdk` added to `deno.json#imports`.** Pinned to a specific minor; `deno cache deno.lock` succeeds; `deno compile -A --target x86_64-unknown-linux-gnu --output /tmp/fw cli.ts` completes without "Unsupported npm package" errors. Evidence: `deno task compile` exit 0 on at least one target. Acceptance tuple — FR-E73 + Test: `mcp-server_test.ts::sdk_imports_at_module_load` (asserts `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"` resolves) + Evidence: `deno task test -- mcp-server_test`.
- [x] **`mcp-server.ts` exports `runMcpServer(workflowDir, transport?)`.** Default transport is `StdioServerTransport`. Seven tools registered via `server.tool(name, schema, handler)`: `get_workflow`, `get_state`, `list_runs`, `tail_artifacts`, `resume_node`, `cancel_run`, `apply_workflow_patch`. Every handler returns `{ content: [{ type: "text", text: <json> }] }` on success and `{ isError: true, content: [...] }` on failure. No `console.log` to stdout in the server (would corrupt the transport stream); diagnostic output goes to `console.error`. Acceptance tuple — FR-E73 + Test: `mcp-server_test.ts::all_seven_tools_registered_with_expected_schemas` + Evidence: `deno task test -- mcp-server_test`.
- [x] **Per-tool behavioral tests.** `mcp-server_test.ts` covers each of the seven tools through an `InMemoryTransport` pair (no subprocess, no stdio). Every test name starts with `FR-E73 ` per `documents/CLAUDE.md` test-naming obligation. Fixtures: a temp workflow directory with `workflow.yaml`, one completed run (`journal.jsonl`) and one running run (with a stale lock pointing at a sleep PID owned by the test). Cases: happy path per tool; `tail_artifacts` with `lines` smaller than file size returns the trailing N; `cancel_run` rejects when `lockInfo.run_id !== run_id`; `cancel_run` swallows `Deno.errors.NotFound`/ESRCH on `Deno.kill` (stale-lock fast path); `apply_workflow_patch` rejects an operation that would remove `version`; `resume_node` returns the final `RunState.status`. Acceptance tuple — FR-E73 + Test: `mcp-server_test.ts::*` (≥8 tests, all `FR-E73 …`-prefixed) + Evidence: `deno task test -- mcp-server_test`.
- [x] **`mcp` subcommand dispatched from `cli.ts`.** Branch added inside the `if (import.meta.main)` block after the `init` branch: `if (subcommand === "mcp") { const { runMcpServer } = await import("./mcp-server.ts"); await runMcpServer(...); }`. The workflow path is parsed identically to `run` (mandatory positional → `<workflow>/workflow.yaml` resolution via the existing `arg.replace(/\/+$/, "")` rule; reuse a small extracted helper). Help text in `printUsage()` lists the new subcommand under `Subcommands`. Acceptance tuple — FR-E73 + Test: `cli_test.ts::mcp_subcommand_resolves_workflow_path` (parses `mcp <workflow>` argv and asserts the resolved config path matches `run <workflow>`) + Evidence: `deno task test -- cli_test`.
- [x] **`mod.ts` STATICALLY re-exports `runMcpServer`.** Added to the barrel as `export { runMcpServer } from "./mcp-server.ts"` (static, NOT dynamic — `deno publish` slow-types analysis must reach the symbol). `deno publish --dry-run` passes (no `no-slow-types` regression). Evidence: `deno publish --dry-run` exit 0. Acceptance tuple — FR-E73 + Test: `mod_test.ts::FR-E73 mod reexports runMcpServer` (new file; smoke: `import { runMcpServer } from "./mod.ts"; assert(typeof runMcpServer === "function")`) + Evidence: `deno task test -- mod_test`.
- [x] **README documents the `mcp` subcommand.** New section "Embedded MCP Server" under usage, listing each tool with its JSON-Schema input/output and one example wiring snippet for Claude Desktop's `mcpServers` config block. Evidence: `grep -c "## Embedded MCP Server" README.md` returns 1. Acceptance tuple — FR-E73 + manual — korchasa (README prose review).
- [x] **`documents/index.md` updated.** Row for FR-E73 added under `## FR`, sorted alphabetically among other FR-E entries, linking to the SRS anchor. Evidence: `grep -n "FR-E73" documents/index.md`. Acceptance tuple — FR-E73 + manual — korchasa (index audit, also enforced by FR-DOC-INDEX in the next docs-audit run).
- [x] **CI baseline green.** `deno task check` (fmt + lint + tests + token budget) passes locally and in CI before merge. Plugin payload sync (`deno task sync-plugins -- --dry-run`) shows `mcp-server.ts` included under `plugins/flowai-workflow/engine/` and the version bumped. Evidence: CI run on PR is green; local `deno task sync-plugins -- --dry-run` exits 0.

## Solution

### Step 1 — Pre-flight: SDK + `deno compile` compatibility gate

**File:** `deno.json` (edit `imports`)

Add:

```jsonc
"@modelcontextprotocol/sdk": "npm:@modelcontextprotocol/sdk@^1.0"
```

Pin to the latest stable `1.x` minor. Run, in order:

1. `deno cache --reload deno.lock` — re-resolve the lockfile.
2. `deno task compile` — drive all four targets. If any target fails with
   "Unsupported npm package" or a native-binding error, STOP and surface
   to user — fallback is hand-roll JSON-RPC (rejected variant B′ in the
   earlier analysis), and we'd want explicit re-approval before reverting.

This is a TRUE prerequisite; do not write any other file until this step
is green. RED here aborts the task.

### Step 2 — RED tests for `mcp-server.ts`

**File:** `mcp-server_test.ts` (new)

Write the tests first per AGENTS.md TDD §1 RED. They will fail to compile
(no module yet) — that's the RED state. Test outline:

```ts
// NB: SDK sub-paths shift between minors. Before writing tests, run
// `deno doc npm:@modelcontextprotocol/sdk@<pinned-version>` (or read
// the package's `exports` field) and confirm the actual export paths
// for `Client`, `McpServer`, and the in-memory transport. The names
// below are sketches.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runMcpServer } from "./mcp-server.ts";

Deno.test("FR-E73 mcp-server registers all seven tools with expected names", async () => {
  const { workflowDir } = await setupFixtureWorkflow();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const serverPromise = runMcpServer(workflowDir, { transport: serverTransport });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  assertEquals(names, [
    "apply_workflow_patch", "cancel_run", "get_state", "get_workflow",
    "list_runs", "resume_node", "tail_artifacts",
  ]);
  await client.close();
  await serverPromise;
});

Deno.test("FR-E73 get_workflow returns the parsed config JSON", …);
Deno.test("FR-E73 get_state replays journal for given run_id", …);
Deno.test("FR-E73 list_runs returns one entry per run subdirectory", …);
Deno.test("FR-E73 tail_artifacts honours `lines` parameter", …);
Deno.test("FR-E73 resume_node returns final RunState.status", …);
Deno.test("FR-E73 cancel_run rejects mismatched run_id", …);
Deno.test("FR-E73 cancel_run treats ESRCH/NotFound on Deno.kill as success", …);
Deno.test("FR-E73 apply_workflow_patch validates op before write", …);
```

Helper `setupFixtureWorkflow()` builds a temp workflow folder with one
completed and one running fixture run; same pattern as
`lifecycle-replay_test.ts`. Each test uses
`InMemoryTransport.createLinkedPair()` per the SDK docs — no subprocess.

### Step 3 — GREEN: `mcp-server.ts`

**File:** `mcp-server.ts` (new)

Module skeleton:

```ts
/**
 * @module
 * Embedded MCP server exposing seven engine-control tools over a generic
 * transport (default stdio). Built on `@modelcontextprotocol/sdk`. The
 * server is transport-agnostic — the `mcp` CLI subcommand wires
 * `StdioServerTransport`; future HTTP/SSE consumers swap the transport
 * with zero changes to tool handlers (FR-E73).
 */

// All MCP SDK imports MUST resolve through the single
// `@modelcontextprotocol/sdk` specifier pinned in deno.json. Reuse the
// `z` re-export from the SDK (server.tool() accepts the SDK's bundled
// zod shape) to avoid two zod resolutions producing `unknown` at the
// schema boundary.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "@modelcontextprotocol/sdk/server/mcp.js"; // SDK-bundled zod
import { join } from "@std/path";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

import { loadConfig } from "./config.ts";
import { Engine } from "./engine.ts";
import { defaultLockPath, readLockInfo } from "./lock.ts";
import { replayRunJournal } from "./run-journal.ts";
import { getNodeDir, getRunDir } from "./state.ts";
import { VERSION } from "./cli.ts";

export interface RunMcpServerOptions {
  /** Transport to attach. Defaults to `StdioServerTransport`. */
  transport?: Transport;
}

export async function runMcpServer(
  workflowDir: string,
  options: RunMcpServerOptions = {},
): Promise<void> {
  const server = new McpServer({ name: "flowai-workflow", version: VERSION });
  registerGetWorkflow(server, workflowDir);
  registerGetState(server, workflowDir);
  registerListRuns(server, workflowDir);
  registerTailArtifacts(server, workflowDir);
  registerResumeNode(server, workflowDir);
  registerCancelRun(server, workflowDir);
  registerApplyWorkflowPatch(server, workflowDir);
  const transport = options.transport ?? new StdioServerTransport();
  await server.connect(transport);
  // For stdio: connect resolves immediately; server keeps running while the
  // transport's underlying stream is open. The function returns when the
  // transport closes (stdin EOF).
  await new Promise<void>((resolve) => transport.onclose = resolve);
}
```

Each `registerX` helper is ~15–30 lines. Sketches:

- **`get_workflow`** — schema `{}`. Handler: `await loadConfig(join(workflowDir, "workflow.yaml"))` → return `{ content: [{ type: "text", text: JSON.stringify(cfg) }] }`.
- **`get_state`** — schema `{ run_id: z.string() }`. Handler: `replayRunJournal(getRunDir(run_id, workflowDir))` → return `state` as JSON.
- **`list_runs`** — schema `{}`. Walk `Deno.readDir(join(workflowDir, "runs"))`, skip non-directories and `.lock`. Per run: `replayRunJournal`, project to `{ run_id, status, total_cost_usd, node_count: Object.keys(state.nodes).length }`. Wrap any per-run error as `{ run_id, error: msg }` rather than abort the whole call (so a single broken journal does not break listing).
- **`tail_artifacts`** — schema `{ run_id, node_id, filename, lines: z.number().int().positive().default(50) }`. Path: `join(getNodeDir(run_id, node_id, workflowDir), filename)`. Read → split on `\n` → take last `lines`.
- **`resume_node`** — schema `{ run_id: z.string() }`. Handler: construct `new Engine({ config_path: join(workflowDir, "workflow.yaml"), run_id, resume: true, args: {}, env_overrides: {}, verbosity: "quiet", dry_run: false })`, `await engine.run()`. Return final `state.status`. **Behaviour note (also in README):** this tool blocks the MCP request for the entire engine run, which may take minutes. Interactive clients (Claude Desktop) tolerate this; clients with sub-second timeouts will need to set higher per-call timeouts or wait for a non-blocking variant (deferred follow-up).
- **`cancel_run`** — schema `{ run_id: z.string() }`. `readLockInfo(defaultLockPath(workflowDir))` → if `info.run_id !== run_id` → return error `"no matching active run"`. Else `Deno.kill(info.pid, "SIGTERM")` wrapped in try/catch. Treat `Deno.errors.NotFound` and `ESRCH` (process gone since lock read) as a successful no-op result — the race "read lock, holder releases, kill misses" is benign. Other errors propagate.
- **`apply_workflow_patch`** — schema `{ operations: z.array(z.object({ op: z.enum(["add","replace","remove"]), path: z.string(), value: z.unknown().optional() })) }`. Read YAML → parse to object → apply each op via a small in-house JSON-Pointer walker (RFC 6901, ~30 lines — full JSON Patch RFC 6902 is overkill; we accept add/replace/remove which is what idea #3 calls for). Reject any op that targets the root `/` or the `version` key (workflow schema invariants). Re-stringify YAML → write back. **Caveat (also in README):** `@std/yaml` round-trips YAML without preserving comments or original quoting/indentation. Hand-edited `workflow.yaml` may be reformatted on first patch.

**Why a small JSON-Pointer walker instead of a library:** AGENTS.md
"Three similar lines is better than a premature abstraction." We need
add/replace/remove against a YAML-loaded object. A 30-line walker is
clearer and lighter than pulling `npm:fast-json-patch` (which would also
re-trigger the `deno compile` gate).

### Step 4 — Wire `mcp` subcommand

**File:** `cli.ts` (edit)

Hoist `installSignalHandlers()` to the top of `if (import.meta.main)` so
all subcommands share a single install call (idempotent, but cleaner than
sprinkling per-branch installs). Drop the duplicate install inside
`runEngine`.

Then, inside `if (import.meta.main)`, after the `init` branch and before
the backward-compat bare-flag shim:

```ts
if (subcommand === "mcp") {
  const positional = Deno.args[1];
  if (!positional) {
    console.error("Error: missing workflow argument. Usage: flowai-workflow mcp <workflow>");
    Deno.exit(1);
  }
  const workflowDir = positional.replace(/\/+$/, "");
  const { runMcpServer } = await import("./mcp-server.ts");
  await runMcpServer(workflowDir);
  Deno.exit(0);
}
```

Update `printUsage()` `Subcommands` block:

```
  mcp <workflow>        Start embedded MCP server (FR-E73) exposing 7 tools over stdio
```

Add a one-liner under `Examples:`:

```
  flowai-workflow mcp .flowai-workflow/github-inbox
```

**Why dynamic `import()` in `cli.ts` is OK:** `mod.ts` already statically
re-exports `runMcpServer` so `deno publish` slow-types analysis reaches
the SDK-typed surface. The dynamic import inside `cli.ts` is purely a
cold-start cost optimisation for the `run` path; it does NOT hide the
symbol from JSR's type-checker.

### Step 5 — `mod.ts` barrel re-export

**File:** `mod.ts` (edit)

```ts
export { runMcpServer } from "./mcp-server.ts";
export type { RunMcpServerOptions } from "./mcp-server.ts";
```

Run `deno publish --dry-run` to confirm no `no-slow-types` regression
(SDK types should be opaque from `RunMcpServerOptions`'s perspective —
the public surface is `(workflowDir, { transport? })`; if SDK leaks slow
types via `Transport`, type-alias to `unknown` at the boundary).

### Step 6 — SRS section §3.73 (FR-E73)

**File:** `documents/requirements-engine/06-distribution-and-housekeeping.md`
(edit — append at end)

```md
### 3.73 FR-E73: Embedded MCP Server Over Engine

- **Description:** The engine exposes an embedded MCP server with seven
  tools (`get_workflow`, `get_state`, `list_runs`, `tail_artifacts`,
  `resume_node`, `cancel_run`, `apply_workflow_patch`) accessible via the
  `flowai-workflow mcp <workflow>` subcommand. Built on
  `@modelcontextprotocol/sdk`; default transport is stdio. The server is
  domain-agnostic — every tool operates on generic workflow primitives
  (config, run state, artifacts, lock) and contains no git, GitHub, or
  PR awareness.
- **Motivation:** Unlocks agent-driven engine control without spawning a
  CLI subprocess (idea #3, top-priority shortlist). Aligns with
  FR-E59/E60/E61 host-embedding direction.
- **Tasks:** [embedded-mcp-server](tasks/2026/05/embedded-mcp-server.md)
- **Acceptance:**
  - [ ] `flowai-workflow mcp <workflow>` starts a server that advertises
    exactly the seven tools above via `tools/list`.
  - [ ] Integration test: a `Client` over `InMemoryTransport` lists
    runs, tails an artifact, and resumes a node end-to-end.
  - [ ] `cancel_run` rejects when `lockInfo.run_id !== run_id`.
  - [ ] `apply_workflow_patch` validates ops before write and rejects
    invariant-breaking patches (root replace, version removal).
  - **Tests:** `mcp-server_test.ts` (regression-locked).
```

Then add `FR-E73` to the index file
`documents/requirements-engine.md` under §3 in numeric order.

### Step 7 — SDS §5 algorithm in a new section file

**File:** `documents/design-engine/05-mcp-server.md` (new)

Carries the prose from PR #233's §5 algorithm verbatim with
FR-E70 → FR-E73 substitution. Add a `<!-- section file — index:
[documents/design-engine.md](../design-engine.md) -->` HTML comment header
matching siblings.

**File:** `documents/design-engine.md` (edit) — list section 05 in the
`## Sections` block.

**File:** `documents/design-engine/02-engine-modules-flow.md` (edit) — reapply
the four PR-#233 hunks (module-list entry for `mcp-server.ts`, `cli.ts`
subcommand row, `mod.ts` re-export line, deps line) but with the FR
renumbered to FR-E73 and the §5 cross-reference pointing at
`05-mcp-server.md`. Do NOT touch `04-data-and-logic.md`.

Verify size after edit:
`wc -c documents/design-engine/02-engine-modules-flow.md documents/design-engine/05-mcp-server.md`
— each must stay under 29920 bytes (`deno task check` enforces this).

### Step 8 — Documentation index update

**File:** `documents/index.md` (edit)

Add one row under `## FR` in alphabetical order:

```
- [FR-E73](requirements-engine/06-distribution-and-housekeeping.md#373-fr-e73-embedded-mcp-server-over-engine) — Embedded MCP server over engine (7 tools, MCP SDK) — [ ]
```

### Step 9 — README

**File:** `README.md` (edit)

Add a top-level section "Embedded MCP Server" between Usage and
Distribution. Include:

1. List of the seven tools with input schema (one line each).
2. Two wiring snippets — binary form (standalone install) and
   plugin form (`deno run … cli.ts`) — because plugin-installed users
   do not see the `flowai-workflow` PATH symbol:

```jsonc
// Standalone binary / JSR install
{
  "mcpServers": {
    "flowai-workflow": {
      "command": "flowai-workflow",
      "args": ["mcp", ".flowai-workflow/github-inbox"]
    }
  }
}

// Claude Code plugin install (no PATH binary)
{
  "mcpServers": {
    "flowai-workflow": {
      "command": "deno",
      "args": [
        "run", "-A", "--no-check",
        "${CLAUDE_PLUGIN_ROOT}/engine/cli.ts",
        "mcp", ".flowai-workflow/github-inbox"
      ],
      "env": { "FLOWAI_SUPPRESS_DEPRECATION": "1" }
    }
  }
}
```

3. Two behavioural caveats spelled out in prose:
   - `resume_node` blocks the MCP request for the whole engine run.
   - `apply_workflow_patch` reformats YAML on write (comments lost,
     quoting may normalise).

### Step 10 — Verification

Run in order:

1. `wc -c documents/design-engine/*.md documents/requirements-engine/*.md`
   — every section file MUST be under 29920 bytes (token budget). Spot-check
   `02-engine-modules-flow.md`, `05-mcp-server.md`,
   `06-distribution-and-housekeeping.md` after Steps 6 and 7.
2. `deno task check` — fmt + lint + tests + token budget + FR-test-name
   anchors.
3. `deno task test -- mcp-server_test cli_test mod_test` — focused replay.
4. `deno publish --dry-run` — JSR slow-types coverage on the new export
   (confirms the static `runMcpServer` re-export in `mod.ts` is reachable).
5. `deno task compile` — confirm SDK survives `deno compile` on all four
   targets (covered in Step 1 but rerun against final tree).
6. `deno task sync-plugins -- --dry-run` — confirm payload includes
   `mcp-server.ts` and reports version bump.
7. Manual smoke: `flowai-workflow mcp .flowai-workflow/github-inbox` →
   in another terminal, `npx @modelcontextprotocol/inspector` (or
   Claude Desktop wiring) → list tools, call `list_runs`, call
   `tail_artifacts` against a known artifact.

### Error-handling strategy

Every tool handler is wrapped in a single `try { … } catch (err) {
return { isError: true, content: [{ type: "text", text:
(err as Error).message }] }; }`. Errors surface to the client as MCP
tool errors, not as transport errors — the server keeps running.
Exception: the `runMcpServer` outer scope re-throws transport-level
errors (e.g., stdio closed mid-write) so the CLI exit code reflects
the failure.

### Files to create/modify

- **New**
  - `mcp-server.ts` (≈280 lines incl. JSON-Pointer walker)
  - `mcp-server_test.ts` (≈220 lines, 8+ tests, `setupFixtureWorkflow`
    helper)
  - `documents/design-engine/05-mcp-server.md` (≈100 lines)
- **Modify**
  - `deno.json` — add SDK import (1 line)
  - `cli.ts` — `mcp` subcommand branch + usage text + example (≈15 lines)
  - `mod.ts` — re-export `runMcpServer` (2 lines)
  - `mod_test.ts` (or add to `mod_test.ts` if it exists; otherwise extend
    existing barrel-coverage test in `dogfood_layout_test.ts` is wrong
    surface — create `mod_test.ts` if missing)
  - `documents/requirements-engine/06-distribution-and-housekeeping.md`
    — add §3.73
  - `documents/requirements-engine.md` — index entry
  - `documents/design-engine.md` — index entry
  - `documents/design-engine/02-engine-modules-flow.md` — module list,
    CLI row, mod.ts row, deps row (≈10 lines)
  - `documents/index.md` — FR-E73 row
  - `README.md` — Embedded MCP Server section

### Out of scope (deferred follow-ups)

- HTTP/SSE transport — server is transport-agnostic; adding a new
  transport is a one-line `runMcpServer({ transport: new HttpTransport(...) })`
  change, but the HTTP transport itself is a separate FR.
- Migrating `hitl-mcp-server.ts` to the SDK. Hand-rolled NDJSON works,
  and unifying is a follow-up cleanup once the SDK proves itself for
  FR-E73's seven-tool surface.
- Library-first factory API (`createMcpServer()` returning a configured
  server instance for embedded hosts) — `runMcpServer` is sufficient
  until a second consumer appears.
- Authentication / authorization on the MCP surface — stdio is local-only
  by definition; HTTP would require its own FR with an auth scheme.

## Follow-ups

- Track HTTP/SSE transport, `hitl-mcp-server.ts` migration, and
  `createMcpServer()` factory as separate ideas in
  `documents/ideas.md` once FR-E73 ships.
- `list_runs` performs an O(n) FS walk with per-run journal replay on
  every call. Fine for current scale (≤100 runs); revisit with a
  cached run-index if workflows accumulate hundreds of runs.
- Non-blocking `resume_node` variant: emit a run-id immediately, let
  the client poll `get_state` for completion. Needs an MCP notification
  channel or a side `started_run` resource; deferred until a concrete
  consumer asks for it.
