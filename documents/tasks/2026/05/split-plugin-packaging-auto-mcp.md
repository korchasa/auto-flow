---
date: "2026-05-30"
status: done
implements: [FR-E70, FR-E71, FR-E74]
tags: [plugin, mcp, codex, claude-code, packaging]
related_tasks:
  - 2026/05/plugin-first-distribution.md
  - 2026/05/plugin-self-contained-runtime.md
  - 2026/05/ts-launcher.md
---

# Split Plugin Packaging for Auto-MCP Across Claude Code and Codex

## Goal

Restore automatic MCP registration for both Claude Code and Codex by
separating host-specific plugin wiring while keeping the engine,
launcher, skills, agents, and bundled workflows shared.

The desired end state: Claude Code receives a plugin shape that uses
Claude plugin variables such as `CLAUDE_PLUGIN_ROOT`; Codex receives a
Codex-native plugin shape with `.codex-plugin/plugin.json` pointing to
Codex-safe MCP wiring that does not depend on Claude-only environment
substitution.

## Overview

### Context

FR-E70 made the Claude Code / Codex plugin the primary distribution
channel. FR-E74 then added a self-contained runtime and auto-MCP
registration through a plugin-shipped `.mcp.json`. That single MCP file
uses `${CLAUDE_PLUGIN_ROOT}/bin/launch.ts`, which matches Claude Code's
plugin contract but fails in Codex MCP startup: Codex loads plugin MCP
config but does not substitute Claude plugin variables for MCP
subprocess arguments, so the server exits before the MCP `initialize`
handshake.

This task supersedes the assumption that one shared plugin tree can
serve both hosts' MCP wiring. The shared runtime remains one codebase;
the host manifests and MCP config files become explicit per-IDE
packaging surfaces.

### Current State

- `claude-plugin/` is the source tree for the downstream marketplace
  payload.
- The payload has a Claude Code manifest at
  `plugins/flowai-workflow/.claude-plugin/plugin.json`.
- No source-tree Codex manifest exists at
  `plugins/flowai-workflow/.codex-plugin/plugin.json`.
- `scripts/build-plugin-payload.ts` maps `claude-plugin/**` into one
  output tree and does not model separate host payload roots.
- `bin/launch.ts` primarily expects `CLAUDE_PLUGIN_ROOT` and
  `CLAUDE_PLUGIN_DATA`, though it can be made self-locating from
  `import.meta.url`.
- The embedded MCP server itself is host-neutral and remains available
  through `flowai-workflow mcp <workflow>` / `launch.ts mcp`.

### Constraints

- Engine code must stay domain-agnostic; host-specific behavior belongs
  in plugin packaging or launcher boundary code.
- Auto-MCP must work without manual `~/.codex/config.toml` edits for
  Codex plugin users.
- Claude Code must keep its working plugin contract and MCP env
  substitution path.
- Codex MCP wiring must not contain `${CLAUDE_PLUGIN_ROOT}` or require
  Claude Code environment variables.
- Build output must remain deterministic and version-locked to
  `deno.json#version`.
- No prebuilt binaries should be committed to the plugin marketplace.

## Definition of Done

- [x] Shared launcher resolves plugin root without requiring
      `CLAUDE_PLUGIN_ROOT`. Acceptance tuple — FR-E74 + Test:
      `scripts/launch_test.ts::FR-E74 launcher resolves plugin root from import meta without Claude env`;
      Evidence: `deno task test scripts/launch_test.ts`.
- [x] Claude Code payload includes Claude-native MCP wiring using
      `${CLAUDE_PLUGIN_ROOT}/bin/launch.ts`. Acceptance tuple —
      FR-E74 + Test:
      `scripts/build-plugin-payload_test.ts::FR-E74 claude payload includes Claude MCP wiring`;
      Evidence: `deno task test scripts/build-plugin-payload_test.ts`.
- [x] Codex payload includes `.codex-plugin/plugin.json` with an
      `mcpServers` pointer and Codex-safe MCP wiring. Acceptance tuple
      — FR-E71 + FR-E74 + Test:
      `scripts/build-plugin-payload_test.ts::FR-E74 codex payload includes Codex MCP wiring without Claude env`;
      Evidence: `deno task test scripts/build-plugin-payload_test.ts`.
- [x] Build script models host-specific packaging explicitly while
      preserving shared engine, skills, agents, launcher, and workflows.
      Acceptance tuple — FR-E70 + Test:
      `scripts/build-plugin-payload_test.ts::FR-E70 builds separate Claude and Codex plugin payloads from shared sources`;
      Evidence: `deno task test scripts/build-plugin-payload_test.ts`.
- [x] Local plugin sync installs or refreshes both host payloads without
      creating duplicate MCP server-name conflicts. Acceptance tuple —
      FR-E71 + Test:
      `scripts/sync-plugins-local_test.ts::FR-E71 local sync reconciles Codex plugin entries without duplicate MCP servers`;
      Evidence: `deno task test scripts/sync-plugins-local_test.ts`.
- [x] Codex MCP relative path resolution is locked before choosing the
      final Codex `.mcp.json` args. Acceptance tuple — FR-E71 +
      manual — korchasa; Evidence: local Codex plugin smoke transcript
      showing whether `./bin/launch.ts` is resolved from plugin root or
      from project cwd.
- [x] Downstream sync contract publishes discoverable Claude and Codex
      marketplace roots. Acceptance tuple — FR-E70 + Test:
      `scripts/sync-plugins-repo_test.ts::FR-E70 dry-run emits host-specific marketplace roots`;
      Evidence: `deno task test scripts/sync-plugins-repo_test.ts`.
- [x] Duplicate MCP server-name policy is documented and enforced for
      local dogfood installs. Acceptance tuple — FR-E71 + Test:
      `scripts/sync-plugins-local_test.ts::FR-E71 local sync detects official and local MCP name collision`;
      Evidence: `deno task test scripts/sync-plugins-local_test.ts`.
- [x] README and SRS document host-specific auto-MCP packaging and no
      manual Codex MCP config; FR-E71 no longer describes Codex as a
      skill-only payload. Acceptance tuple — FR-E70 + FR-E71 + FR-E74
      + manual — korchasa; Evidence:
      `rg -n "auto-MCP|mcpServers|\\.codex-plugin|skill-only" README.md documents/requirements-engine`.
- [x] Full verification passes. Acceptance tuple — FR-E70 + FR-E71 +
      FR-E74 + Test: `scripts/check.ts::full check pipeline`;
      Evidence: `deno task check`.

## Solution

Selected variant: **separate generated payload roots per IDE**, with a
shared runtime source set copied into each root.

### File and Directory Shape

Create explicit source templates for host-specific wiring and move
shared runtime files out of the Claude-named source root:

- Shared source:
  - `plugin-src/shared/bin/launch.ts`
  - `plugin-src/shared/skills/`
  - `plugin-src/shared/agents/`
  - `plugin-src/shared/README.md`
- Claude-specific source wiring:
  - `plugin-src/claude/.claude-plugin/marketplace.json`
  - `plugin-src/claude/plugins/flowai-workflow/.claude-plugin/plugin.json`
  - `plugin-src/claude/plugins/flowai-workflow/.mcp.json`
- Codex-specific source wiring:
  - `plugin-src/codex/.agents/plugins/marketplace.json`
  - `plugin-src/codex/plugins/flowai-workflow/.codex-plugin/plugin.json`
  - `plugin-src/codex/plugins/flowai-workflow/.mcp.json`

During implementation, remove or retire the old `claude-plugin/`
source root after the new builder reads exclusively from `plugin-src/`.
Do not leave two source-of-truth trees for the same skills or agents.

Generated output:

```text
dist/plugin-payload/
  claude/
    .claude-plugin/marketplace.json
    plugins/flowai-workflow/
      .claude-plugin/plugin.json
      .mcp.json
      bin/
      skills/
      agents/
      engine/
      .flowai-workflow/
  codex/
    .agents/plugins/marketplace.json
    plugins/flowai-workflow/
      .codex-plugin/plugin.json
      .mcp.json
      bin/
      skills/
      agents/
      engine/
      .flowai-workflow/
```

Do not publish one mixed root where both IDEs can discover each
other's MCP config. The published downstream repository may contain
both roots, but install commands and local sync must pass the correct
root to each host.

### Build Script

Refactor `scripts/build-plugin-payload.ts` around two concepts:

- `HostKind = "claude" | "codex"`.
- `classifyPayloadFile(host, relPath)` or equivalent routing that
  separates host wiring from shared runtime files.

Implementation approach:

1. Build a shared file list once from `git ls-files`.
2. For each host, copy shared runtime files into
   `<outDir>/<host>/plugins/flowai-workflow/`.
3. Copy only that host's manifest and MCP config into the same host
   root.
4. Substitute versions in both host manifests from `deno.json#version`.
5. Preserve existing exclusions for tests, `scripts/`, `documents/`,
   per-run dirt, memory snapshots, and `.template.json`.

Expected host-specific MCP config:

Claude Code:

```json
{
  "mcpServers": {
    "flowai-workflow": {
      "command": "deno",
      "args": [
        "run",
        "-A",
        "${CLAUDE_PLUGIN_ROOT}/bin/launch.ts",
        "mcp"
      ],
      "env": {
        "FLOWAI_SUPPRESS_DEPRECATION": "1"
      }
    }
  }
}
```

Codex:

```json
{
  "flowai-workflow": {
    "command": "deno",
    "args": [
      "run",
      "-A",
      "./bin/launch.ts",
      "mcp"
    ],
    "cwd": ".",
    "env": {
      "FLOWAI_SUPPRESS_DEPRECATION": "1"
    }
  }
}
```

The Codex manifest points `mcpServers` at `./.mcp.json`; only
`plugin.json` belongs under `.codex-plugin/`. Do not use
`${CLAUDE_PLUGIN_ROOT}` in any Codex file.

### Launcher

Update `claude-plugin/plugins/flowai-workflow/bin/launch.ts` so it is
self-locating:

- `pluginRoot = Deno.env.get("CLAUDE_PLUGIN_ROOT") ??
  dirname(dirname(fromFileUrl(import.meta.url)))`
- `pluginData = Deno.env.get("CLAUDE_PLUGIN_DATA") ?? codexDataDir()`

`codexDataDir()` should be deterministic and writable:

- prefer `FLOWAI_PLUGIN_DATA` if present;
- otherwise use `${CODEX_HOME}/plugins/data/flowai-workflow` when
  `CODEX_HOME` exists;
- otherwise use `${HOME}/.codex/plugins/data/flowai-workflow`;
- fail clearly if neither `CODEX_HOME` nor `HOME` is available.

Error handling:

- Missing plugin root: fail fast with the resolved `import.meta.url`.
- Missing plugin data directory parent: create it recursively.
- Compile failure: preserve current behavior by exiting with the
  compile process code.
- Missing Deno: surface the original command failure; do not silently
  fall back to `deno run engine/cli.ts`.

### Local Sync

Update `scripts/sync-plugins-local.ts` so each IDE receives the
correct root:

- Claude Code marketplace add path:
  `dist/plugin-payload/claude`.
- Codex marketplace add path:
  `dist/plugin-payload/codex`.

Codex reconciliation must continue preserving existing
`[plugins."<name>@flowai-workflow-local"] enabled = false` flags. It
must not add or rewrite manual `[mcp_servers.*]` entries; plugin
auto-MCP should come from the Codex plugin manifest.

Duplicate MCP server-name handling:

- The official and local installs both declare `flowai-workflow`.
- Local sync should preserve enabled flags and document that users
  should not enable official and local installs simultaneously when
  testing MCP startup.
- If Codex exposes per-plugin MCP enablement in config, prefer
  disabling the older install rather than renaming the MCP server,
  because tool names should stay stable.

### Tests

Add RED tests before implementation:

- `scripts/build-plugin-payload_test.ts::FR-E70 builds separate Claude and Codex plugin payloads from shared sources`
  verifies both roots exist and both contain shared `bin/`, `skills/`,
  `agents/`, `engine/`, and bundled workflows.
- `scripts/build-plugin-payload_test.ts::FR-E74 claude payload includes Claude MCP wiring`
  verifies Claude `.mcp.json` uses `${CLAUDE_PLUGIN_ROOT}`.
- `scripts/build-plugin-payload_test.ts::FR-E74 codex payload includes Codex MCP wiring without Claude env`
  verifies Codex `.codex-plugin/plugin.json` points at its MCP file and
  no Codex output file contains `CLAUDE_PLUGIN_ROOT`.
- `scripts/sync-plugins-repo_test.ts::FR-E70 dry-run emits host-specific marketplace roots`
  verifies dry-run output and downstream copy plan expose both
  `claude/` and `codex/` roots.
- `scripts/launch_test.ts::FR-E74 launcher resolves plugin root from import meta without Claude env`
  runs `launch.ts` from a temp plugin fixture with no
  `CLAUDE_PLUGIN_ROOT`.
- `scripts/sync-plugins-local_test.ts::FR-E71 local sync reconciles Codex plugin entries without duplicate MCP servers`
  covers the local Codex config rewrite plan and preserved enabled
  flags.
- `scripts/sync-plugins-local_test.ts::FR-E71 local sync detects official and local MCP name collision`
  verifies local dogfood setup warns or disables the older duplicate
  instead of silently starting two `flowai-workflow` MCP servers.

### Documentation

Update:

- `README.md`: install instructions list host-specific auto-MCP support;
  no manual Codex MCP block is required for plugin users.
- `claude-plugin/README.md`: explain that the downstream repo contains
  separate Claude and Codex roots.
- `AGENTS.md`: replace "single plugin payload" language with explicit
  host packaging plus shared runtime.
- `documents/requirements-engine/06-distribution-and-housekeeping.md`:
  FR-E70/FR-E71 descriptions reflect Codex-native payload and auto-MCP.
- `documents/requirements-engine/07-mcp-and-plugin-runtime.md`:
  FR-E74 states that MCP auto-registration is host-specific.
- `documents/index.md`: keep FR-E70/FR-E71/FR-E74 rows accurate.

### Verification Commands

Run in this order:

1. `deno task test scripts/build-plugin-payload_test.ts`
2. `deno task test scripts/launch_test.ts`
3. `deno task test scripts/sync-plugins-local_test.ts`
4. `deno task sync-plugins --dry-run --out-dir /private/tmp/flowai-payload-check`
5. `rg -n "CLAUDE_PLUGIN_ROOT" /private/tmp/flowai-payload-check/codex`
   must return no matches.
6. `rg --files /private/tmp/flowai-payload-check/claude /private/tmp/flowai-payload-check/codex`
   should show the two expected host roots.
7. `deno task check`

Manual smoke after local install:

- Claude Code: `deno task sync-plugins-local`, fresh session, `/mcp`
  lists `flowai-workflow`.
- Codex: `deno task sync-plugins-local`, fresh session, MCP startup
  succeeds without a manual `[mcp_servers.flowai-workflow]` block.
