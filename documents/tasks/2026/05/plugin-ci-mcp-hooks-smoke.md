---
date: "2026-05-30"
status: done
implements: [FR-E71, FR-E72, FR-E74]
tags: [plugin, ci, mcp, hooks, codex, claude-code]
related_tasks:
  - 2026/05/split-plugin-packaging-auto-mcp.md
  - 2026/05/plugin-self-contained-runtime.md
  - 2026/05/ts-launcher.md
  - 2026/05/local-plugin-install-script.md
---

# Plugin CI Smoke for MCP and Hooks

## Goal

Add automated CI verification that the official Claude Code / Codex
plugin payload is install-shape-correct and that bundled MCP servers
and hook definitions are runnable after packaging.

The target guarantee is precise: CI must prove that generated payload
metadata points at the expected MCP and hook files, that the MCP server
completes a real stdio `initialize` + `tools/list` probe, and that
hook command payloads are syntactically valid and directly executable
with host-provided plugin environment variables. CI must not claim that
Codex has trusted plugin hooks for a real user session, because Codex
requires user review before plugin-bundled hooks are trusted.

## Overview

### Context

FR-E72 publishes the generated plugin payload to
`korchasa/flowai-workflow-plugins`. FR-E74 makes the payload
self-contained by shipping `plugin-src/shared/bin/launch.ts` and
host-specific MCP config. FR-E71 covers the Codex install path, where
Codex loads `.codex-plugin/plugin.json` and plugin-root `.mcp.json`
without a manual `~/.codex/config.toml` MCP block.

Official Codex plugin docs state that `mcpServers` points to an
`.mcp.json` file containing either a direct server map or a wrapped
`mcp_servers` object. The same docs state that plugin hooks may live at
`hooks/hooks.json`, but installing or enabling a plugin does not
automatically trust bundled hooks; the user must review and trust the
current hook definition. Claude Code plugin docs use `hooks/hooks.json`
for plugin hooks, and Claude hook docs define command hook exit-code
semantics.

Therefore the CI target is not "prove a real user's hooks are trusted".
The target is "prove the shipped payload is discoverable, runnable, and
correctly wired; document the trust boundary explicitly".

### Current State

- `scripts/build-plugin-payload_test.ts` verifies host-specific
  payload shape and the Codex `.mcp.json` location.
- `scripts/launch_test.ts` verifies launcher behavior and no-workflow
  MCP startup path.
- `.github/workflows/sync-plugins.yml` publishes the payload to the
  downstream repo, then runs a stale smoke command against
  `$TMP_DIR/plugins/flowai-workflow/engine/cli.ts`; after the split
  layout the official payload has `claude/` and `codex/` roots.
- No dedicated CI smoke currently reads generated MCP config and
  executes the exact stdio command declared there.
- No plugin hook payload exists today under `plugin-src/`, but future
  hook files need a deterministic validation path before release.
- `deno task check` runs the full local quality gate, but it does not
  prove the downstream marketplace clone contains a runnable official
  payload after publish.

### Constraints

- Keep server implementation host-neutral; host-specific MCP and hook
  wiring stays in plugin packaging.
- Use official host contract boundaries: Codex hook trust cannot be
  automated away in CI.
- CI must be non-interactive and must not require a model API key,
  logged-in Claude Code, or logged-in Codex session.
- Tests must work on GitHub Actions Ubuntu runners with Deno 2.x.
- The dedicated full install-smoke CI job must install the required
  host CLIs explicitly. Missing `codex` or `claude` in that job is a
  failure, not a skipped pass.
- No manual edits to generated `dist/plugin-payload/` or downstream
  marketplace clone; build from source of truth.
- Avoid brittle CLI UI assertions where a structural payload smoke can
  test the same invariant deterministically.

## Definition of Done

- [x] Payload smoke script validates Claude and Codex marketplace
      roots, plugin manifests, MCP paths, and optional hook paths from
      a built payload. Acceptance tuple — FR-E72 + Test:
      `scripts/plugin-payload-smoke_test.ts::FR-E72 payload smoke validates official host roots`;
      Evidence: `deno task test scripts/plugin-payload-smoke_test.ts`.
- [x] Original-repo publish-shape install smoke builds the final
      official payload from the `flowai-workflow` checkout, registers it
      as a local marketplace named `flowai-workflow` inside an isolated
      temp host home, installs `flowai-workflow@flowai-workflow`, and
      verifies the installed cache rather than the source tree.
      Acceptance tuple — FR-E71 + FR-E72 + Test:
      `scripts/plugin-install-smoke_test.ts::FR-E72 official payload installs from source repo into isolated host home`;
      Evidence: `deno task test scripts/plugin-install-smoke_test.ts`.
- [x] Codex MCP smoke executes the exact command and `cwd` declared in
      the installed Codex cache's `.mcp.json`, sends MCP `initialize`
      and `tools/list`, and verifies the `flowai-workflow` server plus
      expected tool names. Acceptance tuple — FR-E71 + FR-E74 + Test:
      `scripts/plugin-install-smoke_test.ts::FR-E74 installed codex mcp config completes initialize and tools list`;
      Evidence: `deno task test scripts/plugin-install-smoke_test.ts`.
- [x] Claude MCP smoke executes the command declared in
      the installed Claude plugin root's `.mcp.json` with
      `CLAUDE_PLUGIN_ROOT` and `FLOWAI_PLUGIN_DATA` pointed at the
      installed temp cache, sends MCP `initialize` and `tools/list`,
      and verifies the `flowai-workflow` server plus expected tool
      names. Acceptance tuple — FR-E74 + Test:
      `scripts/plugin-install-smoke_test.ts::FR-E74 installed claude mcp config completes initialize and tools list`;
      Evidence: `deno task test scripts/plugin-install-smoke_test.ts`.
- [x] Hook smoke validates every plugin `hooks/hooks.json` or manifest
      `hooks` entry when present, rejects paths outside plugin root,
      and directly executes command hooks from the installed plugin
      cache with synthetic stdin plus `PLUGIN_ROOT`, `PLUGIN_DATA`,
      `CLAUDE_PLUGIN_ROOT`, and `CLAUDE_PLUGIN_DATA`. Acceptance tuple
      — FR-E71 + Test:
      `scripts/plugin-install-smoke_test.ts::FR-E71 installed plugin hook smoke validates and executes bundled hook commands`;
      Evidence: `deno task test scripts/plugin-install-smoke_test.ts`.
- [x] GitHub sync workflow smoke uses the split official payload roots
      after cloning `korchasa/flowai-workflow-plugins`, not the stale
      pre-split `plugins/flowai-workflow` path. Acceptance tuple —
      FR-E72 + Test:
      `scripts/sync-plugins-repo_test.ts::FR-E72 publish smoke command targets host-specific payload roots`;
      Evidence: `deno task test scripts/sync-plugins-repo_test.ts`.
- [x] Documentation states the CI guarantee and the hook trust boundary:
      MCP handshake is automated; Codex hook trust remains a user
      review step and is not claimed as auto-enabled by CI. Acceptance
      tuple — FR-E71 + FR-E74 + manual — korchasa; Evidence:
      `rg -n "hook trust|MCP handshake|plugin-payload-smoke" README.md documents/requirements-engine`.
- [x] Full verification passes after adding the smoke checks.
      Acceptance tuple — FR-E71 + FR-E72 + FR-E74 + Test:
      `scripts/check.ts::full check pipeline`;
      Evidence: `deno task check`.

## Solution

Selected variant: full original-repo publish-shape install smoke.

The implementation should prove the path users receive from the
official marketplace, but without mutating the developer's real
`~/.codex` or `~/.claude` config. The test starts in the engine repo,
builds the official payload with marketplace name `flowai-workflow`,
registers the generated marketplace into isolated host homes, installs
the plugin through host CLI commands where available, then probes the
installed cache.

### Files to Create

- `scripts/plugin-install-smoke.ts`
  - A reusable smoke runner with a small command-line interface:
    `--payload-dir <dir>`, `--engine-root <dir>`, `--version <version>`,
    `--host codex|claude|all`, `--skip-host-cli-install`.
  - Builds the payload by calling `buildPluginPayload` unless
    `--payload-dir` points to an existing generated tree.
  - Uses `marketplaceName` default `flowai-workflow`, not
    `flowai-workflow-local`, so the generated payload matches official
    publication.
  - Creates a temp host home per host (`HOME`, `CODEX_HOME`,
    `CLAUDE_CONFIG_DIR` or the host-supported equivalent discovered in
    current CLI behavior).
  - Runs host plugin commands through a dependency-injected
    `runCommand()` wrapper so unit tests can assert commands without
    relying on installed CLIs.
  - Treats missing host CLIs as failure by default. A local-only
    `--allow-missing-host-cli` flag may downgrade a missing CLI to
    `skipped`, but GitHub CI must not use that flag.
  - Locates the installed plugin root from host CLI output or
    host-supported list/config output after install. Do not infer cache
    paths from today's filesystem layout unless the CLI exposes no
    machine-readable output; in that fallback case fail unless exactly
    one candidate path exists under the isolated host home.

- `scripts/plugin-install-smoke_test.ts`
  - RED tests for:
    - official marketplace name stays `flowai-workflow`;
    - Codex install path calls `codex plugin marketplace add <payload>` +
      `codex plugin add flowai-workflow@flowai-workflow` with isolated
      `CODEX_HOME`/`HOME`;
    - missing host CLI fails in CI mode and is skipped only when
      `--allow-missing-host-cli` is explicitly set;
    - installed plugin root is discovered from host output/config and
      ambiguous cache candidates fail clearly;
    - installed Codex `.mcp.json` is read from the cache and its exact
      `command`, `args`, `cwd`, and `env` are used for the MCP probe;
    - installed Claude `.mcp.json` is read from the installed plugin root
      and probed with `CLAUDE_PLUGIN_ROOT`;
    - hook command paths are normalized under plugin root and external
      paths are rejected;
    - `hooks/hooks.json` absence is a neutral "no hooks to validate",
      not a failure.

- `scripts/plugin-payload-smoke.ts`
  - Optional extraction if the install smoke becomes too large:
    pure structural validators for marketplace and manifest files.
  - Keep this module free of host CLI subprocess behavior.

### Files to Modify

- `scripts/build-plugin-payload_test.ts`
  - Keep the existing payload-shape checks.
  - Add only narrow assertions if the smoke runner exposes shared
    expected tool names or hook path helpers.

- `scripts/sync-plugins-repo.ts`
  - Add a publish preflight hook point: build/stage payload, run
    install smoke against the staged official payload, then commit/tag
    and push only if the smoke succeeds.
  - Add pure helpers that expose host-specific payload roots and the
    stale-path-free smoke command for test coverage.
  - Keep publish behavior unchanged: clone downstream, build payload,
    commit/tag/push when dirty.

- `.github/workflows/sync-plugins.yml`
  - Replace the stale smoke path
    `$TMP_DIR/plugins/flowai-workflow/engine/cli.ts`.
  - Before publish push, run:
    `deno task test scripts/plugin-install-smoke_test.ts`.
  - After cloning downstream, run the smoke runner against the cloned
    official roots:
    `deno run -A scripts/plugin-install-smoke.ts --payload-dir "$TMP_DIR" --host all`.
  - Install or bootstrap required host CLIs explicitly in the workflow,
    with versions pinned or printed to the log. Missing host CLI fails
    the dedicated install-smoke job.

- `scripts/check.ts`
  - Add the new smoke tests to the existing `deno test` suite
    automatically by naming them `_test.ts`.
  - No special check hook is needed unless the smoke runner requires a
    separate non-test command.

- `README.md`
  - Add a short "Plugin CI smoke guarantee" paragraph:
    MCP `initialize` and `tools/list` are automatically probed from
    installed publish-shape payloads; hook definitions are validated and
    directly executed, but Codex hook trust remains user-reviewed.

- `documents/requirements-engine/06-distribution-and-housekeeping.md`
  - Extend FR-E72 acceptance criteria with the original-repo
    publish-shape install smoke.
  - Mention that the GitHub sync workflow validates split host roots.

- `documents/requirements-engine/07-mcp-and-plugin-runtime.md`
  - Extend FR-E74 acceptance criteria with installed-payload MCP
    handshake smoke for Claude and Codex.

### MCP Probe Structure

The smoke runner should avoid reimplementing the whole MCP protocol.
Use a minimal JSON-RPC stdio client:

1. Spawn the declared command with declared `args`, `env`, and `cwd`
   resolved relative to the installed plugin root.
2. Send one line-delimited `initialize` request with the current MCP
   protocol version used by tests.
3. Parse one JSON response line and assert:
   - `jsonrpc == "2.0"`;
   - `id == 1`;
   - `result.serverInfo.name == "flowai-workflow"`;
   - `result.capabilities.tools` exists.
4. Send `notifications/initialized`.
5. Send `tools/list`.
6. Assert that the expected seven FR-E73 tool names are present.
7. Terminate the process cleanly with SIGTERM and fail if stderr has
   unexpected startup errors.

Timeouts should be explicit and short:

- startup timeout: 30 seconds, because the first run may compile the
  cached binary;
- tools/list timeout: 10 seconds after initialize completes.

### Hook Smoke Structure

The hook smoke should support both host layouts without assuming hooks
exist today:

1. Discover candidate hook files:
   - `plugins/flowai-workflow/hooks/hooks.json`;
   - any hook pointer documented by the current host manifest.
2. If no hook file exists, report `no hooks declared` and pass.
3. Parse JSON structurally and fail on malformed data.
4. For every command hook:
   - normalize the command path against plugin root;
   - reject paths escaping plugin root unless the command is a bare
     executable intentionally resolved from PATH and documented in the
     hook file;
   - execute with synthetic stdin event matching the host hook docs;
   - set `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_ROOT`,
     `CLAUDE_PLUGIN_DATA`, `CODEX_HOME`, and `HOME` to temp paths;
   - assert documented success exit codes.

Codex hook trust must be documented as out of CI scope. The test proves
the hook payload is valid and runnable, not that a user's Codex session
has trusted it.

### CI Flow

The GitHub workflow should validate before publishing and after cloning
the downstream repo:

1. Checkout `flowai-workflow`.
2. Set up Deno.
3. Build official payload into a temp directory with
   `marketplaceName = "flowai-workflow"`.
4. Install required host CLIs and print their versions.
5. Run `scripts/plugin-install-smoke.ts` against the temp payload
   without `--allow-missing-host-cli`.
6. Publish to `korchasa/flowai-workflow-plugins` only after the smoke
   passes.
7. Clone the downstream repo after push.
8. Re-run the smoke against the clone to catch copy/path drift.

This order prevents a known-bad payload from being pushed when the
failure is detectable before publish. The post-clone smoke remains as a
guard against sync/copy mistakes.

### Error Handling

- Fail fast on malformed manifests, missing marketplace roots, missing
  `.mcp.json`, missing expected server names, or MCP protocol timeout.
- Distinguish `skipped host CLI unavailable` from `passed`; CI should
  treat required host install smoke as failure. Only local developer
  probes may opt into `--allow-missing-host-cli`.
- Print the exact resolved plugin root, MCP command, and cwd on
  failure.
- Never write into real user homes. Every host command runs with
  isolated `HOME`/host data env vars.
- Reject hook command paths outside plugin root by default. A bare
  executable from `PATH` is allowed only when the hook file includes an
  explicit allowlist entry and the smoke runner logs the resolved
  executable path.

### Verification Commands

- `deno task test scripts/plugin-install-smoke_test.ts`
- `deno task test scripts/build-plugin-payload_test.ts scripts/sync-plugins-repo_test.ts`
- `deno task sync-plugins -- --dry-run --out-dir /private/tmp/flowai-payload-check`
- `deno run -A scripts/plugin-install-smoke.ts --payload-dir /private/tmp/flowai-payload-check --host all`
- `deno task check`
