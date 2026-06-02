---
date: "2026-06-02"
status: done
implements: [FR-E78, FR-E74]
tags: [engine, plugin, distribution, runtime, ci, windows]
related_tasks:
  - 2026/05/plugin-self-contained-runtime.md
  - 2026/05/ts-launcher.md
  - 2026/05/plugin-ci-mcp-hooks-smoke.md
---
# Plugin invokes pre-installed `flowai-workflow mcp` (supersedes FR-E74 launcher)

## Goal

Make `flowai-workflow` (the engine CLI) a **documented precondition** of
the Claude Code / Codex plugin and have the plugin's `.mcp.json` invoke
`flowai-workflow mcp` directly — no payload-bundled launcher, no
lazy-compile, no downloaded binary. To support that, CI publishes
cross-arch engine binaries (including Windows) as **GitHub Release
assets with sha256 sidecars** so operators can install the binary
without Deno. The launcher introduced by FR-E74
(`plugin-src/shared/bin/launch.ts` + lazy `deno compile`) is
superseded: it solves a problem that doesn't exist once the engine
binary is a precondition.

## Overview

### Context

- **Why the launcher is over-engineered for our case.** FR-E74's
  payload-bundled launcher (`bin/launch.ts`) was designed to make
  the plugin self-contained: ship engine TS sources + a launcher,
  let Deno compile on first call, cache. But every user of the
  plugin is, by definition, already using flowai-workflow — they
  either ran `deno install -A jsr:@korchasa/flowai-workflow` or
  installed a release binary. The launcher therefore solves a
  non-problem: it adds a download/compile dance for a binary that's
  already on PATH.
- **The simpler model.** Treat `flowai-workflow` as a precondition
  (same as `claude`, `codex`, `git` — none of which the plugin
  bundles). The plugin's `.mcp.json` invokes `flowai-workflow mcp`
  on POSIX and Windows hosts. If the binary is missing, the MCP host
  surfaces the spawn failure verbatim and the README instructs the
  operator: «install flowai-workflow first». This is the same
  contract `npx <mcp-server>` and `uvx <mcp-server>` already use for
  Node / Python MCP servers in the wild.
- **What CI already does.** Today CI compiles four targets via
  `scripts/targets.json` (linux-x86_64, linux-arm64, darwin-x86_64,
  darwin-arm64), uploads each as a workflow artifact, and a follow-up
  `attach-binaries` job downloads them via `actions/download-artifact`
  and runs `gh release create … dist/*` to attach all four to the
  release tag (`ci.yml:285-325`). Confirmed against `v0.7.16`. So the
  precondition story («install flowai-workflow first») is already
  served — there ARE public release-asset URLs. FR-E78's CI delta is
  just (a) add `x86_64-pc-windows-msvc` to the matrix and (b)
  generate `<artifact>.sha256` sidecars next to each binary so
  operators can verify integrity. NO new asset-upload step is needed
  — `dist/*` glob picks the sidecars up automatically.
- **What goes away.** The payload drops
  `plugin-src/shared/bin/launch.ts`, every reference to it, and the
  bundled `engine/` TS sources (the launcher needed them for
  `deno compile`; the binary doesn't). `.mcp.json` configs change
  from `deno run -A ... launch.ts` to `flowai-workflow mcp`. The
  `scripts/launch.ts` / `scripts/launch_test.ts` files (and their
  cache / SIGINT / cold-start machinery) are deleted. Plugin payload
  shrinks substantially (most of the 1.5 MB was the engine TS tree).
- **What stays.** FR-E70 (plugin distribution), FR-E72 (cross-repo
  payload sync), FR-E73 (embedded MCP server with seven tools)
  unchanged. FR-E70's `dist/plugin-payload/` build still happens;
  it just ships fewer files. FR-E72's sync to
  `korchasa/flowai-workflow-plugins` still runs. FR-E73's tools
  (now reachable via `flowai-workflow mcp ...`) still work
  byte-identically.
- **Windows scope caveat.** Even when `flowai-workflow mcp` starts
  cleanly on Windows, workflows that use `before` / `after` shell
  hooks or HITL `ask_script` / `check_script` still depend on POSIX
  `sh` (see `agent.ts:514` `new Deno.Command("sh", …)`). FR-E78
  guarantees only that the MCP server itself starts and answers
  `initialize` + `tools/list` on Windows. Full Windows workflow
  support is out of scope (separate FR track).

### Current State

- `plugin-src/shared/bin/launch.ts` — TS launcher; lazy `deno compile`
  on first invocation; cache at `$CLAUDE_PLUGIN_DATA|FLOWAI_PLUGIN_DATA|CODEX_HOME|$HOME/bin/flowai-workflow-<version>`.
- `plugin-src/claude/plugins/flowai-workflow/.mcp.json` invokes
  `deno run -A --no-config ${CLAUDE_PLUGIN_ROOT}/bin/launch.ts`.
- `plugin-src/codex/plugins/flowai-workflow/.mcp.json` invokes
  `deno run -A --no-config ./bin/launch.ts` with `cwd = "."`.
- `scripts/build-plugin-payload.ts` copies `plugin-src/shared/**`
  (including `bin/launch.ts` and `engine/` TS) into both host roots.
- `scripts/compile.ts` reads `scripts/targets.json`:
  - `x86_64-unknown-linux-gnu` → `flowai-workflow-linux-x86_64`
  - `aarch64-unknown-linux-gnu` → `flowai-workflow-linux-arm64`
  - `x86_64-apple-darwin` → `flowai-workflow-darwin-x86_64`
  - `aarch64-apple-darwin` → `flowai-workflow-darwin-arm64`
- `.github/workflows/ci.yml` `build` matrix calls
  `deno task compile --target <triple>` and uploads via
  `actions/upload-artifact`. A separate `attach-binaries` job
  (`ci.yml:285-325`) downloads the matrix artifacts and runs
  `gh release create "$TAG" … dist/*` to attach them to the
  auto-created release. No `.sha256` sidecars produced today.
- `scripts/plugin-install-acceptance_test.ts` exercises the
  installed plugin's `.mcp.json` literal command, sends MCP
  `initialize` + `tools/list`. Today the command is
  `deno run -A ... launch.ts`. After FR-E78 it becomes
  `flowai-workflow mcp`.
- `cli.ts` already exposes `mcp` subcommand
  (`cli.ts:runMcpSubcommand` per FR-E73 / FR-E74). FR-E78 reuses
  it verbatim — no engine code changes.
- `documents/requirements-engine/07-mcp-and-plugin-runtime.md` 3.74
  documents the launcher contract.

### Constraints

- **Precondition contract — explicit.** README + plugin install docs
  state: «Install `flowai-workflow` first: `deno install -A
  jsr:@korchasa/flowai-workflow` OR download a release binary from
  GitHub Releases, verify sha256, place on PATH. Then install the
  plugin.» Without this the plugin fails fast at MCP handshake — by
  design, no silent fallback.
- **Fail-fast on missing binary.** If `flowai-workflow` is not on
  PATH, the MCP host surfaces the OS spawn error (`ENOENT: no such
  file or directory: flowai-workflow`). README ties that error to
  the install step. No retry, no inline download — keeps the plugin
  payload binary-free and the install story honest.
- **Backward compatibility — none required.** This is a deliberate
  break of the FR-E74 contract. The plugin is pre-1.0, the only
  current consumers are dogfood (this repo) and the in-progress
  marketplace install. Documenting the precondition in the release
  notes for the version that ships FR-E78 is sufficient.
- **CI release attachment — atomic.** Each binary + its sha256
  sidecar must be uploaded to the release in the **same job step**
  that produced them. Half-uploaded releases (binary without sidecar)
  are a supply-chain hazard and must fail the release job.
- **No engine TS in payload.** `scripts/build-plugin-payload.ts`
  must STOP copying `engine/**` and `bin/launch.ts` into the host
  roots. This is a hard invariant — otherwise payload doesn't
  shrink and operators get confused about which copy of the engine
  actually runs.
- **sha256 verification — operator-side, not plugin-side.**
  Verification happens during the `deno install` / release-asset
  download step the operator performs once. The plugin itself never
  computes a hash. This keeps the plugin code minimal and avoids
  reimplementing `Get-FileHash` / `sha256sum` parity inside the
  plugin runtime.
- **`flowai-workflow mcp` subcommand contract — preserved.** The
  plugin assumes `cli.ts mcp` keeps the same argv shape and stdio
  protocol it has today. Changes to that contract are blocked until
  FR-E78 ships (else the precondition story drifts).

## Definition of Done

- [ ] **FR-E78**: Plugin manifests
      (`plugin-src/claude/plugins/flowai-workflow/.mcp.json` and
      `plugin-src/codex/plugins/flowai-workflow/.mcp.json`) declare
      `command = "flowai-workflow"`, `args = ["mcp"]` and no
      Deno-specific argv. Test:
      `scripts/build-plugin-payload_test.ts::FR-E78 plugin manifests
      invoke flowai-workflow mcp directly`. Evidence:
      `deno task test scripts/build-plugin-payload_test.ts`.
- [ ] **FR-E78**: `scripts/build-plugin-payload.ts` no longer copies
      `bin/launch.ts` or the `engine/` TS tree into either host root.
      Resulting payload classification mentions neither. Test:
      `scripts/build-plugin-payload_test.ts::FR-E78 payload excludes
      launch.ts and engine ts sources`. Evidence: `deno task test
      scripts/build-plugin-payload_test.ts`.
- [ ] **FR-E78**: `plugin-src/shared/bin/launch.ts` and
      `scripts/launch_test.ts` are deleted. `rg 'bin/launch\.ts'`
      against the repo returns no matches in source / tests
      (documents may reference the supersession history). Evidence:
      `rg 'bin/launch\.ts' --type ts`.
- [ ] **FR-E78**: `scripts/targets.json` and `scripts/compile.ts`
      include `x86_64-pc-windows-msvc` with artifact name
      `flowai-workflow-windows-x86_64.exe`. `deno task compile
      --target x86_64-pc-windows-msvc` produces a runnable binary.
      Test: `scripts/compile_test.ts::FR-E78 windows target compiles`.
      Evidence: `deno task test scripts/compile_test.ts`.
- [ ] **FR-E78**: `.github/workflows/ci.yml` `build` matrix produces
      a `<artifact>.sha256` sidecar via `sha256sum` (Linux runner)
      and uploads it as a workflow artifact alongside the binary.
      The existing `attach-binaries` job's `gh release create … dist/*`
      glob picks both files up automatically — no new release-attach
      step needed. Test:
      `scripts/ci_yaml_test.ts::FR-E78 ci emits sha256 sidecars next
      to each binary`. Evidence: `deno task test scripts/ci_yaml_test.ts`.
- [ ] **FR-E78**: `scripts/plugin-install-acceptance_test.ts` is
      updated so the install path no longer expects `deno run ...
      launch.ts`; instead it asserts the installed `.mcp.json`'s
      `command = "flowai-workflow"` and stubs / supplies a working
      `flowai-workflow` binary on the test PATH. Both Claude and
      Codex install scenarios pass. Test:
      `scripts/plugin-install-acceptance_test.ts::FR-E78 installed
      MCP config invokes flowai-workflow mcp` (Claude + Codex
      variants). Evidence: `deno task test
      scripts/plugin-install-acceptance_test.ts`.
- [ ] **FR-E78**: Add `### 3.78 FR-E78: Plugin Precondition + Release
      Binary Distribution` section to
      `documents/requirements-engine/07-mcp-and-plugin-runtime.md`
      with the canonical FR field set (`Description`, `Tasks`,
      `Motivation`, `Supersedes: FR-E74`, `Dep: FR-E70, FR-E72`,
      `Acceptance criteria`). Register the FR in
      `documents/requirements-engine.md` index AND
      `documents/index.md`. Evidence: `rg 'FR-E78'
      documents/requirements-engine.md documents/index.md`.
- [ ] **FR-E74**: Mark superseded — flip frontmatter / inline marker
      on the FR-E74 SRS section: `**Status:** superseded by FR-E78`,
      remove the `[x]` acceptance ticks (history preserved in git).
      Evidence: `rg -n 'FR-E74' documents/requirements-engine/07-mcp-and-plugin-runtime.md`.
- [ ] **FR-E78**: Add corresponding paragraph to
      `documents/design-engine/03-subsystems.md` describing the new
      dispatch flow (`flowai-workflow mcp` direct invocation; no
      launcher; binary distribution channel). Evidence:
      `rg 'FR-E78' documents/design-engine/`.
- [ ] **FR-E78**: `README.md` install section documents the
      precondition. Verify FIRST that `deno install -A
      jsr:@korchasa/flowai-workflow` actually exposes a
      `flowai-workflow` binary on PATH (today `deno.json#exports`
      lists only `.` and `./engine`; binary-install via JSR may need
      either a renamed export or `-n flowai-workflow` flag).
      Document the exact command that works. Fallback path:
      `curl -L https://github.com/.../releases/.../flowai-workflow-<os>-<arch>
      -o flowai-workflow && sha256sum -c flowai-workflow.sha256 &&
      chmod +x flowai-workflow && mv flowai-workflow /usr/local/bin/`
      (or platform equivalent). Plugin install docs link to it.
      Evidence: `rg 'flowai-workflow mcp' README.md`.
- [ ] **FR-E78**: `cli_test.ts::FR-E78 mcp subcommand argv
      contract is stable` asserts `cli.ts mcp` accepts the literal
      argv shape `flowai-workflow mcp` (no required flags), starts
      the MCP server, and exits cleanly on stdin close.
      Evidence: `deno task test cli_test.ts`.
- [ ] **FR-E78**: `aarch64-unknown-linux-gnu` runtime smoke. EITHER
      add a CI step that runs the cross-compiled ARM binary under
      QEMU (`--platform linux/arm64` Docker or `qemu-aarch64`) and
      asserts `flowai-workflow mcp` answers `initialize` OR mark the
      ARM target explicitly as «cross-compiled, runtime untested in
      CI» in `README.md` install section. Evidence: either the CI
      step output, or `rg 'cross-compiled' README.md`.

## Solution

Single variant — no meaningful trade-offs once the precondition model is accepted.

### Files to modify / create / delete

**Delete**
- `plugin-src/shared/bin/launch.ts` — superseded by direct `flowai-workflow mcp` invocation.
- `scripts/launch_test.ts` — tests the deleted launcher.
- Any `plugin-src/shared/engine/` mirror of the engine TS tree, IF
  `scripts/build-plugin-payload.ts` is the one that creates it
  (verify against current behaviour; payload is regenerated, not
  source-tracked, so the deletion may be entirely in the build
  script).

**Modify**
- `plugin-src/claude/plugins/flowai-workflow/.mcp.json` — change:
  ```json
  {
    "mcpServers": {
      "flowai-workflow": {
        "type": "stdio",
        "command": "flowai-workflow",
        "args": ["mcp"]
      }
    }
  }
  ```
  Drop every `${CLAUDE_PLUGIN_ROOT}` / `deno` / `launch.ts` reference.
  Workflow resolution stays env-driven (`FLOWAI_WORKFLOW` /
  `CLAUDE_PROJECT_DIR/.flowai-workflow/<name>` — these are read by
  `cli.ts mcp` itself, no plugin-side wiring needed).
- `plugin-src/codex/plugins/flowai-workflow/.mcp.json` — same
  `command = "flowai-workflow"`, `args = ["mcp"]`. Codex
  plugin-root layout (`cwd = "."`) no longer matters because we don't
  shell out to a relative path. Drop the `cwd` field.
- `scripts/build-plugin-payload.ts` — drop the
  `plugin-src/shared/bin/launch.ts` and `engine/**` copy steps.
  `classifyPayloadFile` returns `null` (excluded) for those paths.
  Add a regression test that the payload contains neither.
- `scripts/targets.json` — add entry:
  ```json
  {
    "target": "x86_64-pc-windows-msvc",
    "artifact": "flowai-workflow-windows-x86_64.exe"
  }
  ```
- `scripts/compile.ts` — no schema change (it already iterates
  `TARGETS`), but verify that Windows `deno compile` works against
  `cli.ts` (no `Deno.Command("sh", …)` at module load — runtime
  POSIX-shell use stays inside hook execution, not compile).
- `.github/workflows/ci.yml` `build` job — minimal extension:
  1. After `deno task compile --target <triple>` produces
     `flowai-workflow-<os>-<arch>[.exe]`, run
     `sha256sum flowai-workflow-<os>-<arch>[.exe] > flowai-workflow-<os>-<arch>[.exe].sha256`.
  2. Update the `actions/upload-artifact` step's `path:` pattern so
     the sidecar is uploaded alongside the binary (e.g. switch from
     `path: ${{ matrix.artifact }}` to a pattern that catches both,
     or list both explicitly).
  3. No new release-attach step. The existing `attach-binaries` job
     (`ci.yml:285-325`) downloads via `actions/download-artifact`
     (with `merge-multiple: true`), then runs
     `gh release create "$TAG" … dist/*` — the `dist/*` glob picks
     up the sidecars automatically without code changes.
  4. Atomicity is already provided by the single `gh release create
     … dist/*` invocation — failure of that one call rolls back the
     whole asset set; partial-release is impossible.
- `scripts/plugin-install-acceptance_test.ts` — update the test
  harness:
  - Build the plugin payload (no `launch.ts` in it).
  - Install into a tmpdir-rooted `CLAUDE_PLUGIN_DATA` /
    `CODEX_HOME`.
  - Drop a fake `flowai-workflow` shell script onto a tmpdir PATH
    prefix that proxies to the locally-compiled engine binary
    (`deno task compile --target $(uname -m)-...`). Run the
    installed `.mcp.json` command, send MCP `initialize` +
    `tools/list`, assert success + the expected FR-E73 tool names.
  - Both Claude and Codex variants share the same harness — the
    only difference is the install layout.
- `cli.ts` / `cli_test.ts` — no production code change. The `mcp`
  subcommand already exists. Confirm `cli.ts:runMcpSubcommand`'s
  argv contract is `flowai-workflow mcp [--no-workflow]
  [--workflow <dir>]` and that `cli.ts mcp` is the entry the plugin
  will hit. Add a test
  `cli_test.ts::FR-E78 mcp subcommand starts MCP server reading
  workflow from env`.
- `documents/requirements-engine/07-mcp-and-plugin-runtime.md` —
  insert new section `### 3.78 FR-E78: Plugin Precondition + Release
  Binary Distribution` with canonical fields. In section 3.74
  (FR-E74), prepend `**Status:** superseded by FR-E78` per the
  canonical field set, and remove `[x]` from the acceptance ticks
  that no longer apply.
- `documents/requirements-engine.md` index — insert
  `FR-E78 (Plugin Precondition + Release Binary Distribution) →
  07-mcp-and-plugin-runtime` row in the FR-ID → Section File map.
- `documents/index.md` — add FR-E78 row under `## FR`.
- `documents/design-engine/03-subsystems.md` — append paragraph
  describing the new dispatch flow.
- `README.md` — install section: precondition install for
  `flowai-workflow`; plugin install steps; sha256 verification
  command.

**Create**
- `scripts/ci_yaml_test.ts` (NEW) — parses
  `.github/workflows/ci.yml` and asserts:
  1. `build` job emits a `sha256sum` step that writes
     `<artifact>.sha256` next to `<artifact>`.
  2. The `actions/upload-artifact` `path:` field covers both the
     binary and the sidecar (regression lock — if someone narrows
     it to just the binary, the sidecar drops out of `dist/*`
     during `attach-binaries`).
  3. Windows matrix entry exists with artifact ending in `.exe`.
  4. The existing `attach-binaries` job's `gh release create … dist/*`
     glob is preserved (regression lock — narrowing the glob would
     re-introduce the missing-asset failure mode).

### Implementation order (RED → GREEN per atomic step)

1. **RED**: write
   `scripts/build-plugin-payload_test.ts::FR-E78 plugin manifests
   invoke flowai-workflow mcp directly` + `::FR-E78 payload
   excludes launch.ts and engine ts sources`.
   **GREEN**: update both `.mcp.json` files and
   `scripts/build-plugin-payload.ts:classifyPayloadFile` to exclude
   launcher / engine TS.
   **REFACTOR/CHECK**: `deno task check`.
2. **RED**: write
   `scripts/compile_test.ts::FR-E78 windows target compiles`.
   **GREEN**: add Windows entry to `scripts/targets.json`. Run
   `deno task compile --target x86_64-pc-windows-msvc` locally to
   confirm it produces a `flowai-workflow-windows-x86_64.exe` file.
   **CHECK**: `deno task check`.
3. **RED**: write `scripts/ci_yaml_test.ts`.
   **GREEN**: add `sha256sum` step to `ci.yml` `build` job and
   widen the `upload-artifact` `path:` to include the sidecar.
   No release-attach step changes — `attach-binaries` glob already
   covers `dist/*`.
   **CHECK**: `deno task check` (lints the YAML test, not the
   workflow runtime — pipeline change is verified by the next CI
   run on merge).
4. **RED**: rewrite
   `scripts/plugin-install-acceptance_test.ts` cases with the new
   command shape + the `flowai-workflow`-on-PATH fake.
   **GREEN**: ensure the install path actually runs against the new
   manifest format. Fix any drift in the install code path.
   **CHECK**: `deno task check`.
5. **RED**: write `cli_test.ts::FR-E78 mcp subcommand starts MCP
   server reading workflow from env`.
   **GREEN**: verify `cli.ts mcp` already satisfies the assertion
   (it should — no production change expected). If a gap surfaces,
   patch it in `cli.ts` minimally.
   **CHECK**: `deno task check`.
6. **GREEN**: delete `plugin-src/shared/bin/launch.ts` and
   `scripts/launch_test.ts`. Sweep `rg 'bin/launch\.ts'` for any
   stale references and fix them.
   **CHECK**: `deno task check`.
7. **GREEN**: update docs — SRS section 3.78 (new), section 3.74
   (status: superseded), SRS index, `documents/index.md`,
   SDS subsystem doc, `README.md` install section.
   **CHECK**: `deno task check` (includes `FR Canonical Field Set`
   and `Docs Token Budget` validators).

### Error-handling strategy

- **Missing `flowai-workflow` binary on host PATH.** OS spawn
  failure surfaces directly via the MCP host's stderr. README ties
  the error to the precondition install step. No retry, no inline
  download. Acceptance test
  `::FR-E78 spawn error surfaces when flowai-workflow absent` (added
  inside `plugin-install-acceptance_test.ts`) verifies the failure
  mode is loud and clear.
- **Sha256 mismatch on operator-side install.** Operator's
  responsibility — `sha256sum -c` (or `Get-FileHash`) exits non-zero
  and the operator does not place the binary on PATH. We document
  this in README.
- **CI `gh release create … dist/*` failure.** The existing
  `attach-binaries` job uploads all `dist/*` in one invocation;
  failure rolls back the entire asset set — binary-and-sidecar
  invariant is preserved by atomicity, no special handling needed.
- **Engine `cli.ts mcp` failure.** Pre-existing FR-E73 / FR-E74
  no-workflow diagnostic path stays; FR-E78 changes only the
  invocation, not the server behaviour.

### Verification commands

- `deno task check` — formatter + lint + type + full test suite
  (1064+ tests; FR-E78 adds ~10).
- `deno task compile --target x86_64-pc-windows-msvc` — confirms
  Windows compile works locally on the developer machine. (Real
  CI verification arrives once the workflow change ships.)
- `deno task sync-plugins -- --dry-run` — confirms the payload
  classification dropped `launch.ts` and `engine/`.
- `deno task test scripts/plugin-install-acceptance_test.ts` —
  end-to-end install acceptance against the new manifest format.
- `rg 'bin/launch\.ts' --type ts` — should return zero matches
  after step 6.
- `rg 'FR-E78' documents/` — confirms every doc cross-link landed.

### Implementation-order addenda

- **Step 6 (delete launcher)** — supersession is irreversible by
  design (FR-E74 has no rollback path once the precondition becomes
  the contract). Keep `git log -- plugin-src/shared/bin/launch.ts`
  accessible in history; do NOT squash the deletion into an
  unrelated commit.
- **Step 4 (acceptance-test rewrite)** — the `flowai-workflow`
  binary stub used in the test harness MUST live inside a per-test
  tmpdir prefixed onto `PATH` (`PATH=<tmp>/bin:$PATH`) with the
  parent test runner's PATH stripped. Otherwise the test could
  shell out to the operator's actually-installed `flowai-workflow`
  and produce false positives/negatives. Hermetic PATH isolation is
  a regression lock — add an explicit assertion that `which
  flowai-workflow` resolves inside `<tmp>/bin`.
- **Step 7 (docs)** — the GREEN commit message for the
  manifest/launcher change MUST carry a `BREAKING CHANGE:` footer
  so standard-version emits a MAJOR bump and `CHANGELOG.md` flags
  the supersession. Without that footer the release is silently
  treated as a feature bump and operators miss the install-step
  change in release notes.

### Follow-ups

- **FR-E79 (deferred)** — Windows engine workflow runtime: replace
  `new Deno.Command("sh", { args: ["-c", …] })` calls in
  `agent.ts:514` (before/after hooks) and `hitl.ts`
  (`ask_script` / `check_script`) with a portable shell-resolution
  layer that uses `cmd.exe` / PowerShell on Windows. Out of scope
  for FR-E78 — placeholder so the gap stays visible.

### Out of scope (explicit)

- **Windows engine workflow runtime.** Even when the MCP server
  starts on Windows, workflows that use `before` / `after` shell
  hooks or HITL `ask_script` / `check_script` still depend on
  POSIX `sh` (`agent.ts:514`, `hitl.ts`). Resolving that requires
  rewriting shell-out calls in a portable way — separate FR.
- **Homebrew / Scoop / winget formulas** for `flowai-workflow`.
  Release binaries with sha256 sidecars are the foundation; the
  package-manager formulas can be added incrementally without
  touching FR-E78.
- **Multi-tenant binary caching across plugin installs.** Each
  operator installs `flowai-workflow` once on PATH; no per-plugin
  cache to manage.
- **Migration shim that detects old `launch.ts`-based installs and
  rewrites their `.mcp.json`.** Pre-1.0 plugin, dogfood-only —
  release notes document the breaking change, operators reinstall.
