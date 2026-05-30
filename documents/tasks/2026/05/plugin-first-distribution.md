---
date: "2026-05-24"
status: to do
implements: [FR-E70, FR-E39, FR-E41]
tags: [distribution, claude-plugin, codex, marketplace, deprecation]
related_tasks:
  - 2026/05/jsr-publish-caveats.md
---

# Plugin-First Distribution via `flowai-workflow-plugins` Marketplace

## Goal

Make a Claude Code / Codex plugin the single supported install path for
`flowai-workflow`. The plugin payload is shipped from a dedicated public
marketplace repo `korchasa/flowai-workflow-plugins`; the engine source
(Deno TS) plus bundled `.flowai-workflow/<name>/` workflows travel inside
the plugin tarball and run via host Deno. Existing JSR (`@korchasa/flowai-workflow`)
and GitHub-Release standalone-binary channels are deprecated and removed.

The change mirrors the foxcode reference
(`/Users/korchasa/www/tools/foxcode`): `/plugin marketplace add
korchasa/flowai-workflow-plugins --sparse claude`, `/plugin install flowai-workflow@korchasa`,
done. No `deno install`, no binary download, no per-IDE bootstrap.

## Overview

### Context

Today `flowai-workflow` reaches users through three channels: JSR
(`deno install -g jsr:@korchasa/flowai-workflow`, FR-E39/E41/E44), prebuilt
binaries on GitHub Releases (FR-E39, `scripts/compile.ts`,
`.github/workflows/release.yml`), and a *local-only* Claude Code plugin
(FR-E70, marketplace name `flowai-workflow-local`, installed via
`deno task sync-claude-plugin`). The local plugin ships only skills/agents —
the engine CLI itself is acquired separately.

The foxcode project demonstrates a fully plugin-native flow: the
marketplace lives at the project's public git repo
(`korchasa/foxcode`), the plugin payload (`./foxcode/` subfolder)
carries the actual runtime (Node MCP channel + Firefox extension
assets), and Codex install is supported via a documented config-toml
patch (upstream Codex issue `openai/codex#19372` prevents fully
automatic MCP wiring). One repo, one marketplace, one `git pull`-style
update flow per user.

Selected design (already confirmed by the user):

- **IDEs:** Claude Code (native) and Codex (with documented config-toml
  patch). OpenCode deferred until its plugin/npm path stabilises.
- **Payload:** engine TypeScript source + bundled `.flowai-workflow/<name>/`
  workflows. Host runs them via locally-installed Deno; no precompiled
  binary in the tarball.
- **Old channels:** JSR publish and GitHub-Release binaries are removed.
  Existing JSR-installed users get a one-time deprecation notice from the
  last JSR-published CLI release and a README migration block.
- **Marketplace:** dedicated public repo `korchasa/flowai-workflow-plugins`,
  separate from the engine source repo. Plugin payload is synced into that
  repo by CI on every engine release.

### Current State

- `claude-plugin/` lives in the engine repo, contains
  `.claude-plugin/marketplace.json` (name `flowai-workflow-local`, owner
  `korchasa`), and one plugin folder `plugins/flowai-workflow/` with
  `plugin.json`, three skills (`scaffold`, `supervise`, `orchestrate`), and
  two agents (`orchestrator`, `supervisor`). The whole `claude-plugin`
  directory is listed in `deno.json#publish.exclude`.
- Install path: `deno task sync-claude-plugin` →
  `scripts/sync-claude-plugin.ts` re-points the marketplace at the local
  checkout and runs `claude plugin install`/`update` at user scope. No
  remote install path exists.
- Plugin payload contains **no engine source** — users still have to
  `deno install -g jsr:@korchasa/flowai-workflow` or download a binary.
- `.github/workflows/ci.yml` runs `standard-version` on `main` push, tags
  `v*`. `release.yml` builds 4 binaries via `scripts/compile.ts` and
  publishes them to GitHub Releases. `deno.json#publish` publishes to JSR.
- `cli.ts` has a JSR-version check (FR-E41 derivative; `--skip-update-check`
  to suppress).
- README's `## Install` section lists JSR + GitHub Releases binaries; no
  mention of plugin install.
- Reference repo: foxcode marketplace at `korchasa/foxcode`
  (`.claude-plugin/marketplace.json`, owner `korchasa`, single plugin
  `foxcode` sourced from `./foxcode`); per-plugin `plugin.json` carries
  name/description/version/author/homepage/license; Codex install requires
  a documented `[mcp_servers.foxcode]` block in `~/.codex/config.toml`
  because Codex does not substitute `${CLAUDE_PLUGIN_ROOT}` in MCP-server
  args (upstream `openai/codex#19372`).

### Constraints

- **Engine domain-agnostic invariant** (AGENTS.md Key Decisions): plugin
  payload MUST NOT introduce git/GitHub/SDLC logic into engine code; the
  plugin is a packaging concern, not an engine concern.
- **No Deno auto-install.** Plugin assumes Deno ≥ 2.x is already on the
  host (matching the foxcode contract: "Node ≥ 18 required"). README states
  the prerequisite; the plugin's first-call skill performs a `deno --version`
  preflight and reports a precise error if missing.
- **No binaries in the plugin tarball.** Tarball stays under ~5 MB so
  cloning the marketplace stays cheap. (`scripts/compile.ts` outputs are
  ~25 MB each × 4 platforms ≈ 100 MB — out of scope.)
- **Two-repo coupling.** The engine repo's release CI is the source of
  truth; `flowai-workflow-plugins` is a downstream artefact repo. Manual
  edits to `flowai-workflow-plugins` are not supported.
- **Versioning.** Plugin `version` field MUST equal engine
  `deno.json#version`. Marketplace tags follow engine tags
  (`flowai-workflow-plugins` mirrors `vX.Y.Z`).
- **Codex install simpler than foxcode.** flowai-workflow is NOT an MCP
  server — its skills invoke `deno run` directly. Codex therefore needs
  only `codex plugin marketplace add` + `codex plugin install`; the
  `~/.codex/config.toml` `[mcp_servers.*]` block that foxcode requires
  (because foxcode's job IS to expose an MCP server, and Codex does not
  substitute `${CLAUDE_PLUGIN_ROOT}` in MCP-server args, upstream
  `openai/codex#19372`) does NOT apply here. README states this
  explicitly to head off cargo-culted config.
- **No silent fallback** on missing Deno (AGENTS.md "fail fast, fail
  clearly" + "no silent fallbacks").
- **Codex skill-invocation syntax verified during develop.** Foxcode uses
  `$foxcode-run-project-profile` (no colon, hyphen-only). Exact prefix /
  separator for flowai-workflow skills (`$flowai-workflow:run` vs
  `$flowai-workflow-run` vs other) is resolved in the develop phase by
  testing against the actual Codex build; this plan does NOT commit to a
  specific shape, only to the contract that the skill is callable.
- **Existing FR-E70 reused.** The new design is an extension of FR-E70,
  not a parallel FR. FR-E39 and FR-E41 are amended (status → superseded /
  scope-reduced).
- **Migration window.** One final JSR release (`@korchasa/flowai-workflow`)
  carries a runtime deprecation notice ("`flowai-workflow` is now
  distributed as a Claude Code / Codex plugin — see <README link>"); after
  that, JSR is abandoned (no `unpublish` — JSR does not support it).

## Definition of Done

> **Per-task DoD** (this plan's checklist). The SRS-side `**Acceptance:**`
> blocks for FR-E70 / FR-E71 / FR-E72 are populated separately during the
> develop phase and collapse to `**Tests:**` per
> [dod-test-coverage-convention](dod-test-coverage-convention.md).

- [ ] **Tests (regression-locked):** `scripts/build-plugin-payload_test.ts`,
      `scripts/sync-plugins-repo_test.ts`, `cli_test.ts` — payload shape,
      version lockstep, sync idempotency, removed update-check.
      (FR-E70 + FR-E72 + FR-E41; Evidence: `deno task test`.)
- [ ] Public repo `korchasa/flowai-workflow-plugins` exists (MIT, public,
      empty `main`). (FR-E72; manual — korchasa; Evidence:
      `gh repo view korchasa/flowai-workflow-plugins --json visibility,licenseInfo`.)
- [ ] Secret `PLUGINS_REPO_TOKEN` configured in engine-repo Actions with
      `contents:write` on target repo. (FR-E72; manual — korchasa;
      Evidence: `gh secret list --repo korchasa/flowai-workflow | grep PLUGINS_REPO_TOKEN`.)
- [ ] `scripts/build-plugin-payload.ts` builds a deterministic payload tree
      from engine root + version: TS sources under `engine/`, bundled
      workflows under `workflows/` (excluding `runs/`, `memory/agent-*.md`,
      `.template.json`), skills/agents copied verbatim, `marketplace.json`
      and `plugin.json` versions pinned to `deno.json#version`.
      (FR-E70 + FR-E72; Test:
      `scripts/build-plugin-payload_test.ts::FR-E70 payload shape, FR-E70 version lockstep, FR-E70 excludes per-run dirt`;
      Evidence: `deno test -A scripts/build-plugin-payload_test.ts`.)
- [ ] `scripts/sync-plugins-repo.ts` clones target repo, replaces tree,
      commits, pushes `main`, and tags `vX.Y.Z`. Idempotent: byte-equal
      payload produces a no-op (no commit, no tag re-push).
      (FR-E72; Test: `scripts/sync-plugins-repo_test.ts::FR-E72 idempotent no-op, FR-E72 push+tag on diff`;
      Evidence: `deno test -A scripts/sync-plugins-repo_test.ts`.)
- [ ] `.github/workflows/sync-plugins.yml` triggers on `push: tags: ['v*']`
      and runs the sync script. (FR-E72; manual — korchasa via test tag;
      Evidence: workflow run URL linked in the PR body.)
- [ ] Launcher skills `flowai-workflow:run` and `flowai-workflow:init`
      invoke `deno run -A "$CLAUDE_PLUGIN_ROOT/engine/cli.ts" run|init`
      with `deno --version` preflight; missing-Deno yields a clear,
      non-fallback error referencing the README. (FR-E70; manual —
      korchasa via Claude Code + Codex smoke; Evidence: transcripts of
      both IDE sessions pasted in PR body.)
- [ ] `cli.ts init --bundle-dir <path>` flag: with flag set, enumerates
      workflows from `<path>/` instead of the binary-adjacent default;
      without flag, current behavior preserved (regression-locked).
      (FR-E70; Test:
      `cli_test.ts::FR-E70 --bundle-dir overrides default lookup, FR-E70 init default unchanged`;
      Evidence: `deno test -A cli_test.ts`.)
- [ ] Version-lockstep enforced by `scripts/check.ts`: source-tree
      `claude-plugin/plugins/flowai-workflow/.claude-plugin/plugin.json`
      and `claude-plugin/.claude-plugin/marketplace.json` either OMIT
      the `version` field (CI fills it at build time) OR carry a
      `version` byte-equal to `deno.json#version`. Drift fails
      `deno task check`. (FR-E70; Test:
      `scripts/check_test.ts::FR-E70 plugin version drift detected`;
      Evidence: `deno task check`.)
- [ ] `deno task sync-plugins --install-local` mode replaces the old
      `sync-claude-plugin` dogfood UX: builds payload to a temp dir,
      registers it as a Claude Code user-scope marketplace pointing at
      the temp dir, runs `claude plugin install/update`. Missing
      `claude` CLI degrades to a soft skip (matches FR-E70 AC4 today).
      (FR-E72; Test:
      `scripts/sync-plugins-repo_test.ts::FR-E72 --install-local registers temp marketplace, FR-E72 --install-local soft-skips without claude CLI`;
      Evidence: `deno test -A scripts/sync-plugins-repo_test.ts`.)
- [ ] JSR + binary pipeline removed: `deno.json#publish` stripped;
      `.github/workflows/release.yml`, `scripts/compile.ts`,
      `scripts/generate-release-notes.ts`, `deno task compile`,
      `deno task release`, `deno task sync-claude-plugin`, `cli.ts`
      update-check, and `--skip-update-check` flag all deleted.
      (FR-E39 + FR-E41; Test:
      `cli_test.ts::FR-E41 --skip-update-check flag is rejected, FR-E41 no JSR version probe`;
      Evidence:
      `deno task check && ! grep -q '"publish"' deno.json && ! [ -f scripts/compile.ts ] && ! [ -f .github/workflows/release.yml ]`.)
- [ ] One final JSR release `0.7.12` published from a deprecation branch
      with a banner printed unconditionally on `cli.ts` startup.
      (FR-E70; manual — korchasa; Evidence:
      `deno run -A jsr:@korchasa/flowai-workflow@0.7.12 --help 2>&1 | grep -qi deprecat`,
      pasted in PR body.)
- [ ] README install section rewritten: plugin install (`/plugin marketplace
      add korchasa/flowai-workflow-plugins --sparse claude` + `/plugin install
      flowai-workflow@korchasa`) is the only documented path; Codex
      sibling commands listed; `## Migrating from JSR` subsection added.
      (FR-E70; manual — korchasa; Evidence:
      `grep -n "/plugin marketplace add korchasa/flowai-workflow-plugins --sparse claude" README.md`.)
- [ ] AGENTS.md updated: "Project tooling Stack" lists plugin install only;
      "Architecture" section names the `flowai-workflow-plugins` target
      repo and the CI sync contract. (FR-E70 + FR-E72; manual — korchasa;
      Evidence: `grep -n "flowai-workflow-plugins" AGENTS.md`.)
- [ ] Add **FR-E71** (Codex Plugin Install Path) section to
      `documents/requirements-engine/06-distribution-and-housekeeping.md`
      with the canonical field set + `**Acceptance criteria:**` block;
      asserts no `~/.codex/config.toml` MCP block is required for
      `flowai-workflow` (skill-only payload, unlike foxcode). (FR-E71;
      manual — korchasa; Evidence:
      `grep -n "FR-E71" documents/requirements-engine/06-distribution-and-housekeeping.md`.)
- [ ] Add **FR-E72** (Cross-Repo Plugin Payload Sync) section to the same
      SRS file: target repo coordinates, version-lockstep rule, CI workflow
      trigger, idempotency contract, deprecation of `sync-claude-plugin`.
      (FR-E72; manual — korchasa; Evidence:
      `grep -n "FR-E72" documents/requirements-engine/06-distribution-and-housekeeping.md`.)
- [ ] Amend FR-E70 Description in SRS: marketplace name → `flowai-workflow`
      (was `flowai-workflow-local`); remote install via
      `korchasa/flowai-workflow-plugins`; payload includes engine source;
      old `deno task sync-claude-plugin` superseded by `deno task
      sync-plugins`. (FR-E70; manual — korchasa; Evidence:
      `grep -n "flowai-workflow-plugins" documents/requirements-engine/06-distribution-and-housekeeping.md`.)
- [ ] Amend FR-E39 Status → `Superseded by FR-E70` (binary distribution
      retired). (FR-E39; manual — korchasa; Evidence:
      `awk '/FR-E39/,/FR-E[0-9]+:/' documents/requirements-engine/06-distribution-and-housekeeping.md | grep -i "superseded"`.)
- [ ] Amend FR-E41 acceptance block: drop AC1/AC6/AC7/AC8 (JSR / standard-
      version / release.yml references); reduce to "engine version field
      drives plugin payload version" or mark FR-E41 superseded if no
      surviving AC remains. (FR-E41; manual — korchasa; Evidence: SRS
      diff in PR.)
- [ ] `documents/requirements-engine.md` index updated with FR-E71 +
      FR-E72 rows in the ID → section map. (FR-E71 + FR-E72; manual;
      Evidence: `grep -E "FR-E71|FR-E72" documents/requirements-engine.md`.)
- [ ] `documents/index.md` carries rows for FR-E71 and FR-E72 under `## FR`
      with anchors resolving in `requirements-engine.md`. (FR-E71 + FR-E72;
      manual; Evidence: `grep -E "FR-E71|FR-E72" documents/index.md`.)

## Solution

The work splits into 7 sequenceable phases. The order matters: plugin
payload must be testable locally (phases 1–3) before CI is wired
(phase 4), JSR deprecation must follow plugin GA (phases 5–6), SRS/docs
land in the same PR as code (phase 7).

### Phase 1 — Restructure `claude-plugin/` source

- Rename marketplace name in `claude-plugin/.claude-plugin/marketplace.json`:
  `flowai-workflow-local` → `flowai-workflow`. Drop "dogfood install"
  phrasing from `description`.
- Add launcher skills under `claude-plugin/plugins/flowai-workflow/skills/`:
  - `run/SKILL.md` — wraps `cli.ts run`. Argument-hint: `<workflow-name>`.
    Body invokes `deno run -A "$CLAUDE_PLUGIN_ROOT/engine/cli.ts" run
    "$CLAUDE_PLUGIN_ROOT/workflows/$1"`. Pre-flight: `command -v deno
    >/dev/null || { echo "Deno 2.x is required — see
    <repo>/README.md#prerequisites"; exit 127; }`.
  - `init/SKILL.md` — wraps `cli.ts init`. Calls `deno run -A
    "$CLAUDE_PLUGIN_ROOT/engine/cli.ts" init --bundle-dir
    "$CLAUDE_PLUGIN_ROOT/workflows" "$@"`.
- Confirm existing skills (`scaffold`, `supervise`, `orchestrate`) keep
  working — switch any `flowai-workflow`-PATH-binary references to the
  `deno run` form against `$CLAUDE_PLUGIN_ROOT/engine/cli.ts`.

### Phase 2 — Engine changes to honor bundled-workflows dir

- Teach `cli.ts init` to accept `--bundle-dir <path>` (defaults to current
  behavior of scanning `.flowai-workflow/` next to the binary/script).
  When the flag is set, enumeration and copy paths point at the plugin
  payload's `workflows/` instead of an embedded resource.
- Smoke-verify `cli.ts run` accepts an absolute workflow path
  (`$CLAUDE_PLUGIN_ROOT/workflows/<name>`) as the positional argument
  (`loadConfig` already supports a dir path; just covering the contract).
- Remove the JSR auto-update probe from `cli.ts` startup and the
  `--skip-update-check` flag (FR-E41 amendment).

### Phase 3 — Build script `scripts/build-plugin-payload.ts`

- Pure function `buildPluginPayload({engineRoot, version, outDir})`:
  1. `cp -R <engineRoot>/claude-plugin/* <outDir>/`.
  2. Enumerate engine TS sources via `git ls-files '*.ts' :!scripts
     :!*_test.ts` from `<engineRoot>`; copy each into
     `<outDir>/plugins/flowai-workflow/engine/` preserving relative
     path.
  3. Copy `<engineRoot>/deno.json` into
     `<outDir>/plugins/flowai-workflow/engine/deno.json`, then patch JSON
     to strip `publish`, `tasks` (keep only what the plugin needs), and
     `version` (engine source inside the plugin doesn't need a
     publishable manifest).
  4. For each `<engineRoot>/.flowai-workflow/<name>/`: copy into
     `<outDir>/plugins/flowai-workflow/.flowai-workflow/<name>/`
     (preserve the `.flowai-workflow/` prefix to keep relative-path
     assumptions in agent prompts intact) honoring `git ls-files` (skip
     ignored `runs/`, `memory/agent-*.md`, `.template.json`). Launcher
     skills pass the absolute path
     `$CLAUDE_PLUGIN_ROOT/.flowai-workflow/<name>` to `cli.ts run`.
  5. Substitute `version` field in
     `<outDir>/.claude-plugin/marketplace.json[plugins][0].version` and
     `<outDir>/plugins/flowai-workflow/.claude-plugin/plugin.json.version`
     with the supplied `version`.
- Determinism: file order from a sorted glob; mtime irrelevant (git
  ignores it).
- Tests in `scripts/build-plugin-payload_test.ts`:
  - `FR-E70 payload shape` — given a fixture engine root, asserts the
    output tree's file list verbatim.
  - `FR-E70 version lockstep` — supplied `0.9.0` → both manifests carry
    `"version": "0.9.0"`.
  - `FR-E70 excludes per-run dirt` — fixture with `runs/`,
    `memory/agent-*.md` populated → output tree omits them.
  - `FR-E70 engine source bundled` — output contains `engine/cli.ts`
    importable via `deno run --check`.

### Phase 4 — Sync script + CI workflow

- `scripts/sync-plugins-repo.ts`:
  1. Read `version` from `deno.json`, `token` from env
     (`PLUGINS_REPO_TOKEN`), `targetRepo` from constant
     (`korchasa/flowai-workflow-plugins`).
  2. `git clone https://x-access-token:$token@github.com/$targetRepo
     /tmp/plugins-clone`.
  3. Build payload via Phase-3 fn into `/tmp/plugins-staging`.
  4. `rsync --delete /tmp/plugins-staging/ /tmp/plugins-clone/` (preserve
     `.git`).
  5. `git -C /tmp/plugins-clone status --porcelain` — if empty → log
     "no payload change; skipping" and exit 0 (idempotency).
  6. `git -C /tmp/plugins-clone commit -m "release: vX.Y.Z (synced from
     korchasa/flowai-workflow@<sha>)"`, `git tag vX.Y.Z`, `git push
     origin main --tags`.
  7. `--dry-run` flag: stop after step 3, leave `/tmp/plugins-staging`
     intact for local inspection; replaces `deno task sync-claude-plugin`.
- `.github/workflows/sync-plugins.yml`:
  - Trigger: `on: push: tags: ['v*']`.
  - Steps: checkout, `denoland/setup-deno@v2`, `deno run -A
    scripts/sync-plugins-repo.ts --version "${GITHUB_REF_NAME#v}"`.
  - Smoke step (post-push): `git clone
    https://github.com/korchasa/flowai-workflow-plugins /tmp/clone` +
    `deno run -A /tmp/clone/plugins/flowai-workflow/engine/cli.ts
    --version` asserting it prints the expected version. NOTE: this is
    a payload-integrity smoke, NOT a marketplace-install smoke (GH
    Actions runners lack `claude` CLI). Full
    `/plugin marketplace add` + `/plugin install` verification is the
    manual smoke checklist item below; performed by korchasa on every
    release and pasted into the release PR body.
- Tests in `scripts/sync-plugins-repo_test.ts` (git ops mocked via a
  `runGit` injection point):
  - `FR-E72 idempotent no-op` — when `git status --porcelain` empty, no
    commit/tag/push commands issued.
  - `FR-E72 push+tag on diff` — when payload differs, commits, tags,
    pushes (assert the exact arg lists).
  - `FR-E72 --dry-run produces tree without push` — staging dir exists,
    no git commands beyond `clone`.

### Phase 5 — Final JSR release `0.7.12` with deprecation banner

- Branch `chore/jsr-deprecation` off current `main`.
- Add to `cli.ts` startup (before any subcommand dispatch):
  `console.error("[DEPRECATION] flowai-workflow is now distributed as
  a Claude Code / Codex plugin. See
  https://github.com/korchasa/flowai-workflow#install.");`
  unconditional, prints to stderr (does not break stdout-piped
  consumers).
- Bump `deno.json#version` to `0.7.12`. Tag `v0.7.12`. Trigger existing
  `release.yml` (one last time).
- After publish: merge a follow-up commit removing the banner (no
  longer reachable post-deletion of `cli.ts` from JSR).

### Phase 6 — Remove JSR + binary pipeline

In a separate PR (sequenced AFTER phase 5 publish completes):

- Delete `deno.json#publish` stanza.
- Delete `scripts/compile.ts`, `scripts/generate-release-notes.ts`,
  `scripts/sync-claude-plugin.ts`.
- Delete `.github/workflows/release.yml`; trim `ci.yml` to drop the
  `standard-version` step (keep tagging if we still want
  `flowai-workflow-plugins` releases driven by `vX.Y.Z` tags — yes,
  retain `standard-version` so tag generation continues, just no JSR
  publish job).
- Delete `deno task compile`, `deno task release`,
  `deno task sync-claude-plugin`; add `deno task sync-plugins`
  (`scripts/sync-plugins-repo.ts --dry-run --output
  dist/plugin-payload/` for local use; CI runs the same script without
  `--dry-run`).
- Update `scripts/check.ts`: remove `deno publish --dry-run` step;
  remove `docsTokenBudget()` checks against deleted files; ensure
  `validateFrFields` still covers the SRS file post-FR-E71/E72
  additions.
- Update `cli.ts` and `cli_test.ts`: remove `--skip-update-check`
  parsing; new test `FR-E41 --skip-update-check flag is rejected`
  asserts the flag is no longer recognized; `FR-E41 no JSR version
  probe` asserts no outbound HTTP call to `jsr.io` during startup
  (intercept via `Deno.serve` mock or assert no `fetch` call to
  jsr.io host).

### Phase 7 — Docs

- `README.md`: replace `## Install` with plugin-first instructions
  (Claude Code: 2 commands; Codex: 2 commands; **no** `~/.codex/config.toml`
  patch — explicitly state this and contrast with foxcode's MCP-server
  requirement). Add `## Migrating from JSR` subsection: tell users to
  `deno uninstall flowai-workflow`, then `/plugin marketplace add
  korchasa/flowai-workflow-plugins --sparse claude` + `/plugin install
  flowai-workflow@korchasa`. Remove `## Installation` block (lines
  311–329 of current README).
- `AGENTS.md` "Project tooling Stack": drop "JSR (`@korchasa/flowai-workflow`)";
  add "Claude Code / Codex plugin distribution via
  `korchasa/flowai-workflow-plugins`". "Architecture" section: add a
  one-paragraph note on the cross-repo sync contract (engine repo
  authoritative, plugins repo autogenerated by CI per-tag).
- `documents/requirements-engine/06-distribution-and-housekeeping.md`:
  - FR-E39: add `**Status:** Superseded by FR-E70`.
  - FR-E41: trim acceptance block to surviving criteria; if none,
    add `**Status:** Superseded by FR-E70`.
  - FR-E70: rewrite Description per Phases 1–4. Existing AC1–AC4
    (local marketplace, dogfood install) are obsolete; reset the
    Acceptance block to a fresh `**Tests:**` line + new manual smoke
    items for plugin-first distribution. The historical local-dogfood
    AC1–AC4 fold into Description as "Predecessor design" prose (one
    paragraph), not under a separate `**Status:**` (FR-E70 itself is
    not superseded — it's the same FR, scope extended).
  - New FR-E71 (Codex Plugin Install Path): canonical field set;
    Description states the two install commands and explicitly
    contrasts with foxcode's `~/.codex/config.toml` requirement (which
    exists only because foxcode is an MCP server; flowai-workflow is
    not — its skills invoke `deno run` directly, no Codex MCP wiring
    needed).
  - New FR-E72 (Cross-Repo Plugin Payload Sync): canonical field set;
    Description states target repo, CI trigger, idempotency, version
    lockstep; cites `scripts/sync-plugins-repo.ts` + the GH Actions
    workflow.
- `documents/requirements-engine.md` (index): add FR-E71, FR-E72 to the
  ID → section map.
- `documents/index.md`: register FR-E71, FR-E72 rows under `## FR`.

### Verification sweep

```sh
# Phase 3
deno test -A scripts/build-plugin-payload_test.ts

# Phase 4
deno test -A scripts/sync-plugins-repo_test.ts
deno task sync-plugins -- --dry-run --output dist/plugin-payload
ls dist/plugin-payload/plugins/flowai-workflow/engine/cli.ts

# Phase 5
deno run -A jsr:@korchasa/flowai-workflow@0.7.12 --help 2>&1 | grep -qi deprecat

# Phase 6
deno task check
! grep -q '"publish"' deno.json
! [ -f scripts/compile.ts ]
! [ -f .github/workflows/release.yml ]
! [ -f scripts/sync-claude-plugin.ts ]
deno test -A cli_test.ts

# Phase 7 — manual smoke (paste into PR body)
gh repo view korchasa/flowai-workflow-plugins --json visibility,licenseInfo
# In a fresh Claude Code session:
#   /plugin marketplace add korchasa/flowai-workflow-plugins --sparse claude
#   /plugin install flowai-workflow@korchasa
#   /flowai-workflow:run --help
# In a fresh Codex session:
#   codex plugin marketplace add korchasa/flowai-workflow-plugins --sparse codex
#   codex plugin install flowai-workflow@korchasa
#   $flowai-workflow:run --help
```

## Follow-ups

- OpenCode plugin install path — defer until upstream `opencode plugin`
  semantics stabilise; track as a separate task with a new FR.
- Marketplace categorisation / search-friendliness on Claude Code's
  plugin registry (icons, screenshots, keywords) — out of scope here,
  addressable in a follow-up doc-only task.
- Drop `standard-version` entirely in favor of manual `git tag v…` if
  conventional-commit version inference proves brittle without a JSR
  publish job consuming it — re-evaluate after 2–3 releases.
- `PLUGINS_REPO_TOKEN` rotation policy: document quarterly review,
  expiry-monitoring (a scheduled GH Actions job that probes the token
  ~14 days before expiry). Out of scope for this plan; track as a
  separate ops task once the token is in place.
- Out-of-band migration notice for JSR-installed users who do not run
  the CLI between the deprecation banner release (`0.7.12`) and the
  JSR-removal cutover: publish one final GitHub Release on the engine
  repo titled "Distribution moved to plugin" with a one-paragraph body
  and a link to the new install instructions. Plus a top-of-README
  notice in the engine repo for ~3 months.
