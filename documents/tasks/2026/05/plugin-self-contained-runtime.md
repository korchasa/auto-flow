---
date: "2026-05-24"
status: in progress
implements: [FR-E74]
tags: [distribution, claude-plugin, mcp, lazy-compile, self-contained]
related_tasks:
  - 2026/05/plugin-first-distribution.md
  - 2026/05/embedded-mcp-server.md
---

# Plugin Self-Contained Runtime: Auto-MCP + Lazy Binary Compile

## Goal

Make the Claude Code / Codex plugin the **sole** delivery channel for
flowai-workflow. The user installs the plugin and gets:

1. An MCP server (`flowai-workflow`, the seven engine-control tools from
   FR-E73) auto-registered by the plugin manager — no manual
   `~/.codex/config.toml` block, no `.mcp.json` edit.
2. A binary that the launcher compiles on first invocation from the
   engine sources shipped inside the payload, then caches under
   `$CLAUDE_PLUGIN_ROOT/bin/`. Subsequent invocations skip Deno and
   exec the binary directly.

No separate `deno install jsr:@korchasa/flowai-workflow`, no GitHub-Release
binary download, no `flowai-workflow` symbol on PATH. Deno is required on
the host as a one-shot toolchain (it performs the lazy compile), then
becomes unused at run time.

## Overview

### Context

After FR-E70 (plugin-first distribution) and FR-E73 (embedded MCP
server) two gaps remain that contradict the "everything in the plugin"
intent:

- The plugin manifest does NOT declare `mcpServers`. The README
  explicitly says "flowai-workflow is not an MCP server, so the plugin
  manager wires the launcher skills directly" — but FR-E73 added an MCP
  server, so the disclaimer is now wrong, and users have to wire MCP
  by hand.
- The plugin payload ships engine TypeScript only. Every skill (and now
  every MCP call) re-launches `deno run -A engine/cli.ts ...`, paying
  Deno's cold-start and dependency-resolution cost per invocation. For
  the MCP server — which Claude Code spawns once per session and keeps
  alive — that is fine; for `run` and `init` skill calls it is needless
  overhead. More importantly, the "everything in the plugin" promise
  reads as half-kept: a runnable engine is shipped *in source form*,
  not *as a runnable program*.

### Current State

- `claude-plugin/.claude-plugin/marketplace.json` lists the plugin at
  v0.7.12, owner `korchasa`, source `./plugins/flowai-workflow`.
- `claude-plugin/plugins/flowai-workflow/.claude-plugin/plugin.json`
  carries `name/description/version/author/repository/homepage/license`
  only — no `mcpServers` block.
- `claude-plugin/plugins/flowai-workflow/skills/{run,init,scaffold,supervise,orchestrate}/SKILL.md`
  all invoke `FLOWAI_SUPPRESS_DEPRECATION=1 deno run -A "$CLAUDE_PLUGIN_ROOT/engine/cli.ts" …`.
- `scripts/build-plugin-payload.ts` enumerates files via `git ls-files`,
  copies engine TS sources to `plugins/flowai-workflow/engine/`, bundled
  workflows to `plugins/flowai-workflow/.flowai-workflow/<name>/`, and
  pins manifest versions. No launcher script is emitted.
- `scripts/compile.ts` exists for cross-platform CI release builds (4
  targets via `deno compile --target …`), driven from `scripts/targets.json`.
  It writes binaries to the repo root — never inside the plugin payload.
- `mcp-server.ts` accepts a single positional `workflowDir` argument
  (FR-E73). Multi-workflow projects need launcher-side resolution.
- README of `claude-plugin/` carries "Prerequisite: Deno 2.x" and the
  obsolete "not an MCP server" disclaimer.

### Constraints

- **Marketplace size discipline (FR-E70).** Prebuilt binaries (≈25 MB ×
  4 targets) MUST NOT ship in the payload — Git LFS overhead, slow
  marketplace clone. Compile is deferred to first use on the host.
- **Engine domain-agnostic invariant** (AGENTS.md Key Decisions). The
  launcher resolves `workflowDir` from `$CLAUDE_PROJECT_DIR/.flowai-workflow/`
  — that lookup logic lives in the launcher script (a packaging
  concern), NOT inside `mcp-server.ts` or `cli.ts`.
- **Atomic compile.** A partially-written binary would brick subsequent
  launches. The launcher compiles to a temp file and renames into place;
  a crash mid-compile leaves the previous binary (or nothing) intact.
- **Binary cache via `$CLAUDE_PLUGIN_DATA`.** Claude Code exports
  `$CLAUDE_PLUGIN_DATA` (documented; persistent per-plugin data dir,
  always writable, survives plugin updates). The launcher caches
  the compiled binary at `$CLAUDE_PLUGIN_DATA/bin/flowai-workflow-<version>`.
  No `$XDG_CACHE_HOME` fallback needed; Claude Code guarantees the
  data dir is writable. Prior art: `hindsight-memory` plugin uses
  the same dir for a Python venv.
- **Version extraction simplified.** The plugin's installation path
  contains the version segment (`cache/<marketplace>/<plugin>/<X.Y.Z>/`),
  so the launcher derives version via
  `basename "$(dirname "$CLAUDE_PLUGIN_ROOT")"` style logic (the
  plugin installer puts version into the path). Fallback: read
  `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` `"version"`
  field via a single `python3 -c` or `node -e` JSON parse — both
  are universally available on macOS/Linux. No sibling `.version`
  file needed.
- **Cross-platform launcher.** v1 ships a POSIX `launch.sh` (covers
  macOS + Linux, where Claude Code is shipped today). Windows
  (PowerShell) is a follow-up — `plugin.json` `mcpServers.command` can
  switch between `.sh` and `.ps1` later via OS detection or a separate
  Windows skill if Claude Code's plugin schema does not support
  conditional commands.
- **Fail fast** (AGENTS.md). Missing Deno on first launch yields a
  clear, non-fallback error pointing to the install link. No silent
  fallback to `deno run cli.ts` (would defeat the lazy-compile
  contract); on the contrary, if Deno is missing the launcher exits 127
  with a precise message.
- **MCP launch fixed-string contract.** `plugin.json#mcpServers.flowai-workflow.command`
  resolves to `${CLAUDE_PLUGIN_ROOT}/bin/launch.sh`, args
  `["mcp"]`. The launcher then resolves the workflow directory at
  spawn time from `$CLAUDE_PROJECT_DIR` (Claude Code sets this; to
  verify in develop — fall back to `$PWD` otherwise) or `$PWD`
  (Codex; subject to verification during develop). Override via
  `FLOWAI_WORKFLOW=<name>` env var. When no workflow is resolvable,
  the launcher passes `--no-workflow` flag (not a literal sentinel)
  to `cli.ts mcp`; `mcp-server.ts` recognises the flag and starts in
  the no-workflow mode.
- **Idempotent cache.** Re-running the launcher with an existing
  cached binary skips compile entirely. Binary file name encodes the
  engine version (`flowai-workflow-<version>`) so a payload sync to a
  new plugin version triggers a fresh compile rather than reusing a
  stale binary.

## Definition of Done

- [x] **Tests (regression-locked):** `scripts/build-plugin-payload_test.ts`,
      `claude-plugin/plugins/flowai-workflow/bin/launch_test.sh` (or
      `scripts/launch_test.ts` for an in-process port if pure shell
      tests prove brittle), `scripts/sync-plugins-repo_test.ts`,
      `scripts/check_test.ts`. (FR-E74; Evidence: `deno task check`.)
- [x] **FR-E74 §3.74 added to SRS** with the canonical field set
      (Description, Tasks back-pointer, Motivation, Acceptance criteria
      including a `**Tests:**` line). Evidence:
      `grep -n "FR-E74" documents/requirements-engine/06-distribution-and-housekeeping.md documents/requirements-engine.md`.
      (FR-E74; manual — korchasa.)
- [x] **`documents/index.md` carries an FR-E74 row** under `## FR`
      sorted alphabetically among FR-E entries. Anchor resolves in
      `requirements-engine/06-distribution-and-housekeeping.md`.
      (FR-E74; manual — korchasa; Evidence:
      `grep -n "FR-E74" documents/index.md`.)
- [x] **Launcher script `claude-plugin/plugins/flowai-workflow/bin/launch.sh`
      exists** with: (a) POSIX-only `sh` body; (b) Deno preflight (exit
      127 with install-link error on missing `deno`); (c) atomic
      compile (`deno compile … --output bin/.flowai-workflow-<ver>.tmp`
      then `mv` to `bin/flowai-workflow-<ver>`) skipped when the
      versioned binary already exists; (d) workflow resolution from
      `$FLOWAI_WORKFLOW` → `$CLAUDE_PROJECT_DIR/.flowai-workflow/<single-or-default>`
      → `$PWD/.flowai-workflow/<…>` chain; (e) `exec` the binary with
      forwarded args. Acceptance tuple — FR-E74 + Test:
      `scripts/launch_test.ts::FR-E74 launcher caches binary by version, FR-E74 launcher fails fast without Deno, FR-E74 launcher resolves single workflow folder`
      + Evidence: `deno test -A scripts/launch_test.ts`.
- [x] **`.mcp.json` ships in plugin payload** registering the
      flowai-workflow MCP server: `command = "bash"`, `args =
      ["${CLAUDE_PLUGIN_ROOT}/bin/launch.sh", "mcp"]`. Sibling of
      `plugin.json`'s parent (`claude-plugin/plugins/flowai-workflow/.mcp.json`,
      copied verbatim by the payload builder). Acceptance tuple —
      FR-E74 + Test:
      `scripts/build-plugin-payload_test.ts::FR-E74 payload includes .mcp.json with launcher wiring`
      + Evidence: `deno test -A scripts/build-plugin-payload_test.ts`.
- [x] **`scripts/build-plugin-payload.ts` ships the launcher** under
      `plugins/flowai-workflow/bin/launch.sh` with the executable bit
      preserved (chmod +x post-copy on POSIX). Payload byte-shape is
      deterministic. Acceptance tuple — FR-E74 + Test:
      `scripts/build-plugin-payload_test.ts::FR-E74 payload includes launcher with executable bit`
      + Evidence: `deno test -A scripts/build-plugin-payload_test.ts`.
- [x] **`README.md` of `claude-plugin/` updated:** drop the "not an
      MCP server" disclaimer; document the auto-MCP wiring; explain
      the one-time compile latency on first launch and the
      `$CLAUDE_PLUGIN_ROOT/bin/` cache. (FR-E74; manual — korchasa;
      Evidence: `grep -n 'auto-registered' claude-plugin/README.md`.)
- [ ] **Existing skill SKILL.md preflight updated:** `command -v deno`
      check stays, but the rationale comment changes to "Deno is
      required for the first-call lazy compile; subsequent runs use
      the cached binary." Skills MAY switch to invoking
      `$CLAUDE_PLUGIN_ROOT/bin/launch.sh <subcmd> <args>` instead of
      `deno run …cli.ts <subcmd>` to share the lazy-compile path;
      decision deferred to the develop phase pragmatic check (no
      functional difference, ergonomics only). (FR-E74; manual —
      korchasa.)
- [x] **`cli.ts mcp` accepts `--no-workflow` flag.** When set,
      `runMcpServer()` is invoked with a sentinel internal value (or
      a separate "no-workflow" mode flag) and starts without
      requiring a `workflow.yaml` on disk. Every tool handler then
      short-circuits with a structured "no workflow folder found;
      run /flowai-workflow:init" error so Claude Code sees the
      server up and surfaces the diagnostic through the standard
      tool-error path rather than an opaque spawn failure.
      Acceptance tuple — FR-E74 + Test:
      `mcp-server_test.ts::FR-E74 server starts in no-workflow mode and surfaces missing-workflow error on tool call`,
      `cli_test.ts::FR-E74 mcp --no-workflow flag dispatches no-workflow mode`
      + Evidence: `deno task test`.
- [x] **`AGENTS.md` updated** with the launcher and auto-MCP wiring
      under Architecture > Plugin payload section. (FR-E74; manual —
      korchasa; Evidence: `grep -n 'launch.sh' AGENTS.md`.)
- [x] **FR-E70 cross-link added** in SRS: FR-E70 §Description carries
      a one-line note "Self-contained-runtime extension (lazy compile +
      MCP auto-registration) is specified in FR-E74." (FR-E70 + FR-E74;
      manual — korchasa; Evidence:
      `awk '/FR-E70/,/FR-E[0-9]+:/' documents/requirements-engine/06-distribution-and-housekeeping.md | grep -i "FR-E74"`.)
- [x] **Full check green:** `deno task check` exits 0; `deno task
      sync-plugins -- --dry-run` shows the launcher in payload and
      `mcpServers` in `plugin.json`. (FR-E74; Evidence: CI run URL in
      PR body.)

## Solution

Five phases. Order: launcher contract (RED) → payload integration →
manifest wiring → MCP server tolerance for missing workflow → docs +
SRS.

### Phase 1 — Launcher contract `bin/launch.sh`

**Files:**

- New: `claude-plugin/plugins/flowai-workflow/bin/launch.sh` (bash)
- New: `scripts/launch_test.ts` (Deno test driver — spawns `bash
  launch.sh …` against a temp `CLAUDE_PLUGIN_ROOT` + `CLAUDE_PLUGIN_DATA`
  fixture, with a fake `deno` shim on PATH that logs invocations)

Contract (validated against `hindsight-memory` plugin's
`scripts/run_mcp.sh` — same shape, same env-var contract):

```bash
#!/usr/bin/env bash
# launch.sh — flowai-workflow plugin launcher (FR-E74).
# Bootstraps the engine binary into ${CLAUDE_PLUGIN_DATA} on first call;
# execs the cached binary thereafter. Subsequent calls skip Deno entirely.
set -euo pipefail

ENGINE_DIR="${CLAUDE_PLUGIN_ROOT}/engine"
PLUGIN_JSON="${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"

# Version: read from plugin.json via python3 (universally available on
# macOS/Linux). Fail loud if missing — plugin install is broken.
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$PLUGIN_JSON")"

BIN_DIR="${CLAUDE_PLUGIN_DATA}/bin"
BIN="${BIN_DIR}/flowai-workflow-${VERSION}"

if [[ ! -x "$BIN" ]]; then
  if ! command -v deno >/dev/null 2>&1; then
    printf 'Error: Deno 2.x is required for the flowai-workflow plugin first-launch compile.\n' >&2
    printf 'Install: https://deno.com/\n' >&2
    exit 127
  fi
  mkdir -p "$BIN_DIR"
  # Enumerate bundled workflow files; bash arrays handle spaces cleanly.
  declare -a INCLUDE_ARGS=()
  if [[ -d "${CLAUDE_PLUGIN_ROOT}/.flowai-workflow" ]]; then
    while IFS= read -r -d '' f; do
      INCLUDE_ARGS+=(--include "$f")
    done < <(find "${CLAUDE_PLUGIN_ROOT}/.flowai-workflow" -type f -print0)
  fi
  TMP="${BIN}.tmp.$$"
  # Atomic compile: write to tmp, rename on success.
  deno compile --allow-all --no-check "${INCLUDE_ARGS[@]}" \
    --output "$TMP" "${ENGINE_DIR}/cli.ts" >&2
  mv "$TMP" "$BIN"
fi

# Workflow resolution for `mcp` (no-op for other subcommands).
if [[ "${1:-}" == "mcp" ]]; then
  shift
  WF=""
  if [[ -n "${FLOWAI_WORKFLOW:-}" ]]; then
    WF="$FLOWAI_WORKFLOW"
  else
    ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
    if [[ -d "$ROOT/.flowai-workflow" ]]; then
      declare -a CANDIDATES=()
      for d in "$ROOT"/.flowai-workflow/*/; do
        [[ -f "$d/workflow.yaml" ]] && CANDIDATES+=("${d%/}")
      done
      if [[ ${#CANDIDATES[@]} -eq 1 ]]; then
        WF="${CANDIDATES[0]}"
      elif [[ -f "$ROOT/.flowai-workflow/github-inbox/workflow.yaml" ]]; then
        WF="$ROOT/.flowai-workflow/github-inbox"
      fi
    fi
  fi
  if [[ -n "$WF" ]]; then
    exec "$BIN" mcp "$WF" "$@"
  fi
  # No workflow: pass --no-workflow flag (typed contract). mcp-server.ts
  # surfaces the diagnostic via tool-call errors so the MCP handshake
  # still completes.
  exec "$BIN" mcp --no-workflow "$@"
fi

exec "$BIN" "$@"
```

Tests in `scripts/launch_test.ts` (each test sets up a temp
`CLAUDE_PLUGIN_ROOT` with stub `plugin.json` + a synthetic
`engine/cli.ts` containing `console.log("compiled")` + a fake
`deno` shim on PATH that writes a log line and copies a stub
binary into the `--output` path):

- `FR-E74 launcher compiles on first call and caches by version` —
  run `bash launch.sh --version` twice; assert the fake-deno log has
  exactly one entry (second call uses the cached binary).
- `FR-E74 launcher fails fast without Deno when binary is missing` —
  PATH scrubbed of `deno`; assert exit code 127 and stderr contains
  install link.
- `FR-E74 launcher skips Deno preflight when binary cached` —
  pre-populate `${CLAUDE_PLUGIN_DATA}/bin/flowai-workflow-<v>` with a
  stub; scrub `deno` from PATH; assert success and no Deno-missing
  error.
- `FR-E74 launcher resolves single workflow folder for mcp` —
  fixture project with one `.flowai-workflow/foo/workflow.yaml`;
  assert the spawned stub binary received args `mcp <abs>/foo`.
- `FR-E74 launcher prefers github-inbox on ambiguity` —
  fixture with two workflow subdirs incl. `github-inbox`; assert
  args `mcp <abs>/github-inbox`.
- `FR-E74 launcher passes --no-workflow when none found` —
  empty fixture; assert args `mcp --no-workflow`.
- `FR-E74 launcher honours FLOWAI_WORKFLOW override` — env
  `FLOWAI_WORKFLOW=/some/path`; assert args `mcp /some/path`.

### Phase 2 — `scripts/build-plugin-payload.ts` integration

**File:** `scripts/build-plugin-payload.ts` (edit)

- Extend `classifyPayloadFile`: any `claude-plugin/plugins/flowai-workflow/bin/<file>`
  routes to `plugins/flowai-workflow/bin/<file>` (currently handled by
  the verbatim-copy branch — verify with a new test, no code change
  needed).
- After copy, post-process: any file under `<outDir>/plugins/flowai-workflow/bin/`
  ending in `.sh` gets `chmod 0755` (POSIX-only; on Windows hosts this
  is a no-op but the payload still ends up in a downstream repo that
  preserves the bit in git). Existing copy via `Deno.copyFile` does
  NOT preserve mode bits — add an explicit `Deno.chmod(dst, 0o755)`
  in the loop for `*.sh` under `bin/`.

Tests in `scripts/build-plugin-payload_test.ts`:

- `FR-E74 payload includes launcher with executable bit` — feed a
  fixture that includes a `bin/launch.sh`; assert (a) file is present
  in `outDir`, (b) mode bits include 0o100 (executable). Skip the
  mode-bit assertion on Windows runners (`Deno.build.os === "windows"`).
- `FR-E74 plugin manifest carries mcpServers entry` — feed a fixture
  `plugin.json` with `mcpServers`; assert the substituted output
  still contains the block (substitution touches only `version`).

### Phase 3 — `.mcp.json` (separate file, conventional pattern)

**Files:**

- New: `claude-plugin/plugins/flowai-workflow/.mcp.json` (mirrors
  `hindsight-memory` and `cloudflare` plugin patterns observed in
  `~/.claude/plugins/cache/`).
- Edit `plugin.json` description prose only — drop the "Bundles the
  engine source" sentence and add "Auto-registers the engine MCP
  server via `.mcp.json`."

`.mcp.json`:

```json
{
  "mcpServers": {
    "flowai-workflow": {
      "command": "bash",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bin/launch.sh", "mcp"]
    }
  }
}
```

Notes:
- `command: "bash"` + script path as args mirrors hindsight (also a
  bash script). Direct `command: "${CLAUDE_PLUGIN_ROOT}/bin/launch.sh"`
  also works (executable bit is preserved) but `bash` as the entry
  point makes the contract explicit and avoids issues if the
  payload's exec bit is dropped by a downstream packaging path.
- `${CLAUDE_PLUGIN_ROOT}` is documented as substituted in both
  `command` and `args` of plugin MCP configs (see
  `docs.claude.com/.../plugins-reference` Environment Variables
  section).

Verification: `deno task sync-plugins-local`, then in a fresh
Claude Code session: `/mcp` lists `flowai-workflow` with the seven
tools after the first call. The first call invokes
`deno compile` and may take ~10–30 seconds; subsequent session
spawns reuse the cached binary instantly.

### Phase 4 — `cli.ts mcp --no-workflow` + `mcp-server.ts` tolerance

**Files:** `cli.ts` (edit), `mcp-server.ts` (edit)

`cli.ts` `mcp` subcommand now accepts `--no-workflow` as an
alternative to the positional workflow path. When the flag is set,
`runMcpServer()` is invoked with `noWorkflow: true` in
`RunMcpServerOptions` (new field) and no `workflowDir`. Internally,
the server registers all seven tools as usual but each handler
short-circuits with `{ isError: true, content: [{ type: "text", text:
"No flowai-workflow folder found in this project. Run /flowai-workflow:init <name> to scaffold one." }] }`.
The MCP handshake therefore succeeds (Claude Code sees the server
running), and the diagnostic flows through the standard tool-error
path rather than an opaque spawn failure.

Tests:

- `FR-E74 server starts in no-workflow mode and surfaces missing-workflow error on tool call`
  — `runMcpServer(undefined, { transport, noWorkflow: true })`
  connects; client lists tools → all 7 present; client calls
  `get_workflow` → receives the structured missing-workflow error.
- `FR-E74 mcp --no-workflow flag dispatches no-workflow mode`
  — `cli.ts` argv `["mcp", "--no-workflow"]` reaches
  `runMcpServer` with `noWorkflow: true` (assert via injected
  spy/mock).

### Phase 5 — Docs + SRS

**Files:**

- `documents/requirements-engine/06-distribution-and-housekeeping.md`
  (edit — append):

  ```md
  ### 3.74 FR-E74: Plugin Self-Contained Runtime (Lazy Compile + Auto-MCP)

  - **Description:** The Claude Code / Codex plugin ships engine TS
    sources + a POSIX launcher (`bin/launch.sh`). The launcher detects
    a missing binary at `bin/flowai-workflow-<version>`, compiles
    `engine/cli.ts` via `deno compile` (one-shot, atomic via tmp +
    rename), then `exec`s the binary with forwarded args. Subsequent
    invocations skip Deno. `plugin.json` declares an `mcpServers` block
    that registers the engine MCP server (FR-E73 seven tools) via the
    same launcher; the launcher resolves the active workflow dir from
    `$FLOWAI_WORKFLOW` → `$CLAUDE_PROJECT_DIR/.flowai-workflow/`
    (single or `github-inbox` default) → sentinel
    `__no_workflow_found__`. `mcp-server.ts` tolerates the sentinel by
    surfacing the diagnostic through tool-call errors so the MCP
    handshake still completes.
  - **Tasks:** [plugin-self-contained-runtime](tasks/2026/05/plugin-self-contained-runtime.md)
  - **Motivation:** Closes the "everything in the plugin" gap left by
    FR-E70 (sources only) + FR-E73 (no auto-registration). User installs
    the plugin once and the IDE wires both CLI invocations (run/init
    skills) and the MCP server automatically. No `deno install`, no
    GitHub-Release binary, no `~/.codex/config.toml` hand-edit.
  - **Acceptance criteria:**
    - **Tests:** `scripts/launch_test.ts`, `scripts/build-plugin-payload_test.ts`,
      `mcp-server_test.ts` (FR-E74; regression-locked).
    - [ ] Launcher caches by version: `flowai-workflow-<v>` is reused
      across runs of the same plugin version; bumping the plugin version
      triggers a fresh compile.
    - [ ] `plugin.json#mcpServers.flowai-workflow.command` points at
      `${CLAUDE_PLUGIN_ROOT}/bin/launch.sh` and args are `["mcp"]`.
    - [ ] MCP server boots without a workflow folder and surfaces the
      missing-workflow diagnostic via tool errors.
    - [ ] Manual smoke: in a fresh Claude Code session,
      `/plugin install flowai-workflow@flowai-workflow-local` → `/mcp`
      lists the seven tools.
  ```

- `documents/requirements-engine.md` (edit) — add `FR-E74 (Plugin
  Self-Contained Runtime) → 06-distribution-and-housekeeping` row.

- `documents/index.md` (edit) — add FR-E74 row under `## FR`.

- `claude-plugin/README.md` (edit — SOURCE-OF-TRUTH for the
  downstream marketplace repo README; CI sync overwrites the
  downstream copy on every release tag) — drop the "not an MCP
  server" paragraph; add "Auto-wired MCP server" section describing
  the seven tools and the lazy-compile cache.

- `AGENTS.md` (edit) — under Architecture > Plugin payload cross-repo
  sync, append: "Launcher contract (`bin/launch.sh`, FR-E74): the
  payload includes a POSIX launcher that lazy-compiles
  `engine/cli.ts` to `bin/flowai-workflow-<version>` on first call
  and `exec`s the cached binary thereafter. `plugin.json` declares
  `mcpServers` so Claude Code auto-registers the engine MCP server
  via the same launcher."

- `documents/requirements-engine/06-distribution-and-housekeeping.md`
  FR-E70 §Description: append "Self-contained-runtime extension (lazy
  compile + MCP auto-registration) is specified in FR-E74."

### Verification

```sh
deno test -A scripts/launch_test.ts
deno test -A scripts/build-plugin-payload_test.ts
deno test -A mcp-server_test.ts
deno task check
deno task sync-plugins -- --dry-run | grep -E "bin/launch.sh|mcpServers"
# Manual smoke:
deno task sync-plugins-local
# In Claude Code: /mcp → flowai-workflow (7 tools listed)
# In Claude Code: /flowai-workflow:run github-inbox --dry-run → binary
# compiled on first call, cached under
# ~/.claude/plugins/<id>/plugins/flowai-workflow/bin/flowai-workflow-<v>.
```

## Follow-ups

- **Superseded by [ts-launcher](ts-launcher.md) (2026-05-25).** The bash
  launcher `bin/launch.sh` referenced throughout this task was rewritten
  in Deno/TypeScript (`bin/launch.ts`) and `.mcp.json` now invokes
  `deno run -A …/bin/launch.ts mcp` instead of `bash …/bin/launch.sh
  mcp`. The chmod carve-out in `build-plugin-payload.ts` was removed.
  See the new task for rationale (Windows compatibility, drop POSIX
  shell dependency, unit-testable pure helpers).
- **Verify `$CLAUDE_PROJECT_DIR` semantics during develop.** Claude Code
  documents `${CLAUDE_PLUGIN_ROOT}` substitution in `plugin.json` but
  `$CLAUDE_PROJECT_DIR` may or may not be exported into the
  `mcpServers.<>.command` subprocess environment. Verify via local
  smoke before relying on it; fall back to `$PWD` plus a launcher
  log-line so the misroute is debuggable.
- **`chmod +x` parity in `sync-plugins-local.ts`.** Phase 2 sets the
  exec bit in `build-plugin-payload.ts`, but the local sync path may
  re-write files via a different code path. Verify launcher is still
  executable after `deno task sync-plugins-local`. Add a regression
  test if drift is found.
- **Windows launcher** (`launch.ps1`). Plugin schema check required:
  does `plugin.json#mcpServers.command` accept an OS-conditional
  string, or do we ship two `mcpServers` keys, or rely on the user's
  Windows shim being POSIX-incompatible. Track as a separate FR
  (`FR-E75 Windows launcher for plugin runtime`) once a Windows user
  asks.
- **Multi-workflow MCP routing.** If a project has >1 workflow folder
  and none is named `github-inbox`, the launcher currently passes the
  sentinel. Future enhancement: spawn one MCP server per workflow
  folder via `mcpServers.flowai-workflow-<name>` entries — needs a
  schema extension or a `WorkflowRouter` shim. Track separately.
- **Compile cache eviction.** Versioned binaries accumulate in
  `bin/` across plugin upgrades. A janitor step (delete binaries whose
  version is older than current `plugin.json` version) is a small
  follow-up.
- **Switch skill SKILL.md to launcher.** `run`, `init`, `scaffold`
  could route through `bin/launch.sh` instead of `deno run …cli.ts`
  to share the lazy-compile cache. Functional equivalent; consider
  during develop phase if first-call latency on skill invocations
  becomes a complaint.
