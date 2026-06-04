---
date: "2026-05-25"
status: superseded
implements: [FR-E74]
superseded_by: 2026/06/plugin-binary-fallback.md
tags: [plugin, launcher, refactor, cross-platform, deno]
related_tasks:
  - 2026/05/plugin-self-contained-runtime.md
---

# TS Launcher: Rewrite `bin/launch.sh` in Deno/TypeScript

## Goal

Replace `claude-plugin/plugins/flowai-workflow/bin/launch.sh` (POSIX
bash) with a TypeScript launcher running under Deno. Same FR-E74
contract — lazy compile of `engine/cli.ts` into
`${CLAUDE_PLUGIN_DATA}/bin/flowai-workflow-<version>`, atomic
tmp→mv, exec the cached binary, workflow resolution for the `mcp`
subcommand. The rewrite eliminates the bash + python3 toolchain
dependency, removes pure-shell edge cases (`set -u` + empty arrays,
old-bash 3.2 on stock macOS, path-with-spaces quoting), and unlocks
a Windows launcher path without a separate `.ps1` file.

## Overview

### Context

FR-E74 shipped with a bash launcher (`bin/launch.sh`, 75 lines).
Confirmed working on macOS via the test suite + verified against the
`hindsight-memory` plugin's `scripts/run_mcp.sh` precedent. The script
depends on bash 4+ syntax (`declare -a`, `${arr[@]+...}`, `[[ ]]`) and
on `python3` for one line of JSON parsing. Both are universally
available on macOS/Linux hosts running Claude Code today, but:

- Old stock macOS ships bash 3.2 (no GPLv3); `${INCLUDE_ARGS[@]+...}`
  under `set -u` is brittle there.
- Minimal containers (Alpine without `bash`/`python3`) can't run the
  launcher.
- Windows users will need a parallel `.ps1` — duplicated logic, dual
  test surface.

A Deno/TS launcher trades a ~200ms Deno startup per call for: single
code path across all OSes, type-safe path/env handling, native JSON
parsing, testable pure functions (no subprocess + fake-`deno`-shim
gymnastics), and a contractual fit with the rest of the project
(everything else is already Deno).

### Current State

- `claude-plugin/plugins/flowai-workflow/bin/launch.sh` — bash 4+
  launcher. Calls `python3 -c` for JSON-parsing `plugin.json`. Uses
  bash arrays + `find -print0` + `while read -d ''` for include-args
  enumeration. `mv $TMP $BIN` for atomic compile.
- `claude-plugin/plugins/flowai-workflow/.mcp.json` — invokes
  `bash $CLAUDE_PLUGIN_ROOT/bin/launch.sh mcp`.
- `scripts/launch_test.ts` — Deno test driver. Spawns `bash launch.sh`
  against a temp `CLAUDE_PLUGIN_ROOT` + `CLAUDE_PLUGIN_DATA` fixture
  with a fake-`deno` shim on PATH. 7 tests.
- `scripts/build-plugin-payload.ts` — copies `claude-plugin/`
  verbatim, sets `chmod 0o755` for `bin/*.sh` files only.

### Constraints

- **Preserve FR-E74 acceptance.** Same observable contract: first call
  compiles → cache → exec binary; subsequent calls skip compile;
  `mcp --no-workflow` sentinel when no workflow dir resolvable;
  resolution order `$FLOWAI_WORKFLOW` → `$CLAUDE_PROJECT_DIR` →
  `$PWD` → fallback to `github-inbox`.
- **Deno startup cost.** Each launcher invocation pays ~200ms Deno
  cold-start (vs ~5ms bash). For MCP servers (one spawn per session,
  long-lived) this is negligible. For skill calls (run/init,
  potentially many per session) it's perceptible but acceptable —
  the binary itself takes much longer to start anyway.
- **No process-replace in Deno.** Unlike `bash exec`, `Deno.Command`
  spawns a child process; the Deno parent stays resident waiting.
  Must inherit stdin/stdout/stderr (`stdio: "inherit"`) so MCP stdio
  passes through faithfully, and must forward `SIGINT`/`SIGTERM` to
  the child so Claude Code shutdowns reach the binary cleanly.
- **No deno.lock leakage.** Running `deno run -A launch.ts` from
  inside the plugin install dir resolves imports. The launcher MUST
  have zero `npm:` / `jsr:` imports (only `Deno.*` builtins + `@std/`
  if absolutely needed) so first-call works offline. Better: zero
  imports at all — single-file launcher with only `Deno.*` APIs.
- **Test fixture isolation.** Existing `scripts/launch_test.ts`
  spawns bash; new design must either keep subprocess testing (TS
  launcher tested end-to-end via `deno run launch.ts`) OR migrate to
  in-process testing of pure helper functions exported from
  `launch.ts`. Hybrid acceptable: pure helpers tested in-process for
  speed + breadth; one or two integration tests still spawn the
  whole `deno run` pipeline.
- **`.mcp.json` command shape.** Stays `"command": "deno"`, `"args":
  ["run", "-A", "${CLAUDE_PLUGIN_ROOT}/bin/launch.ts", "mcp"]`. Deno
  must be on PATH for both first-call (compile) and subsequent
  calls (launcher itself). This is a regression vs the bash version
  (where Deno is only needed on first call) — but Deno is already
  required for compile, so net incremental requirement is zero in
  practice.
- **No bash launcher kept around.** Delete `bin/launch.sh` and the
  bash-spawning fixture in `scripts/launch_test.ts`. Conditional
  delivery (ship both `.sh` and `.ts`) doubles the surface area; the
  TS version supersedes.
- **Payload builder mode bits.** `build-plugin-payload.ts` no longer
  needs the `chmod 0o755` carve-out for `bin/*.sh`. The TS launcher
  is invoked via `deno run`, not directly executed — no exec bit
  required.

## Definition of Done

- [x] **Tests (regression-locked):** `scripts/launch_test.ts`,
      `scripts/build-plugin-payload_test.ts`. (FR-E74; Evidence:
      `deno task check`.) Test names stay `FR-E74 …`-prefixed.
- [x] **`claude-plugin/plugins/flowai-workflow/bin/launch.ts`
      created** with the same observable contract as the deleted
      `bin/launch.sh`: lazy compile to
      `${CLAUDE_PLUGIN_DATA}/bin/flowai-workflow-<version>`, atomic
      tmp→rename, workflow resolution, `--no-workflow` fallback,
      fail-fast on missing Deno only at first-call compile path.
      Acceptance tuple — FR-E74 + Test:
      `scripts/launch_test.ts::FR-E74 launcher *`
      + Evidence: `deno task check`.
- [x] **`bin/launch.sh` removed.** No bash launcher in the payload.
      Acceptance tuple — FR-E74 + Test: file does not exist;
      Evidence: `! [ -f claude-plugin/plugins/flowai-workflow/bin/launch.sh ]`.
- [x] **`.mcp.json` updated** to invoke
      `"command": "deno", "args": ["run", "-A",
      "${CLAUDE_PLUGIN_ROOT}/bin/launch.ts", "mcp"]`. Acceptance
      tuple — FR-E74 + Test:
      `scripts/build-plugin-payload_test.ts::FR-E74 payload includes .mcp.json with launcher wiring`
      (updated to assert the new shape) + Evidence:
      `deno test -A scripts/build-plugin-payload_test.ts`.
- [x] **`build-plugin-payload.ts` chmod carve-out removed.** No
      `Deno.chmod` call for `bin/*.sh` (the TS launcher does not
      need an exec bit). Acceptance tuple — FR-E74 + Evidence:
      `! grep -E "chmod.*sh" scripts/build-plugin-payload.ts`.
- [x] **Pure helpers exported and unit-tested** for: version
      extraction from plugin.json, workflow-dir resolution priority
      chain, `--include` arg enumeration. Acceptance tuple — FR-E74
      + Test:
      `scripts/launch_test.ts::FR-E74 resolveWorkflowDir prefers FLOWAI_WORKFLOW`,
      `FR-E74 resolveWorkflowDir falls back to github-inbox on ambiguity`,
      `FR-E74 resolveWorkflowDir returns null when no candidate exists`.
- [x] **One end-to-end test still spawns the full pipeline** via
      `deno run -A bin/launch.ts` to cover argv plumbing + child
      exec + exit-code propagation. The fake-`deno` shim pattern
      from the bash test suite carries over for the compile step.
      Acceptance tuple — FR-E74 + Test:
      `scripts/launch_test.ts::FR-E74 end-to-end launcher compiles on first call and execs cached binary on second`
      + Evidence: `deno task check`.
- [x] **Signal forwarding verified.** Test confirms that
      `SIGINT`/`SIGTERM` sent to the launcher process propagates to
      the spawned binary (so Claude Code's shutdown signal reaches
      the MCP server). Acceptance tuple — FR-E74 + Test:
      `scripts/launch_test.ts::FR-E74 launcher forwards SIGTERM to child binary`
      + Evidence: `deno task check`.
- [x] **SRS §3.74 amended** to reflect TS launcher + new `.mcp.json`
      command shape (drop "bash launcher" / "POSIX shell" prose;
      add "Deno-runtime launcher with stdio + signal passthrough").
      Acceptance tuple — FR-E74 + manual — korchasa + Evidence:
      `grep -E 'launch\\.ts|Deno-runtime' documents/requirements-engine/07-mcp-and-plugin-runtime.md`.
- [x] **`AGENTS.md` updated** with the TS launcher fact (drop the
      "bash launcher" sentence). Acceptance tuple — FR-E74 + manual
      — korchasa + Evidence: `grep -E 'launch\\.ts' AGENTS.md`.
- [x] **`claude-plugin/README.md` updated** ("bash launcher" →
      "Deno launcher"). Acceptance tuple — FR-E74 + manual —
      korchasa + Evidence: `grep -E 'launch\\.ts' claude-plugin/README.md`.
- [x] **Full check green:** `deno task check` exits 0; `deno run -A
      scripts/sync-plugins-repo.ts --dry-run` lists `bin/launch.ts`
      in the payload (82 files vs 81 baseline), no `bin/launch.sh`.
      Acceptance tuple — FR-E74 + Evidence: `dist/plugin-payload/plugins/flowai-workflow/bin/launch.ts`
      present after staged add.
- [ ] **Manual smoke (manual — korchasa):** in a fresh Claude Code
      session with the plugin re-synced via
      `deno task sync-plugins-local`, `/mcp` lists `flowai-workflow`
      with the seven tools after first call. Acceptance tuple —
      FR-E74 + manual — korchasa + Evidence: transcript in PR body.

## Solution

Variant 3 — Deno/TS launcher with lazy compile. Single file
`bin/launch.ts`, zero external imports (only `Deno.*` builtins
to avoid cold-start cost + offline-resilience). Bash launcher is
deleted, not kept side-by-side.

### Phase 1 — Pure-helper module + RED tests

**File:** `claude-plugin/plugins/flowai-workflow/bin/launch.ts` (new)
**File:** `scripts/launch_test.ts` (rewrite from bash-spawn to
in-process + one integration test)

Public surface (exported for tests, none consumed outside the
launcher itself):

```ts
/** Read the `version` field from `<root>/.claude-plugin/plugin.json`. */
export async function readPluginVersion(pluginRoot: string): Promise<string>;

/** Recursively enumerate files under `<root>/.flowai-workflow/`,
 *  returning paths suitable for `deno compile --include`. */
export async function enumerateBundledWorkflowFiles(
  pluginRoot: string,
): Promise<string[]>;

/** Resolve which workflow folder the `mcp` subcommand should target.
 *  Priority: env.FLOWAI_WORKFLOW → projectRoot/.flowai-workflow/<single>
 *  → projectRoot/.flowai-workflow/github-inbox → null. */
export interface ResolveOptions {
  env: Record<string, string | undefined>;
  /** Default: env.CLAUDE_PROJECT_DIR ?? Deno.cwd(). */
  projectRoot?: string;
  /** For tests: override the readDir / stat fns. */
  fs?: {
    readDir(path: string): AsyncIterable<{ name: string; isDirectory: boolean }>;
    statExists(path: string): Promise<boolean>;
  };
}
export async function resolveWorkflowDir(
  opts: ResolveOptions,
): Promise<string | null>;

/** Compose `deno compile` args. Pure. */
export function buildCompileArgs(
  cliEntry: string,
  includes: string[],
  outputTmp: string,
): string[];
```

Tests added in this phase (RED first — assertions fail because
`launch.ts` doesn't exist yet; GREEN once implementation lands):

- `FR-E74 readPluginVersion extracts version field`
- `FR-E74 readPluginVersion throws on missing version`
- `FR-E74 enumerateBundledWorkflowFiles returns sorted relative paths`
- `FR-E74 enumerateBundledWorkflowFiles returns [] when dir missing`
- `FR-E74 resolveWorkflowDir prefers FLOWAI_WORKFLOW env override`
- `FR-E74 resolveWorkflowDir returns the single candidate folder`
- `FR-E74 resolveWorkflowDir falls back to github-inbox on ambiguity`
- `FR-E74 resolveWorkflowDir returns null when no candidate exists`
- `FR-E74 buildCompileArgs interleaves --include per file`

### Phase 2 — Main launcher logic (GREEN)

Implement `if (import.meta.main) { await main(); }` calling a
private `async function main(): Promise<never>`:

1. Read `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` from env (fail
   with clear error if either missing — this is the contract with
   Claude Code).
2. `version = await readPluginVersion(pluginRoot)`.
3. `bin = ${pluginData}/bin/flowai-workflow-${version}`.
4. If `bin` not present (or not executable on POSIX):
   - No Deno preflight needed — the launcher is itself running
     under Deno, so Deno is by definition available.
   - `mkdir -p $(dirname bin)`.
   - `includes = await enumerateBundledWorkflowFiles(pluginRoot)`
     (recursive walk via `Deno.readDir` with a depth-first recursion
     into directories — `find -type f` parity).
   - `tmp = bin + ".tmp." + Deno.pid`.
   - `args = buildCompileArgs(pluginRoot + "/engine/cli.ts", includes, tmp)`
     — args MUST include `--allow-all` and `--no-check` (matches
     `scripts/compile.ts` and the deleted `launch.sh`).
   - Spawn `"deno"` (PATH-lookup, NOT `Deno.execPath()`) so test
     fixtures can shim it. If `.status.code !== 0`, exit with that
     code (stderr already inherited so the user sees real diagnostic).
   - `await Deno.rename(tmp, bin)` (same filesystem — both paths
     under `$CLAUDE_PLUGIN_DATA`). On POSIX, set exec bit via
     `Deno.chmod(bin, 0o755)`.
5. Resolve subcommand:
   - If `Deno.args[0] === "mcp"`:
     - `wf = await resolveWorkflowDir({ env: Deno.env.toObject() })`.
     - `binArgs = wf !== null ? ["mcp", wf, ...rest] : ["mcp",
       "--no-workflow", ...rest]`.
   - Else: `binArgs = [...Deno.args]`.
6. Spawn the binary as child:
   ```ts
   const child = new Deno.Command(bin, {
     args: binArgs,
     stdin: "inherit",
     stdout: "inherit",
     stderr: "inherit",
   }).spawn();
   ```
7. Signal forwarding — register listeners BEFORE awaiting status:
   ```ts
   for (const sig of ["SIGINT", "SIGTERM"] as const) {
     try {
       Deno.addSignalListener(sig, () => {
         try { child.kill(sig); } catch { /* already exited */ }
       });
     } catch (e) {
       // Windows: addSignalListener rejects SIGTERM with TypeError.
       // SIGINT still works via the console-native Ctrl+C path inside
       // Deno; SIGTERM-on-Windows is documented as unsupported.
       if (!(e instanceof TypeError)) throw e;
     }
   }
   ```
8. `const { code, signal } = await child.status;` — `code` is `null`
   when the child died from a signal. Propagate as:
   `Deno.exit(code ?? 1)`. (We don't decode `signal` to `128+N`
   because Deno's `signal` is the string name, not a number, and
   Claude Code only cares about non-zero vs zero.)

### Phase 3 — Integration test + signal forwarding test

In `scripts/launch_test.ts`:

- `FR-E74 end-to-end launcher compiles on first call and execs
  cached binary on second` — fixture: temp `CLAUDE_PLUGIN_ROOT` with
  stub `plugin.json` + stub `engine/cli.ts`; fake `deno` shim on
  PATH that materialises a tiny bash stub at `--output`; spawn
  `deno run -A bin/launch.ts --version` twice; assert fake-deno log
  has one entry, second call uses cached binary.
- `FR-E74 launcher forwards SIGTERM to child binary` — fixture's
  stub binary writes a marker file on `trap SIGTERM`; spawn
  launcher, wait 100ms, send SIGTERM to launcher process, assert
  marker file appears within 1s and launcher exits with the
  signal's conventional exit code (128 + 15 = 143 on Linux/macOS).
- `FR-E74 launcher fails fast without Deno when binary missing` —
  PATH scrubbed of deno; assert exit code 127 + install-link in
  stderr.
- `FR-E74 launcher resolves single workflow folder for mcp` — same
  as old test but driven through `deno run launch.ts`.
- Existing bash-spawning fixtures and the fake-`deno` shim's
  python3-based argv logging stay (still useful for the binary stub
  in the new TS-launcher tests).

### Phase 4 — `.mcp.json` + `build-plugin-payload.ts`

**File:** `claude-plugin/plugins/flowai-workflow/.mcp.json` (edit)

```json
{
  "mcpServers": {
    "flowai-workflow": {
      "command": "deno",
      "args": ["run", "-A", "${CLAUDE_PLUGIN_ROOT}/bin/launch.ts", "mcp"]
    }
  }
}
```

**File:** `scripts/build-plugin-payload.ts` (edit) — remove the
`chmod 0o755` for `bin/*.sh` (no `.sh` file ships anymore). Leave
the verbatim-copy branch intact: `bin/launch.ts` lands at
`plugins/flowai-workflow/bin/launch.ts` automatically.

**File:** `scripts/build-plugin-payload_test.ts` (edit) — rename
the test "FR-E74 payload includes launcher with executable bit"
to "FR-E74 payload includes launcher" (no chmod assertion); update
the `.mcp.json` test to assert `command: "deno"` and the new args
array.

**File:** `claude-plugin/plugins/flowai-workflow/bin/launch.sh` —
delete.

### Phase 5 — Docs (SRS / AGENTS / plugin README / task DoD)

- `documents/requirements-engine/07-mcp-and-plugin-runtime.md`
  §3.74: replace "bash launcher (`bin/launch.sh`)" with "Deno-runtime
  launcher (`bin/launch.ts`)"; replace the `.mcp.json` snippet to
  show `command: "deno"`. Drop the "POSIX shell" / "`mv` from a
  `.tmp.<pid>` sibling" prose; keep the atomic-rename invariant in
  generic terms.
- `AGENTS.md` (Plugin payload cross-repo sync section): swap "bash
  launcher `bin/launch.sh`" → "Deno-runtime launcher `bin/launch.ts`".
  Note the launcher now requires Deno on every call (was: only
  first call), but Deno is already required for compile — net no
  change.
- `claude-plugin/README.md`: change layout block to show
  `bin/launch.ts`. Update `.mcp.json` snippet. "Auto-wired MCP
  server" section: keep the `deno compile` first-call latency
  caveat.
- Original task file
  `documents/tasks/2026/05/plugin-self-contained-runtime.md`: add a
  one-line note in **Follow-ups** that the launcher was migrated to
  TS in `ts-launcher.md`. Do NOT downgrade its `status` (it's
  already shipped); just leave a forward pointer.

### Verification

```sh
deno task check          # all tests + lint + fmt + token budget
deno task sync-plugins -- --dry-run | grep -E "launch\\.ts|launch\\.sh"
# Expected: only launch.ts; no launch.sh in the payload listing.
ls claude-plugin/plugins/flowai-workflow/bin/   # only launch.ts
```

### Error-handling strategy

- Missing `CLAUDE_PLUGIN_ROOT` or `CLAUDE_PLUGIN_DATA` env: fail
  with `Deno.exit(2)` and a stderr message naming the missing var.
  This indicates a plugin-manager bug, not a user error.
- Missing `plugin.json` or missing `version` field: fail with
  `Deno.exit(2)` + path in stderr.
- `deno compile` non-zero exit: propagate exit code from child.
  No partial `bin` file left behind (the `.tmp` sibling stays for
  debugging; the launcher does NOT delete it on failure so the
  user can inspect — only on success it's renamed onto `bin`).
- `Deno.rename` failure: surface verbatim (`Deno.exit(2)`). Cross-fs
  rename failures are not expected because both `tmp` and `bin`
  live under `$CLAUDE_PLUGIN_DATA/bin/`.
- Child binary exit code: `Deno.exit(code ?? 1)` (signal-kill maps
  to non-zero exit so Claude Code reports the spawn as failed).

### Files to create / modify

- **New:** `claude-plugin/plugins/flowai-workflow/bin/launch.ts`
- **Delete:** `claude-plugin/plugins/flowai-workflow/bin/launch.sh`
- **Rewrite:** `scripts/launch_test.ts` (in-process helpers + 4
  integration tests; drop bash-spawning fixtures except the
  fake-`deno` shim's binary-stub generator, which carries over)
- **Edit:** `claude-plugin/plugins/flowai-workflow/.mcp.json`
- **Edit:** `scripts/build-plugin-payload.ts` (drop chmod carve-out)
- **Edit:** `scripts/build-plugin-payload_test.ts` (update two tests)
- **Edit:** `documents/requirements-engine/07-mcp-and-plugin-runtime.md`
- **Edit:** `AGENTS.md`
- **Edit:** `claude-plugin/README.md`
- **Edit:** `documents/tasks/2026/05/plugin-self-contained-runtime.md`
  (Follow-ups forward pointer)

### Rejected alternatives

- **Keep bash + shore up edges**: keeps the bash 4+ / python3 host
  dependency, no Windows path, dual test surface for future `.ps1`.
- **python3 launcher**: foreign stack for this Deno-native project;
  splits Windows path again (`os.execvp` posix-only).
- **No launcher (`deno run cli.ts` from `.mcp.json`)**: drops the
  FR-E74 compile-cache contract (every MCP spawn pays 1–3s Deno
  cold-start + dep resolution). Equivalent to reverting half of
  FR-E74. Off-table per the parent task's stated intent.

### Out of scope

- Switching `.mcp.json` `command` from `"deno"` to an absolute path
  resolved at install time. Deno's location varies across hosts;
  PATH lookup is the standard approach (hindsight-memory plugin
  does the same with `bash`).
- Compiling `launch.ts` itself to a binary (recursive bootstrap
  problem — who compiles the launcher?). If the 200ms Deno cold-
  start ever becomes a real complaint, revisit then.
- Migrating `scripts/compile.ts` (the CI cross-target release
  script) to share logic with the launcher's compile call. They
  have different concerns (4 cross-targets vs. one host target).

