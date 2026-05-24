---
date: "2026-05-24"
status: done
implements: [FR-E72]
tags: [distribution, claude-plugin, codex, dogfood, local-install]
related_tasks:
  - 2026/05/plugin-first-distribution.md
---

# Local Plugin Install Script — Mirror `flowai/flowai` Dogfood UX

## Goal

Give a framework developer working on `flowai-workflow` a single command
that rebuilds the plugin payload from the local checkout and re-installs
it into the host IDE(s) — Claude Code and Codex — at user scope, while
preserving any per-plugin `enabled = false` choice the user made before.
The command must be runnable repeatedly during an edit-loop without
manual cleanup of marketplace entries or config files.

`flowai/flowai` already ships exactly this UX via
`deno task sync-plugins-local` (script:
`/Users/korchasa/www/flowai/flowai/scripts/sync-plugins-local.ts`).
Mirror that contract so the two repos behave identically for
developers cross-cutting between them.

## Overview

### Context

`flowai-workflow` is distributed plugin-first (FR-E70/E72): the
authoritative payload is produced by
`scripts/build-plugin-payload.ts`, then shipped to
`korchasa/flowai-workflow-plugins` by
`scripts/sync-plugins-repo.ts --mode publish` from CI.

For local development the same script accepts
`--mode install-local`, which builds the payload into a tempdir and
runs `claude plugin marketplace add` + `claude plugin install` against
it. This works, but it is a thin happy-path:

- **Claude only.** Codex is not touched — a developer editing the
  plugin sees the change in Claude Code but not in Codex without manual
  `codex plugin marketplace remove/add/install` calls.
- **No state preservation.** It hard-installs the plugin even if the
  developer previously disabled it (`enabled = false`) at user scope;
  the next run silently re-enables it, losing the mute choice.
- **No auto-trigger.** There is no opt-in hook for "rebuild + sync on
  every `deno task test` / `deno task check`" — the developer has to
  remember to run sync-plugins manually after each plugin edit, which
  is the #1 source of "I changed it, why doesn't it apply" loops.

The reference `flowai/flowai/scripts/sync-plugins-local.ts` solves
all three by:

1. Capturing `claude plugin list --json` BEFORE marketplace removal,
   then routing previously-`enabled=false` plugins to a `skipped`
   bucket on reinstall (preserves mute).
2. Reconciling `~/.codex/config.toml` `[plugins."<x>@<marketplace>"]`
   tables: strips all stale entries, re-emits one per plugin advertised
   in `marketplace.json`, preserves prior `enabled` per plugin.
3. Probing Codex CLI for the `plugin marketplace` subcommand (≥0.130)
   and soft-skipping older versions; same soft-skip pattern when the
   CLI binary is missing entirely.
4. Reading an `AUTO_INSTALL_PLUGINS=true` dotenv / env flag so other
   tasks (`task-check`, `task-test`) can fan out into sync-plugins
   without forcing it on every run.

### Current State

- `scripts/sync-plugins-repo.ts` (lines 219-294) implements
  `--mode install-local`. The flow:
  1. `makeTempDir("flowai-plugin-payload-")`.
  2. `buildPluginPayload({engineRoot, version, outDir: tempDir})`.
  3. `claude plugin marketplace remove flowai-workflow` (allow-fail).
  4. `claude plugin marketplace add <tempDir>`.
  5. `claude plugin install flowai-workflow@flowai-workflow --scope user`
     (fall-back to `claude plugin update` on install failure).
  6. Returns `claudeMissing: true` if the `claude` binary is absent.
- No Codex code path. No `claude plugin list` capture. No dotenv hook.
- `deno.json#tasks.sync-plugins` is wired to `sync-plugins-repo.ts`.
- The marketplace bundles a single plugin (`flowai-workflow`); both
  `marketplace.json` (built by `scripts/build-plugin-payload.ts`) and
  the install command hardcode that single name.
- FR-E72 acceptance criteria (06-distribution-and-housekeeping.md L425-449)
  reference `install-local` as a soft-skip-without-claude path. Adding
  Codex broadens that AC; preserving disabled state and adding the
  dotenv hook are net-new behaviours requiring new ACs.

### Constraints

- **Engine domain-agnostic invariant** (AGENTS.md Key Decisions): the
  script lives under `scripts/`, never inside the engine source — it
  is dev tooling, not engine code. Allowed to call `git`, `claude`,
  `codex`; engine modules must not.
- **No silent fallback** (AGENTS.md "fail fast, fail clearly"): empty
  emitted plugin list, malformed `marketplace.json`, or write to a
  `~/.codex/config.toml` that no longer exists must error or no-op
  explicitly, never invent defaults.
- **Preserve user state.** Disabling a plugin (`enabled = false`) is a
  user decision; the script MUST NOT silently re-enable it.
- **Codex CLI versions vary.** `codex plugin marketplace` exists from
  ≥0.130; older CLIs must produce a clear warning and skip Codex
  sync without aborting the Claude path.
- **Missing CLI is a soft skip, not a fatal error.** Mirrors existing
  `install-local` contract (FR-E72 AC) and the reference script.
- **No new PAT.** Local install never reaches network; no
  `PLUGINS_REPO_TOKEN` use. Failure to honour this would conflate the
  CI-publish auth surface with the dev-loop tool.
- **Idempotent.** Re-running the script with no plugin source changes
  must converge to the same marketplace + plugin state.
- **AGENTS.md "read efficiency" budget.** Adding Codex + state-capture
  paths will push `scripts/sync-plugins-repo.ts` past the 8k-token
  working budget — splitting into a dedicated file is a real consideration,
  not a stylistic choice.
- **`mod.ts` export surface.** Before deleting `ClaudeOutput` / `SyncDeps.runClaude`
  / `claudeMissing` from `scripts/sync-plugins-repo.ts` (Phase 3), confirm
  they are not re-exported from `mod.ts` — deleting them otherwise is a
  breaking change for any embedded host depending on the type surface.
  Verification: `grep -nE "ClaudeOutput|claudeMissing|runClaude" mod.ts`.

## Definition of Done

> Per-task DoD. FR-E72 acceptance block in the SRS will be amended
> separately to fold in new test names (via the dod-test-coverage-convention
> `**Tests:**` line) plus the Codex/dotenv manual smokes.

- [x] **Tests:** capture-then-skip-disabled, Codex table reconcile,
  auto-install dotenv gating — added to the existing
  `scripts/sync-plugins-repo_test.ts` (or new
  `scripts/sync-plugins-local_test.ts` if variant 2 is chosen) and
  named with the `FR-E72 ` prefix per the test-naming obligation.
  (FR-E72; Test:
  `scripts/sync-plugins-repo_test.ts::FR-E72 install-local preserves enabled=false, FR-E72 codex table reconcile, FR-E72 auto-install dotenv gates run`;
  Evidence: `deno test -A scripts/sync-plugins-repo_test.ts`.)
- [x] Script (existing or new file) captures `claude plugin list --json`
  BEFORE marketplace removal, then on reinstall routes any
  user-scope plugin with `enabled = false` to a `skipped` bucket and
  logs "preserved as enabled=false". (FR-E72; Test:
  `scripts/sync-plugins-repo_test.ts::FR-E72 install-local preserves enabled=false`;
  Evidence: `deno test -A scripts/sync-plugins-repo_test.ts`.)
- [x] Codex path: when `codex --version` succeeds AND
  `codex plugin marketplace --help` succeeds, the script removes +
  re-adds the marketplace and reconciles
  `~/.codex/config.toml` `[plugins."<name>@flowai-workflow"]` blocks
  (strip all stale tables, re-emit one per plugin in
  `marketplace.json`, preserve prior `enabled`). Refuses to mutate
  config when emitted plugin list is empty. (FR-E72; Test:
  `scripts/sync-plugins-repo_test.ts::FR-E72 codex table reconcile, FR-E72 codex empty-emit refuses mutation`;
  Evidence: `deno test -A scripts/sync-plugins-repo_test.ts`.)
- [x] Codex absent OR older-than-0.130 → log a precise skip message
  citing the missing capability, exit 0 on the Codex path; Claude
  path still runs to completion. (FR-E72; Test:
  `scripts/sync-plugins-repo_test.ts::FR-E72 codex missing soft skip, FR-E72 codex pre-0.130 soft skip`;
  Evidence: `deno test -A scripts/sync-plugins-repo_test.ts`.)
- [x] `AUTO_INSTALL_PLUGINS=true` (env var OR `.env`) gates an opt-in
  auto-run of the script from `deno task check` and `deno task test`
  hooks. Absence of the flag is a no-op; `AUTO_INSTALL_PLUGINS=1`
  / `yes` etc. are NOT accepted (only literal `true`, matching the
  reference). (FR-E72; Test:
  `scripts/sync-plugins-repo_test.ts::FR-E72 auto-install dotenv gates run, FR-E72 auto-install rejects non-true values`;
  Evidence: `deno test -A scripts/sync-plugins-repo_test.ts`.)
- [x] `deno.json#tasks` exposes the dev-loop entry point (either the
  existing `sync-plugins` task documented for `--mode install-local`,
  or a new `sync-plugins-local` task). README "Local development"
  subsection lists the command. (FR-E72; manual — korchasa;
  Evidence: `grep -nE 'sync-plugins(-local)?' deno.json README.md`.)
- [x] SRS amendment: `documents/requirements-engine/06-distribution-and-housekeeping.md`
  FR-E72 acceptance block extended to fold the new behaviours
  (capture-disabled, Codex reconcile, auto-install dotenv) into the
  `**Tests:**` line; soft-skip-without-claude AC reused, with a
  matching soft-skip-without-codex AC added. (FR-E72; manual —
  korchasa; Evidence:
  `grep -nE 'codex|AUTO_INSTALL_PLUGINS|enabled = false' documents/requirements-engine/06-distribution-and-housekeeping.md`.)
- [x] `documents/index.md` FR-E72 row left intact (no new FR is
  introduced; the change is an AC extension on an existing FR).
  Confirmed by grepping `documents/index.md` for `FR-E72`. (FR-E72;
  manual; Evidence: `grep -n 'FR-E72' documents/index.md`.)
- [x] `deno task check` is clean post-change (fmt, lint, docs budget,
  FR field validation, full test suite). Per
  dod-test-coverage-convention this line is normally DROPPED, but
  retained here because this task introduces NEW files / new SRS
  edits whose linter status the reader cannot derive from any other
  acceptance bullet. (FR-E72; manual; Evidence: `deno task check`.)

## Solution

**Variant 2 chosen:** create dedicated `scripts/sync-plugins-local.ts`
mirroring the API/shape of
`/Users/korchasa/www/flowai/flowai/scripts/sync-plugins-local.ts`,
remove `install-local` mode from `scripts/sync-plugins-repo.ts`, expose
via new `deno task sync-plugins-local`.

The work splits into 5 phases.

### Phase 1 — New script `scripts/sync-plugins-local.ts`

Module layout — pure helpers first, runtime last, `import.meta.main`
entry at end. All exported helpers covered by `*_test.ts` without
spawning subprocesses.

Pure helpers (1:1 with the reference, adapted to single-plugin
marketplace `flowai-workflow`):

- `parseDotenv(content: string): Record<string, string>` — naive
  `KEY=VALUE` line parser (strip quotes, ignore `#` comments).
- `autoInstallEnabled(dotenvContent: string): boolean` — true iff
  `AUTO_INSTALL_PLUGINS === "true"` (exact, no `1`/`yes` variants).
- `shouldAutoInstall(dotenvPath = ".env"): Promise<boolean>` — env
  var wins; otherwise read `.env`; `NotFound` → false.
- `parseAndStripFlowaiTables(configText, marketplaceName = "flowai-workflow"):
  { stripped: string; previousEnabled: Map<string, boolean> }` —
  parse Codex `~/.codex/config.toml`, return stripped text + map of
  prior `enabled` values.
- `reconcileCodexFlowaiPluginEntries(configText, emittedNames,
  marketplaceName = "flowai-workflow"): string` — strip + re-emit
  2-line tables, preserve prior `enabled` (default `true` for new).
  Throws on empty `emittedNames`.
- `readMarketplacePluginNames(marketplaceJson: string): string[]` —
  parse `.claude-plugin/marketplace.json`, return sorted dedup'd
  plugin names. Throw on missing `plugins` array or empty list.
- `planClaudeActions(emittedNames, installedBeforeRemove,
  marketplace = "flowai-workflow"): { install: string[]; skipped: string[] }`
  — bucket previously-disabled user-scope plugins to `skipped`,
  everything else to `install`.
- `parseArgs(argv): { outDir: string; skipBuild: boolean }` —
  fail-fast parsing of `--out <dir>`, `--no-build`, `-h`/`--help`.

Runtime (side-effectful, NOT exported):

- `runCaptured(cmd, args): { success, code, stdout, stderr }`,
  `runInherited(cmd, args)`, `runInheritedAllowFail(cmd, args)`,
  `commandAvailable(cmd)`, `codexMarketplaceSubcommandAvailable()`
  — exact mirror of the reference (no project-specific tweaks
  needed).
- `ensureBuild(outDir, skipBuild)` — when `!skipBuild`, calls
  `buildPluginPayload({engineRoot, version, outDir})` directly (not
  via subprocess) — smaller, faster, fewer moving parts than the
  reference's `build-plugins.ts` spawn. Resolve `engineRoot` via
  `fromFileUrl(new URL("..", import.meta.url))` so the script works
  from any CWD (not just the repo root). Read `version` via
  `JSON.parse(Deno.readTextFileSync(join(engineRoot, "deno.json"))).version`.
  When `skipBuild`, validate `<outDir>/.claude-plugin/marketplace.json`
  exists (clear error pointing the user at `deno run -A
  scripts/build-plugin-payload.ts --out <dir> --version <ver>` if not).
- `syncClaude(absoluteOutDir)`:
  1. `commandAvailable("claude")` → log skip + return on miss.
  2. `claude plugin list --json` → `installedBefore` (capture
     BEFORE remove).
  3. `claude plugin marketplace remove flowai-workflow` (allow-fail).
  4. `claude plugin marketplace add <absoluteOutDir>`.
  5. Read `<absoluteOutDir>/.claude-plugin/marketplace.json` →
     `emitted` via `readMarketplacePluginNames`.
  6. `plan = planClaudeActions(emitted, installedBefore)`.
  7. For each `id` in `plan.install` → `claude plugin install <id>
     --scope user`. For each `id` in `plan.skipped` → log
     "preserved as enabled=false".
- `syncCodex(absoluteOutDir)`:
  1. `commandAvailable("codex")` → log skip + return on miss.
  2. `codexMarketplaceSubcommandAvailable()` → log skip + return
     on miss.
  3. `codex plugin marketplace remove flowai-workflow` (allow-fail).
  4. `codex plugin marketplace add <absoluteOutDir>`.
  5. Read marketplace.json → `emitted`.
  6. `rewriteCodexPluginEntries(emitted)`:
     - Resolve `${CODEX_HOME:-$HOME/.codex}/config.toml`.
     - If absent → log "config.toml does not exist; nothing to
       reconcile" + return (NOT an error — this is a fresh Codex
       install where the user has no plugins yet).
     - Else read → `reconcileCodexFlowaiPluginEntries(text, emitted)`
       → if `nextText === originalText` (byte-equal), skip write
       (idempotency: no-op when no plugin state changed).
     - Otherwise write back the new text.

**Single-plugin constant ban.** No code path may hardcode the literal
`"flowai-workflow"` plugin name — always iterate `emittedNames`
returned by `readMarketplacePluginNames`. The marketplace name
constant `MARKETPLACE_NAME = "flowai-workflow"` is fine (it is the
marketplace, not a plugin); the plugin name(s) come from the freshly
built `marketplace.json`. Today the marketplace ships one plugin
with the same name as the marketplace; tomorrow it may ship more.

Entry point:

```ts
async function main(): Promise<void> {
  const { outDir, skipBuild } = parseArgs(Deno.args);
  await ensureBuild(outDir, skipBuild);
  const absoluteOutDir = isAbsolute(outDir) ? outDir : resolve(outDir);
  await syncClaude(absoluteOutDir);
  await syncCodex(absoluteOutDir);
  console.log("[sync-plugins-local] Done.");
}

if (import.meta.main) {
  try { await main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
```

Defaults: `--out dist/plugin-payload` (was previously written to
tempdir in the now-deprecated install-local mode — switching to a
stable dist path makes the artefact inspectable and reusable for
`--no-build`).

### Phase 2 — Tests `scripts/sync-plugins-local_test.ts`

All tests use mock files / mock `runCaptured` (no subprocess spawn).
Test naming MUST prefix `FR-E72 ` per the test-naming obligation.

Coverage:

- `Deno.test("FR-E72 autoInstallEnabled accepts only literal true")`
  → table-test: `true` → true; `True`, `TRUE`, `1`, `yes`, empty
  string, missing key → false.
- `Deno.test("FR-E72 shouldAutoInstall env var wins over dotenv")`
  → set env, dotenv contradicts, env value wins.
- `Deno.test("FR-E72 parseAndStripFlowaiTables strips tables and captures enabled")`
  → fixture config.toml with 2 flowai tables (one `enabled = true`,
  one `enabled = false`, plus inline comments + CRLF) + unrelated
  `[mcp_servers.something]` → stripped text retains the unrelated
  block, `previousEnabled` carries both.
- `Deno.test("FR-E72 reconcileCodexFlowaiPluginEntries refuses empty emitted")`
  → throws when `emittedNames = []`.
- `Deno.test("FR-E72 reconcileCodexFlowaiPluginEntries preserves enabled=false")`
  → prior `enabled = false` for `flowai-workflow`, emit list
  contains `flowai-workflow` → new table carries `enabled = false`.
- `Deno.test("FR-E72 reconcileCodexFlowaiPluginEntries defaults new plugins to true")`
  → prior config has no flowai tables, emit contains
  `flowai-workflow` → new table has `enabled = true`.
- `Deno.test("FR-E72 readMarketplacePluginNames rejects empty plugins")`
  → throws.
- `Deno.test("FR-E72 readMarketplacePluginNames sorts and dedups")`.
- `Deno.test("FR-E72 planClaudeActions buckets disabled plugins as skipped")`
  → `installedBefore` has user-scope `flowai-workflow@flowai-workflow`
  with `enabled=false`; emit contains `flowai-workflow` →
  `plan.skipped = ["flowai-workflow@flowai-workflow"]`, install
  empty.
- `Deno.test("FR-E72 planClaudeActions installs newly emitted plugins")`
  → emit contains `flowai-workflow`, `installedBefore` empty →
  `plan.install = ["flowai-workflow@flowai-workflow"]`.
- `Deno.test("FR-E72 parseArgs fail-fast on missing --out value")` →
  `--out` at end of argv throws.
- `Deno.test("FR-E72 parseArgs rejects unknown args")` →
  `--bogus` throws.
- `Deno.test("FR-E72 reconcileCodexFlowaiPluginEntries idempotent on equal input")`
  → call twice with same args, second invocation returns byte-equal
  text → caller skips write.

**Env-var test isolation.** Tests that mutate `Deno.env`
(`shouldAutoInstall` tests in particular) MUST use try/finally with
`Deno.env.delete(ENV_AUTO_INSTALL_PLUGINS)` to avoid leaking state
to sibling tests. Mock dotenv reads via a write-then-read on a temp
file (`Deno.makeTempFile`), never modify the project `.env`.

### Phase 3 — Remove `install-local` from `sync-plugins-repo.ts`

- Delete `installLocalMode` function, `SyncMode = "install-local"`
  union member, `--install-local` and `--mode install-local`
  argparser branches, the `case "install-local"` switch arm in
  `syncPluginsRepo`, `runClaude`-related deps in `SyncDeps`, the
  CLI block that prints the `install-local` outcome.
- Remove `runClaude`, `defaultRunClaude`, `ClaudeOutput` types.
- Drop `claudeMissing` from `SyncResult` (no remaining mode uses it
  — keeps the result shape honest).
- Update `scripts/sync-plugins-repo_test.ts`: delete the
  `install-local registers temp marketplace`,
  `install-local soft-skips without claude CLI`, and any other
  install-local test cases. Keep `publish` and `dry-run` coverage
  untouched.
- Confirm no other code path references the removed types.

### Phase 4 — Wiring: `deno.json` + dev-loop hooks

- `deno.json#tasks`: add
  `"sync-plugins-local": "deno run -A scripts/sync-plugins-local.ts"`.
  Keep `sync-plugins` (now publish/dry-run only).
- Hook into `scripts/check.ts` ONLY (NOT `deno task test` — that
  task is an inline `deno test -A …` invocation in `deno.json`,
  not a TS wrapper file; wrapping it would be a separate refactor
  out of scope here). At the end of `scripts/check.ts::main()` (or
  whatever its top-level entry is), call:

  ```ts
  import { runIfAutoInstallEnabled } from "./sync-plugins-local.ts";
  // …existing check pipeline…
  await runIfAutoInstallEnabled();
  ```

  `runIfAutoInstallEnabled` is a sibling export in
  `sync-plugins-local.ts`:

  ```ts
  export async function runIfAutoInstallEnabled(): Promise<void> {
    if (await shouldAutoInstall()) await main();
  }
  ```

  Absence of `AUTO_INSTALL_PLUGINS=true` → no-op. Power users
  opt-in via `.env` or `AUTO_INSTALL_PLUGINS=true deno task check`.

### Phase 5 — SRS + README updates

- `documents/requirements-engine/06-distribution-and-housekeeping.md`:
  - FR-E72 **Description**: change "`--mode publish | dry-run |
    install-local`" → "`--mode publish | dry-run`"; remove the
    `install-local` bullet from the **Modes** block; add a new
    paragraph: "Local-dev install lives in
    `scripts/sync-plugins-local.ts` (`deno task sync-plugins-local`)
    — see FR-E72 acceptance criteria for its contract (Codex
    reconcile, `enabled=false` preservation, `AUTO_INSTALL_PLUGINS`
    gate)."
  - FR-E72 **Acceptance criteria**: extend the existing
    `**Tests:**` line to cite BOTH test files
    (`scripts/sync-plugins-repo_test.ts, scripts/sync-plugins-local_test.ts`)
    and rely on the `FR-E72 ` test-name prefix for the grep
    anchor. The previous install-local-related AC bullets (which
    were `[x]` against the soft-skip-without-claude path) are
    REPLACED by new bullets that route the same guarantees through
    the new script — phrase the diff as "AC moved to
    `sync-plugins-local.ts`, not deleted" so the SRS reviewer can
    grep both files and see the regression cover is unbroken. Add
    matching `[x]` bullets for: (a) Codex soft-skip when missing
    or pre-0.130, (b) `enabled=false` preserved through
    install/reinstall, (c) `AUTO_INSTALL_PLUGINS` literal-true
    gate.
  - FR-E72 **Tasks:**: append
    `, [local-plugin-install-script](../tasks/2026/05/local-plugin-install-script.md)`.
- `README.md`: add a `### Local plugin dogfood` subsection
  immediately AFTER the existing `## Install` (or `## Installation`)
  block, BEFORE the next top-level section. Content: one paragraph
  describing the dev-loop ("rebuild payload + reinstall into Claude
  Code + reconcile Codex"), the command (`deno task sync-plugins-local`),
  and the optional `AUTO_INSTALL_PLUGINS=true` env opt-in. Cite both
  `--no-build` (skip rebuild — requires a prior
  `scripts/build-plugin-payload.ts` invocation) and the soft-skip
  behaviour for missing CLIs. No migration prose: `--mode install-local`
  was an internal dogfood entry, not a stable user-facing API.

### Verification sweep

```sh
# Phase 2 (new tests)
deno test -A scripts/sync-plugins-local_test.ts

# Phase 3 (regression-lock publish + dry-run still pass)
deno test -A scripts/sync-plugins-repo_test.ts

# Phase 4 (dev-loop wiring)
deno task sync-plugins-local --no-build  # fails fast if dist/plugin-payload missing
deno run -A scripts/build-plugin-payload.ts --out dist/plugin-payload --version "$(jq -r .version deno.json)"
deno task sync-plugins-local              # rebuilds, then syncs Claude + Codex
AUTO_INSTALL_PLUGINS=true deno task check # auto-rebuild+install at the end

# Manual smoke (paste in PR body)
claude plugin list --json | jq '.[] | select(.id | startswith("flowai-workflow@"))'
codex plugin list 2>/dev/null | grep flowai-workflow || echo "(codex CLI absent — skipped)"
grep -nE 'sync-plugins-local|AUTO_INSTALL_PLUGINS' deno.json README.md \
  documents/requirements-engine/06-distribution-and-housekeeping.md

# Full project check
deno task check
```

## Follow-ups

- **OpenCode local-install path.** Out of scope: OpenCode plugin
  semantics still in flux (cf. FR-E70 follow-ups). Track as a new
  FR + task once stabilised.
- **CI-side enforcement of `AUTO_INSTALL_PLUGINS=false`.** The dev
  hook is opt-in by design, but CI workflows should never accept the
  flag (it would mutate the runner's `~/.codex/config.toml`). Add
  an explicit `env: AUTO_INSTALL_PLUGINS: ""` block to
  `.github/workflows/ci.yml` to lock CI off the auto-install path.
  Deferred until first time CI proves brittle without it.
- **Capture richer Codex state.** Today only `enabled` is preserved;
  if Codex grows per-plugin config keys in `[plugins."X@Y"]` tables,
  the strip-and-reemit approach loses them. Re-evaluate when Codex
  ships such keys.

