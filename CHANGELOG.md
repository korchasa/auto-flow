# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.5.1](https://github.com/korchasa/flowai-workflow/compare/v0.5.0...v0.5.1) (2026-04-26)


### Features

* **engine:** copy gitignored files into worktree (FR-E58) ([#214](https://github.com/korchasa/flowai-workflow/issues/214)) ([46baede](https://github.com/korchasa/flowai-workflow/commit/46baede72ba2310c4919a79419a8ae1bb496cd0f))

## [0.5.0](https://github.com/korchasa/flowai-workflow/compare/v0.4.0...v0.5.0) (2026-04-26)


### ⚠ BREAKING CHANGES

* **engine:** relocate worktree under <workflowDir>/runs/<run-id>/worktree (FR-E57) (#213)

### Features

* **engine:** relocate worktree under <workflowDir>/runs/<run-id>/worktree (FR-E57) ([#213](https://github.com/korchasa/flowai-workflow/issues/213)) ([051dabf](https://github.com/korchasa/flowai-workflow/commit/051dabfec6fa0a02140bff13d1e65b2250fd5cd6))

## [0.4.0](https://github.com/korchasa/flowai-workflow/compare/v0.3.3...v0.4.0) (2026-04-26)


### ⚠ BREAKING CHANGES

* **engine:** workflow folder is now a mandatory positional argument
to the `run` subcommand: `flowai-workflow run <workflow> [options]`.
Both `--config <path>` and the transitional `--workflow <dir>` flag
are removed. Autodetect is dropped — the path must always be supplied
explicitly. Migration: drop `--workflow ` from any existing invocation.

- cli.ts::parseArgs: first non-flag token becomes config_path; flags
  may appear before or after; trailing slash normalized; second
  positional rejected. Both `--config` and `--workflow` flags throw
  pointing at the positional form.
- cli.ts::runEngine: enforces presence of config_path with
  "Missing workflow argument" error; drops listWorkflows/
  resolveWorkflowConfigPath/DEFAULT_WORKFLOW_ROOT.
- Help text + Examples updated.
- Callsites: deno.json#tasks.run, scripts/self-runner.ts, init/mod.ts
  success message all switched to positional form.
- Docs: SRS (FR-E53 rewritten; FR-E5 + FR-E9 + FR-S46 + FR-E40 evidence
  refreshed), SDS engine §3 CLI synopsis, README CLI Flags + examples,
  AGENTS/CLAUDE drift caveat, CHANGELOG Unreleased entry merged.

`deno task check`: 784 passed | 0 failed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
* **engine+sdlc:** `.flowai-workflow/<name>/` is now the unit of consolidation;
flat `.flowai-workflow/workflow.yaml` is no longer supported. CLI flag
`--config <path>` is removed in favor of `--workflow <dir>` (autodetected
when exactly one folder exists; friendly error on 0 or >1).

- Engine: thread `workflowDir` through `state.ts` (getRunDir/getNodeDir/
  getStatePath/getLogsDir/buildTaskPaths/saveState/loadState) and
  `engine.ts`/`node-dispatch.ts`/`post-workflow.ts`. Add
  `deriveWorkflowDir(configPath)` (FR-E9 update; DoD-14).
- CLI: replace `--config` with `--workflow <dir>`; add `listWorkflows()`
  and `resolveWorkflowConfigPath()` autodetect (DoD-4).
- Dogfood: migrate to three sibling workflow folders —
  `github-inbox/`, `github-inbox-opencode/`, `github-inbox-opencode-test/` —
  each self-contained (workflow.yaml + agents/ + memory/ + scripts/).
  Remove obsolete `.flowai-workflow/scripts/lib*.sh` and
  `reset-to-main*.sh` (DoD-2, DoD-3).
- Init template: add `WORKFLOW_NAME` answer (default `default`); template
  destinations support `__WORKFLOW_NAME__` placeholder substitution (DoD-7).
- Checks: `assertWorkflowFolderShape()` validates each folder; `agents/`
  required only when `workflow.yaml` references it. `noClaudeAgentsRefs()`
  scans `.ts/.yaml/.yml/.json` outside `documents/` (DoD-1, DoD-6).
- New tests: `dogfood_layout_test.ts`, expanded `state_test.ts`/`cli_test.ts`/
  `scripts/check_test.ts`, `init/integration_test.ts` WORKFLOW_NAME case.
- One-shot migration: `scripts/migrate-state-paths.ts` (idempotent;
  DoD-13).
- Docs: update SRS (FR-S47, FR-E53, FR-E5/E9, FR-S46; mark FR-S17 and
  FR-S26 superseded), README (workflow folder section + project tree),
  AGENTS.md/CLAUDE.md (three-folder dogfood + drift caveat),
  CHANGELOG (BREAKING + migration cookbook).
- Gitignore: ignore `.flowai-workflow/*/memory/agent-*.md` (runtime
  reflection state); `memory/reflection-protocol.md` remains tracked.
  Untrack legacy `.flowai-workflow/runs/` artifacts.

`deno task check`: 789 passed | 0 failed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

### Features

* **engine+sdlc:** workflow folder contract + --workflow flag (FR-S47, FR-E53) ([13533c1](https://github.com/korchasa/flowai-workflow/commit/13533c182792bfc7ab36062117a972539b8c87b5))
* **engine:** add {{flow_file()}} template function (FR-E55) ([c2b09ec](https://github.com/korchasa/flowai-workflow/commit/c2b09ec2e6981a9fddb220215a385aae51541c04))
* **engine:** per-workflow run lock (FR-E54) ([9ae1ca6](https://github.com/korchasa/flowai-workflow/commit/9ae1ca6b473d09e035f186f18a9ac401bcdaa11a))
* **engine:** positional <workflow> argument (FR-E53) ([597374a](https://github.com/korchasa/flowai-workflow/commit/597374ab90716bb4d07ad9766e3eb8a569b3b091))
* **sdlc:** add autonomous-sdlc local-only workflow variant ([6d7cbd9](https://github.com/korchasa/flowai-workflow/commit/6d7cbd9c0d457667f4c9ba6c72669aeaa6c35ef9))


### Tests

* **engine+sdlc:** worktree-isolation e2e suite, close FR-E50/E51/E52/S28 acceptance ([b54632d](https://github.com/korchasa/flowai-workflow/commit/b54632dcd1ccc207c8153686cbdc767fb6f2ec44))


### Documentation

* **agents:** note CLAUDE.md→AGENTS.md symlink + workflow invocation gotchas ([219a40e](https://github.com/korchasa/flowai-workflow/commit/219a40e45b60c4b1be7bcab80c49ee93493fed94))

### [0.3.3](https://github.com/korchasa/flowai-workflow/compare/v0.3.2...v0.3.3) (2026-04-26)


### Features

* **engine+sdlc:** per-node effort level (FR-E42) ([097cec3](https://github.com/korchasa/flowai-workflow/commit/097cec348c6ebd83f76160170bc7c377d5fd90e9))


### Bug Fixes

* **engine:** align ai-ide-cli pin to published 0.5.6 (FR-E42) ([1420a29](https://github.com/korchasa/flowai-workflow/commit/1420a2976db5d78335bdd12516dd6f02b84fe74c))
* **settings:** remove unused PostToolUse hooks from configuration ([b40b60a](https://github.com/korchasa/flowai-workflow/commit/b40b60addfec3551590f5ef710cfa1adf26c008a))

### [0.3.2](https://github.com/korchasa/flowai-workflow/compare/v0.3.1...v0.3.2) (2026-04-26)


### Features

* **engine+sdlc:** enforce reflection-memory commit step (FR-S28) ([342790d](https://github.com/korchasa/flowai-workflow/commit/342790dbe8aad066061b82d717e05aef14dcdc0e))
* **engine:** add guardrail pure module for FR-E50 ([8d580ae](https://github.com/korchasa/flowai-workflow/commit/8d580ae881684d6ba63b3cc63612466a6b27c12b))
* **engine:** integrate guardrail in node-dispatch (FR-E50) ([2f14f2b](https://github.com/korchasa/flowai-workflow/commit/2f14f2b3eeacbd11f4d4c51179e3443c8f2183b5))
* **engine:** pin detached HEAD before worktree removal (FR-E51) ([974e229](https://github.com/korchasa/flowai-workflow/commit/974e229e75e973c78059f26b2e2dc249d07e5b2e))


### Bug Fixes

* **engine:** wrap input artifact reads via workPath (FR-E52) ([f74c034](https://github.com/korchasa/flowai-workflow/commit/f74c03441ae410d93c54d1eb2e2acda26df63e07))

### [0.3.1](https://github.com/korchasa/flowai-workflow/compare/v0.3.0...v0.3.1) (2026-04-25)


### Bug Fixes

* **engine:** emit cwd-relative template paths under worktree ([b0db7e6](https://github.com/korchasa/flowai-workflow/commit/b0db7e6eada402c320e4c25f298dc4914643d6d1)), closes [#196](https://github.com/korchasa/flowai-workflow/issues/196)


### Documentation

* **repl:** narrate each action in REPL skills before running it ([ec3d090](https://github.com/korchasa/flowai-workflow/commit/ec3d0901130c18b4e0e4a507df8ab910f6d8618d))
* **srs:** add FR-E49 — CLI auto-update prevention for spawned processes ([0c2b7a5](https://github.com/korchasa/flowai-workflow/commit/0c2b7a5c7a93fb822fa71b7a19a30a43fdbdb611)), closes [#196](https://github.com/korchasa/flowai-workflow/issues/196) [#196](https://github.com/korchasa/flowai-workflow/issues/196)


### Chores

* **check:** exclude live worktree dirs from deno test ([5b47a9e](https://github.com/korchasa/flowai-workflow/commit/5b47a9e93d30cae4e0d4a5a857b480726d20534f))
* **claude:** drop stale permission patterns from settings.json ([9bcf68b](https://github.com/korchasa/flowai-workflow/commit/9bcf68b5ba839dab1bc1dd25d35a5805343b5cbd))
* **gitignore:** exclude worktree dirs in repo and scaffold template ([0172ced](https://github.com/korchasa/flowai-workflow/commit/0172cede436e1ecfa94fda518cba0d2c8c4a8794))
* **repl:** align skill folder names with frontmatter names ([c7d98ca](https://github.com/korchasa/flowai-workflow/commit/c7d98cae81f2038ba09daab30f288101eada3189))
* **sdlc:** remove loop-in-claude wrapper and references ([35b4638](https://github.com/korchasa/flowai-workflow/commit/35b4638d1c6798734f7e5c7b256c199ab91c64da))

## [0.3.0](https://github.com/korchasa/flowai-workflow/compare/v0.2.2...v0.3.0) (2026-04-20)


### ⚠ BREAKING CHANGES

* **engine:** runtime_args YAML/TS shape changed from string[] to
Record<string, string | null> (ExtraArgsMap). Migration:
  runtime_args: ["--flag", "value"]
becomes
  runtime_args: { "--flag": "value" }
Bare boolean flags use empty-string value, null suppresses an inherited
flag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

### Features

* **engine:** FR-E48 node tool filtering ([#188](https://github.com/korchasa/flowai-workflow/issues/188)) ([4400b3e](https://github.com/korchasa/flowai-workflow/commit/4400b3e71e96b1f031265c0f3b3f4770b50a2dcf))


### Chores

* **engine:** migrate to @korchasa/ai-ide-cli ^0.5.4 ([3529ef7](https://github.com/korchasa/flowai-workflow/commit/3529ef79daccea01ea0b96064f825e3271b6e6da)), closes [#188](https://github.com/korchasa/flowai-workflow/issues/188)

### [0.2.2](https://github.com/korchasa/flowai-workflow/compare/v0.2.1...v0.2.2) (2026-04-19)


### ⚠ BREAKING CHANGES

* flatten workspace, move engine sources to repo root (#208)

### Code Refactoring

* flatten workspace, move engine sources to repo root ([#208](https://github.com/korchasa/flowai-workflow/issues/208)) ([ff1bd28](https://github.com/korchasa/flowai-workflow/commit/ff1bd2891d54658db1bcc347ef3a3f64f2a00f3e))

### [0.2.1](https://github.com/korchasa/flowai-workflow/compare/v0.2.0...v0.2.1) (2026-04-18)


### ⚠ BREAKING CHANGES

* existing .env files must rename TELEGRAM_BOT_TOKEN →
FLOWAI_TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID → FLOWAI_TELEGRAM_CHAT_ID.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

* refactor!: extract ai-ide-cli to standalone repository

The @korchasa/ai-ide-cli library now lives in its own repository at
github.com/korchasa/ai-ide-cli. Engine depends on it one-way via JSR
(jsr:@korchasa/ai-ide-cli@^0.2.0, pinned in engine/deno.json). For
local development the root workspace deno.json uses the `links` field
to resolve the JSR specifier from a sibling checkout
(`../ai-ide-cli`), so contributor experience stays the same as with
the former workspace layout.

Rationale: the library already had a one-way dependency from engine
and was published separately on JSR. Splitting the repositories
removes release-cadence coupling (engine and library can bump
independently), isolates issue trackers and CI, and lets each package
follow its own evolution timeline.

Scope of this commit:
- Remove `ai-ide-cli/` from the workspace (`deno.json`: workspace
  drops the member, `links` added pointing at `../ai-ide-cli`).
- `engine/deno.json`: add JSR import pin for `@korchasa/ai-ide-cli`.
- Delete the `ai-ide-cli/` subtree (history preserved in the sibling
  repo via `git filter-repo --subdirectory-filter`).
- `.github/workflows/ci.yml`: drop the ai-ide-cli publish and
  publish-dry-run steps (moved to the sibling repo's CI).
- `.versionrc.json`: drop `ai-ide-cli/deno.json` from bumpFiles —
  `engine/deno.json` is the sole canonical version source now.
- `scripts/check.ts`: remove the delegated library check block.
- Docs updated to reflect the split: AGENTS.md, documents/AGENTS.md,
  FR-E44 description/acceptance, design-engine module-core refs,
  design-sdlc init delegation note.

Verification: `deno task check` green, `deno task test` 3004 passed,
0 failed. Library-side `deno task check` green in sibling repo.

Breaking: consumers that depended on the monorepo's `ai-ide-cli/`
paths must switch to the JSR spec (already recommended). No code
rename on either side.

* fix(ci): remove `links` from checked-in deno.json

Keep `@korchasa/ai-ide-cli` resolved via JSR in CI and publish
dry-run — a committed `links` override would (a) require a sibling
checkout in every CI job and (b) mask version drift because local
source differs from the JSR-pinned version.

Documented the manual dev-time override in AGENTS.md: clone both
repos side by side and add `"links": ["../ai-ide-cli"]` to the
workspace root as a local, uncommitted change when iterating across
the two packages.

Also drop the stale `.flowai-workflow/worktrees/` side effect from
the prior run — already gitignored, the harness was picking up
stale copies with pre-extraction import maps.

* fix(ci): regenerate deno.lock without stale npm:yaml

The previous lock carried an orphaned `npm:yaml@2` entry (marked
`bin: true`) from a removed dependency. CI's fresh-cache run tried to
resolve its binary export and failed with
"Failed resolving binary export '.../yaml/2.8.2/package.json' did not
exist" before any user code ran. Local runs worked because the cache
was warm.

Lock regenerated from the current source imports; npm section is now
empty.

### Code Refactoring

* extract ai-ide-cli to standalone repository ([#207](https://github.com/korchasa/flowai-workflow/issues/207)) ([8e563a5](https://github.com/korchasa/flowai-workflow/commit/8e563a5a86466ff3ab9b727c9d6535f8f986ccb7))

## [0.2.0](https://github.com/korchasa/flowai-workflow/compare/v0.1.18...v0.2.0) (2026-04-18)


### ⚠ BREAKING CHANGES

* remove local flowai

### Features

* remove local flowai ([b5fe70a](https://github.com/korchasa/flowai-workflow/commit/b5fe70a3d9af47eee51407ce8be12d938a07d2b1))

### [0.1.18](https://github.com/korchasa/flowai-workflow/compare/v0.1.17...v0.1.18) (2026-04-18)


### Features

* **sdlc:** migrate HITL transport from GitHub Issues to Telegram Bot API ([c547599](https://github.com/korchasa/flowai-workflow/commit/c5475995fdb90b72506e32536556bdd4574fc9e1))

### [0.1.17](https://github.com/korchasa/flowai-workflow/compare/v0.1.16...v0.1.17) (2026-04-17)


### Features

* **engine,ai-ide-cli:** add interactive REPL as default CLI command (FR-E45, FR-E46, FR-L11, FR-L12) ([e566840](https://github.com/korchasa/flowai-workflow/commit/e5668409d7085dac02ef487c4a92f021dd09299c))
* **engine:** make init skill analyze project and confirm settings with user ([e282207](https://github.com/korchasa/flowai-workflow/commit/e282207ff337dbf52aabefd4b433f1c95e0e0dad))
* **engine:** restore init subcommand, add Python init script to REPL skill ([6a2bc01](https://github.com/korchasa/flowai-workflow/commit/6a2bc01d0541f9dbad869febaa57d73486d92385))
* **engine:** unify CHECK_CMD in init skill, improve REPL system prompt ([74f540e](https://github.com/korchasa/flowai-workflow/commit/74f540e18ff5247928154943d0d112a762c2ec5f))


### Bug Fixes

* **ai-ide-cli:** inject REPL skills into user's skills dir instead of overriding config ([8a67aa3](https://github.com/korchasa/flowai-workflow/commit/8a67aa3320dae4a9c4b015ab4f1e5fe9675d266a))
* **ai-ide-cli:** remove SKILL_PREFIX from injection, use frontmatter name as-is ([72def2b](https://github.com/korchasa/flowai-workflow/commit/72def2bec3a1ba8971333cd543d1bc529fc5b533))
* **ai-ide-cli:** symlink all config entries (not just files) for Claude REPL auth ([dcc797b](https://github.com/korchasa/flowai-workflow/commit/dcc797b1ff8ad38c05be153658aad3a45901e929))
* **engine:** embed REPL skills in compiled binary via --include flag ([1ee8bfa](https://github.com/korchasa/flowai-workflow/commit/1ee8bfa5ecae93b7b21fd5101247797753338ec1))
* **engine:** match skill frontmatter name with injected directory name ([cc9394a](https://github.com/korchasa/flowai-workflow/commit/cc9394ab30ac822ed8bbfb4d49b46313f773e16b))


### Documentation

* split ides-difference.md by IDE into separate files ([bb0a3d9](https://github.com/korchasa/flowai-workflow/commit/bb0a3d98511f068f077bf81acc85756bbaeee477))


### Code Refactoring

* **engine:** remove Python init script, let skill call CLI directly ([73b321b](https://github.com/korchasa/flowai-workflow/commit/73b321b53ef61d9a864f24546a9ad43bd8314045))

### [0.1.16](https://github.com/korchasa/flowai-workflow/compare/v0.1.15...v0.1.16) (2026-04-12)


### Features

* **ai-ide-cli:** add env and onEvent options to all runtime invoke interfaces ([1e08b8f](https://github.com/korchasa/flowai-workflow/commit/1e08b8fb6837fcaa0a6a617ab8696659e2c2d6d6))


### Documentation

* mark implemented FRs as done in SRS ([4443981](https://github.com/korchasa/flowai-workflow/commit/44439811c889d8932a030a08d71e8e5664fdcdd4))

### [0.1.15](https://github.com/korchasa/flowai-workflow/compare/v0.1.14...v0.1.15) (2026-04-12)


### Features

* **ai-ide-cli:** add cursor runtime support, remove legacy claude_args ([290a95d](https://github.com/korchasa/flowai-workflow/commit/290a95dba49596d982c7fe927083934e5f55e2cf))


### Bug Fixes

* **engine/cli:** add init subcommand to --help output ([706e45c](https://github.com/korchasa/flowai-workflow/commit/706e45c41364750a5d073d4e1e38d6e34108fb2d))


### Documentation

* **ai-ide-cli:** add SRS/SDS and register as third project scope ([5737968](https://github.com/korchasa/flowai-workflow/commit/57379687789659a47347445a63f43650a9d0bb67))

### [0.1.14](https://github.com/korchasa/flowai-workflow/compare/v0.1.13...v0.1.14) (2026-04-12)


### Bug Fixes

* **engine/cli:** use flowai-workflow binary name in --help examples ([10c5d72](https://github.com/korchasa/flowai-workflow/commit/10c5d728ea8b87881476ec6ae1b180cb01c448b5))

### [0.1.13](https://github.com/korchasa/flowai-workflow/compare/v0.1.12...v0.1.13) (2026-04-12)


### Documentation

* **srs/sds:** split monoliths into index + section files to fit Read tool budget ([d25557a](https://github.com/korchasa/flowai-workflow/commit/d25557ae0355084f52cd26fba0e0dd7df6b11d15))


### Code Refactoring

* **scripts/check:** extract docs-budget pure core and link token/byte constants ([9a51b15](https://github.com/korchasa/flowai-workflow/commit/9a51b153cc1f71a20c76df50d6819719f6f85f2a))


### Chores

* **framework:** update flowai framework ([a767870](https://github.com/korchasa/flowai-workflow/commit/a767870bb495e7fc9447d427ee8fbe03280e452c))

### [0.1.12](https://github.com/korchasa/flowai-workflow/compare/v0.1.11...v0.1.12) (2026-04-11)

### [0.1.11](https://github.com/korchasa/flowai-workflow/compare/v0.1.10...v0.1.11) (2026-04-11)


### Features

* **engine:** extract IDE CLI wrapper to @korchasa/ai-ide-cli (FR-E44) ([be79c1b](https://github.com/korchasa/flowai-workflow/commit/be79c1b8f2571d3283ca30acc3f174329b03d754))
* **sdlc:** add `flowai-workflow init` project scaffolder (FR-S46) ([cc28d67](https://github.com/korchasa/flowai-workflow/commit/cc28d67b7e5c02c5b66afa6cfaeb67a844f99014))


### Bug Fixes

* **sdlc:** remove flowai-init preflight binary checks (FR-S46) ([ca8905f](https://github.com/korchasa/flowai-workflow/commit/ca8905f136280cc7eb1f04f4daf42e6141c4502e))


### Documentation

* **fr-ids:** unify FR naming scheme (FR-E*/FR-S*), drop legacy FR-N aliases ([9181f56](https://github.com/korchasa/flowai-workflow/commit/9181f56d30d9095f66940e3f5143275691b8895a))
* **readme:** link to GitHub Releases instead of listing curl commands ([dc750ea](https://github.com/korchasa/flowai-workflow/commit/dc750ea670adb65ae01c08af68dae2886714ac55))
* **srs:** add Proposals section (P1-P4) to engine SRS ([27c0f36](https://github.com/korchasa/flowai-workflow/commit/27c0f36e5379615bd77d7668b78fc71f628db3f8))
* **srs:** add SDLC proposals (P1-S, P2-S, P3-S) and refocus engine P2 ([9ad9916](https://github.com/korchasa/flowai-workflow/commit/9ad99165c2200c1a184e0682efbab8d747b97126))


### Chores

* **check:** enforce JSR publish dry-run in local check + document Deno workspace quirks ([93f5117](https://github.com/korchasa/flowai-workflow/commit/93f51172bf4efe077becf56ce49a9a11c302bac1))
* **git:** ignore documents/rnd/ research artifacts ([#194](https://github.com/korchasa/flowai-workflow/issues/194)) ([e77be1b](https://github.com/korchasa/flowai-workflow/commit/e77be1bb18073e19d448d43acd457c12309641bc))

### [0.1.10](https://github.com/korchasa/flowai-workflow/compare/v0.1.9...v0.1.10) (2026-04-10)


### Code Refactoring

* **ci:** split release into publish-github and publish-jsr ([#193](https://github.com/korchasa/flowai-workflow/issues/193)) ([624b19a](https://github.com/korchasa/flowai-workflow/commit/624b19a6dc76fe9bb651b95e35829fcf852c6bfe))

### [0.1.9](https://github.com/korchasa/flowai-workflow/compare/v0.1.8...v0.1.9) (2026-04-10)


### Bug Fixes

* **docs:** align stale repo names to canonical flowai-workflow ([#192](https://github.com/korchasa/flowai-workflow/issues/192)) ([191f00a](https://github.com/korchasa/flowai-workflow/commit/191f00a93d4bfa37b0a9b388af699910c0dacd81))

### [0.1.8](https://github.com/korchasa/flowai-workflow/compare/v0.1.7...v0.1.8) (2026-04-10)


### Bug Fixes

* **ci:** detect engine: commits as releasable; force patch bump ([#191](https://github.com/korchasa/flowai-workflow/issues/191)) ([1e7e06e](https://github.com/korchasa/flowai-workflow/commit/1e7e06ec0e4c627999caef9334db40f211995bee))

### [0.1.7](https://github.com/korchasa/flowai-workflow/compare/v0.1.6...v0.1.7) (2026-04-10)


### Features

* **setup:** add comprehensive setup guide for flowai-workflow engine ([e73191a](https://github.com/korchasa/flowai-workflow/commit/e73191aac8ac83c5417ba2a08e277ff37a1d8bc0))


### Code Refactoring

* **cli:** remove self-update functionality ([d984280](https://github.com/korchasa/flowai-workflow/commit/d984280169715858449af20f5bd4435fc3a7314d))

### [0.1.6](https://github.com/korchasa/flowai-workflow/compare/v0.1.5...v0.1.6) (2026-04-10)


### Features

* **engine:** add OpenCode runtime support with provider-agnostic abstraction ([#186](https://github.com/korchasa/flowai-workflow/issues/186)) ([f418386](https://github.com/korchasa/flowai-workflow/commit/f4183867b7a9e064a64d4e195ec3bdd4aded906f))

### [0.1.5](https://github.com/korchasa/flowai-workflow/compare/v0.1.4...v0.1.5) (2026-04-08)


### Bug Fixes

* **ci:** use CWD .env file for deno compile version embedding ([20f6fe2](https://github.com/korchasa/flowai-workflow/commit/20f6fe213808a9381eaf5d679e2b8c66abe582e7))

### [0.1.4](https://github.com/korchasa/flowai-workflow/compare/v0.1.3...v0.1.4) (2026-04-08)


### Bug Fixes

* **ci:** show compile errors and add --no-check to deno compile ([5fd0228](https://github.com/korchasa/flowai-workflow/commit/5fd0228ff0494749e4306974829a364b722f8ce8))

### [0.1.3](https://github.com/korchasa/flowai-workflow/compare/v0.1.2...v0.1.3) (2026-04-08)


### Code Refactoring

* **ci:** merge release workflow into CI pipeline ([7c0510e](https://github.com/korchasa/flowai-workflow/commit/7c0510ecf8406905bae558e21b9d38120c082367))

### 0.1.2 (2026-04-08)


### Features

* add `start-in-claude` deno command to launch app via claude CLI ([af23fe3](https://github.com/korchasa/flowai-workflow/commit/af23fe328e2a83ad78d8f9331d00df4859047c80))
* add agent log storage, claude CLI fixes, task pipeline config ([c7ce8fd](https://github.com/korchasa/flowai-workflow/commit/c7ce8fd5de67cead19f217ab2e334a20a02f61bc))
* add configurable node-based pipeline engine ([e2d757b](https://github.com/korchasa/flowai-workflow/commit/e2d757b33c488297db106e4c5c888f9953e24680))
* add permission flag to claude command in start script ([a02aeb4](https://github.com/korchasa/flowai-workflow/commit/a02aeb442a48f6c5edacebfdf5e28834fb60696b))
* **agent:** replace onOutput with OutputManager in AgentRunOptions ([4e4a57a](https://github.com/korchasa/flowai-workflow/commit/4e4a57a22e18d93e8a128c376987781897139a27))
* **check:** add pipeline integrity validation to deno task check ([d3112e2](https://github.com/korchasa/flowai-workflow/commit/d3112e2636298e8df4a06be70ed991cd020c3015))
* **engine:** add CLI auto-update and automated release pipeline (FR-E41) ([344ea45](https://github.com/korchasa/flowai-workflow/commit/344ea45c35fc150f9b5017ad7ece4dccc4f82913))
* **engine:** add ErrorCategory type for structured node failure classification ([f67bc35](https://github.com/korchasa/flowai-workflow/commit/f67bc35b291728f3a0c1d6b7a4d07404ae4f8e78))
* **engine:** add graceful shutdown — kill child processes on SIGINT/SIGTERM (FR-E25) ([5b3ef14](https://github.com/korchasa/flowai-workflow/commit/5b3ef1404fefe3a46e946517d582be7bf0f03271))
* **engine:** add lock_path option to EngineOptions for test isolation ([4666af1](https://github.com/korchasa/flowai-workflow/commit/4666af1652f893616de6199cb4819412f9f0b151))
* **engine:** add per-node effort level and fallback model configuration ([0730f18](https://github.com/korchasa/flowai-workflow/commit/0730f185e9799a56567d17c3743512c62cc28bff))
* **engine:** add permission_mode config field (FR-E40) ([42d372a](https://github.com/korchasa/flowai-workflow/commit/42d372a47608ce0de2f8421cfa9dbf6cc596c4ec))
* **engine:** add pre_run script support for two-phase config loading (FR-E24) ([56fab5b](https://github.com/korchasa/flowai-workflow/commit/56fab5b05b37f2db83f80982c3e316910c556b03))
* **engine:** add run_always node support for Meta-Agent trigger ([4c0c6d8](https://github.com/korchasa/flowai-workflow/commit/4c0c6d8dcb56607cbdb88b526234b63acb54ab8c))
* **engine:** cache prompt file contents at config load time ([a5d029e](https://github.com/korchasa/flowai-workflow/commit/a5d029ec2ec2776ec8b67087e9f970c37d038b00))
* **engine:** integrate safetyCheckDiff into continuation flow ([acfb7b2](https://github.com/korchasa/flowai-workflow/commit/acfb7b2db6db572f1921274ccb602b496ffbcaa3))
* **engine:** replace pre_run with git worktree isolation (FR-E24) ([cf74166](https://github.com/korchasa/flowai-workflow/commit/cf7416620f9340e9cd194993c59169097467e321))
* **engine:** wire verbose output for inputs, safety, commit, agent/loop dispatch ([a759173](https://github.com/korchasa/flowai-workflow/commit/a7591730b1945265a7470468cedfc48a10f7b781))
* **fr-19:** create 9 agent SKILL.md files with frontmatter ([0306348](https://github.com/korchasa/flowai-workflow/commit/0306348e294518f09dd041bce3d44f182e9d898d))
* **fr-19:** create 9 symlinks from .claude/skills/ to agents/ ([dbf098f](https://github.com/korchasa/flowai-workflow/commit/dbf098f69d5a0f85ff68c66d39dbd09b84db5dcf))
* **fr-19:** deferred commit strategy — committer agent replaces auto-commit ([468ebda](https://github.com/korchasa/flowai-workflow/commit/468ebdab5909b88196ed59b8daceeb4672e9604a))
* **fr-19:** fix test fixtures referencing .sdlc/agents/ paths ([8e9730d](https://github.com/korchasa/flowai-workflow/commit/8e9730d8047c0d3f99da812ee53f97d8c8aca4e3))
* **fr-19:** remove .sdlc/agents/ directory after migration ([9f016ad](https://github.com/korchasa/flowai-workflow/commit/9f016adafc0d2babc2fb8425627c526a1e1b1828))
* **fr-19:** update .gitleaks.toml path references for agents/ ([d62c3e2](https://github.com/korchasa/flowai-workflow/commit/d62c3e2b2eeb70674c02d885d363da8a82b25ffd))
* **fr-19:** update pipeline YAML prompt paths to agents/<name>/SKILL.md ([7e63ad5](https://github.com/korchasa/flowai-workflow/commit/7e63ad56599d607dad0dfc49a68e53ed2a7151b6))
* **fr-19:** update SRS path references from .sdlc/agents/ to agents/ ([49fb776](https://github.com/korchasa/flowai-workflow/commit/49fb776b3b3ab701228ae9f7d193e87670f5a2f5))
* **fr-21:** implement Human-in-the-Loop via AskUserQuestion interception ([a0a4e29](https://github.com/korchasa/flowai-workflow/commit/a0a4e294cedd0d4c034b4523b79933284461657a))
* **git:** add gitleaks CLI to safetyCheckDiff ([91a9a0e](https://github.com/korchasa/flowai-workflow/commit/91a9a0e2f1ad54af4f9329ac1bd61e5990b03c3e))
* **git:** enrich CommitResult/SafetyCheckResult return types, add branch() helper ([fb5d311](https://github.com/korchasa/flowai-workflow/commit/fb5d3110438d78c66b0fe40ec24e75bb80aa3f7d))
* **loop:** replace onOutput with OutputManager in LoopRunOptions ([eae9011](https://github.com/korchasa/flowai-workflow/commit/eae90112073b423249e54ba2cfe5fab4a18d9768))
* nest loop body nodes inline in pipeline config ([#18](https://github.com/korchasa/flowai-workflow/issues/18)) ([#24](https://github.com/korchasa/flowai-workflow/issues/24)) ([8d621da](https://github.com/korchasa/flowai-workflow/commit/8d621da3498fe8ada0e2a2e8f7234aec8ec122e0))
* **output:** add 6 verbose methods to OutputManager ([2bdb96f](https://github.com/korchasa/flowai-workflow/commit/2bdb96fbe2a8c383f49570e8155be3587e504a1e))
* **pipeline:** consolidate dual-pipeline into single autonomous pipeline ([421c79c](https://github.com/korchasa/flowai-workflow/commit/421c79cfbc390a1e051ebc1808838510cb28b295))
* **pipeline:** migrate executor check from after hook to custom_script validation ([d02a624](https://github.com/korchasa/flowai-workflow/commit/d02a624e80399143bebdd80ec4334d9b78f264af))
* **pm:** prefer in-progress issues and pull main before triage ([512a3c2](https://github.com/korchasa/flowai-workflow/commit/512a3c266ba6f8ac39029bdf54278f60ee6f8162))
* **pm:** select issues by in-progress label instead of avoiding them ([b7e4ae1](https://github.com/korchasa/flowai-workflow/commit/b7e4ae143e6d491fccdf513591b8813094ad7b94))
* **requirements:** update acceptance criteria for agent prompts and pipeline structure ([3e03fa1](https://github.com/korchasa/flowai-workflow/commit/3e03fa19d79f4d227cb625d30ce2908185f7eed1))
* **scripts:** add self-runner for autonomous issue-driven pipeline execution ([cbcf3de](https://github.com/korchasa/flowai-workflow/commit/cbcf3de11e3a592d3822498fcb736957e90628d7))
* **state:** add label suffix to run IDs for readability ([385b92e](https://github.com/korchasa/flowai-workflow/commit/385b92e70554f549b6e87e805bcc60d2d3aa4db5))
* stream log timestamps — mark FR-E17 complete (issue [#42](https://github.com/korchasa/flowai-workflow/issues/42)) ([#58](https://github.com/korchasa/flowai-workflow/issues/58)) ([c93fa47](https://github.com/korchasa/flowai-workflow/commit/c93fa479bc19718b9464c9404db1a178f01aae3b))
* **validate:** add frontmatter_field validation rule type ([635fdb1](https://github.com/korchasa/flowai-workflow/commit/635fdb13f5e312f58fc964d5d8f9f324edc3b18c))
* vendor @std/assert and @std/yaml for environments where jsr.io is blocked ([9c813be](https://github.com/korchasa/flowai-workflow/commit/9c813befc71347803379eeb0e627c2f3003563c9))


### Bug Fixes

* add trailing newline to .claude JSON files ([dfb3cfe](https://github.com/korchasa/flowai-workflow/commit/dfb3cfe4d1bf1b1e187e192356702a64c12bae79))
* **agents:** remove hardcoded pipeline paths, add resilience to presenter/meta-agent prompts ([9857853](https://github.com/korchasa/flowai-workflow/commit/9857853f822d56a9aa59ba238e2c267c7d4e5bf1))
* **agents:** replace hardcoded pipeline paths with dynamic task message paths ([f73b2ae](https://github.com/korchasa/flowai-workflow/commit/f73b2ae2394c5b4cbf6d84983d2b1c7c4ac64aec))
* **check:** make comment scan mandatory (exit 1 on markers) ([63a51dc](https://github.com/korchasa/flowai-workflow/commit/63a51dc5bcbe9ee778e6e666289299366c8ba3d9))
* **ci:** install gitleaks in CI and handle missing binary gracefully ([8dd6bed](https://github.com/korchasa/flowai-workflow/commit/8dd6bed9635656af23fe81b2598a639ab5ddceb4))
* **ci:** use annotated tag and explicit push for release workflow ([5c63674](https://github.com/korchasa/flowai-workflow/commit/5c6367432ce4a7cc24dd069c7601ac09878739c4))
* clarify Claude CLI auth (OAuth primary, API key optional), fix nested session env ([1ed6284](https://github.com/korchasa/flowai-workflow/commit/1ed62844338454280cab5048043f0804930a3213))
* **config:** add allowed_paths to executor node in pipeline.yaml ([f925a79](https://github.com/korchasa/flowai-workflow/commit/f925a79d3991185420de5e63c3cf264034c71292))
* dashboard result summary display (issue [#47](https://github.com/korchasa/flowai-workflow/issues/47)) ([#61](https://github.com/korchasa/flowai-workflow/issues/61)) ([444c43f](https://github.com/korchasa/flowai-workflow/commit/444c43fda2ce50f147ec181723f8e5954bab1e99))
* **engine:** add frontmatter_field to valid config rule types ([9f3f280](https://github.com/korchasa/flowai-workflow/commit/9f3f280d7e9bc21382265dc6ee9422b294b6336f))
* **engine:** add hostname to pipeline lock for cross-host (Docker) safety ([e5d7495](https://github.com/korchasa/flowai-workflow/commit/e5d749550db2f5be9a1c661244bd826a0eb8f261))
* **engine:** code style and unused-ignore fixes ([7e2213d](https://github.com/korchasa/flowai-workflow/commit/7e2213d4030b5b2b73fadbc40fd9639567938215))
* **engine:** ensure worktree test uses 'main' branch in CI ([adcc202](https://github.com/korchasa/flowai-workflow/commit/adcc202c32650b64c23d7f15fbc9f8131ac21b58))
* **engine:** use PID-only stale lock detection, drop hostname comparison ([1ec9381](https://github.com/korchasa/flowai-workflow/commit/1ec9381cea4024c3cf1c237255c11a8a48bf5ae6))
* ensure newline at end of files in flowai-hooks.json, settings.json, and .flowai.yaml ([e1a396a](https://github.com/korchasa/flowai-workflow/commit/e1a396a4c6dca0e00fb27c23b60bb039b340d2dd))
* executor commits own code, PR bodies include Closes #N for auto-close ([2b48dad](https://github.com/korchasa/flowai-workflow/commit/2b48dad30ecbf4cb5b2fd9d6db3afaf0bfaf9d85))
* **loop:** pass claude_args to loop body nodes ([f596254](https://github.com/korchasa/flowai-workflow/commit/f5962543d9903cef38034ce84637a4d88c67e061))
* **pipeline:** add missing input dependencies for template variables ([dbbfe45](https://github.com/korchasa/flowai-workflow/commit/dbbfe45fca261cfea342713aba341581392c764e))
* **pm:** remove {{args.prompt}} from task_template, improve issue triage ([091e79e](https://github.com/korchasa/flowai-workflow/commit/091e79e17826b2ffdd8d3facaa7fc943eeaee388))
* **qa-prompt:** remove hardcoded artifact paths, follow task prompt Output path ([00ff569](https://github.com/korchasa/flowai-workflow/commit/00ff5691780fdd42696a40c3a08522e0d79d8908))
* resolve all lint/fmt issues, add .env.example and .gitignore ([a13f4b2](https://github.com/korchasa/flowai-workflow/commit/a13f4b25577098beff23a4f7c40194c83dcca6b3))
* **skill:** rename agent-committer to committer and add merge step ([d1880a9](https://github.com/korchasa/flowai-workflow/commit/d1880a959a89b495b1dda096aaf9f0562e8ecb19))
* sync pipeline-task.yaml with pipeline.yaml, add gitleaks allowlist ([564d475](https://github.com/korchasa/flowai-workflow/commit/564d475265e7ffc7ca36775977b8abd814c1d2d6))


### Tests

* **engine,git:** add edge case tests — empty input dir, stat failure, zero-file commit ([191daa9](https://github.com/korchasa/flowai-workflow/commit/191daa93b8a9a0b2cd2daff874c0a66c8fc21394))
* **engine:** add AC6 safety check verbose coverage for allowed_paths ([ed73405](https://github.com/korchasa/flowai-workflow/commit/ed73405695ef235c912eaf418346a8008dc0621b))
* **output:** add AC8 negative test — default mode emits zero verbose output ([14e7c6e](https://github.com/korchasa/flowai-workflow/commit/14e7c6e626cee1d484516ce605fe9ac01141d283))


### Code Refactoring

* consolidate to a single autonomous pipeline, removing dual-pipeline structure and CLI flags ([9f234d6](https://github.com/korchasa/flowai-workflow/commit/9f234d6c5b23a0835cc3e8086894710170a8baf5))
* **docs:** split monolithic requirements and design files into engine and SDLC scopes ([f4ca410](https://github.com/korchasa/flowai-workflow/commit/f4ca410427991436c3ec03c3670c454374fc2662))
* **engine:** move stream log into agent node directory ([#29](https://github.com/korchasa/flowai-workflow/issues/29)) ([649e78b](https://github.com/korchasa/flowai-workflow/commit/649e78bbe677724d039850243a995f0c8cf9df9b))
* housekeeping — remove stale run artifacts, rename skill, add cursorignore ([ca8cb35](https://github.com/korchasa/flowai-workflow/commit/ca8cb35e06296dd9c71c93f422a68b1dd2c8277c))
* migrate pipeline assets to native Claude Code primitives ([33d55a0](https://github.com/korchasa/flowai-workflow/commit/33d55a08fc36dd34f923b22ec40cf22cf05ed4af))
* **pipeline:** consolidate commit nodes and merge presenter into committer ([6ae4c38](https://github.com/korchasa/flowai-workflow/commit/6ae4c38ed12d4bd7493db5e11c09311ae6d2ca4a))
* rename pipeline → workflow in code, configs, and docs ([69bf81e](https://github.com/korchasa/flowai-workflow/commit/69bf81e7590737672eab3b973cdb48a5b13bc8c4))
* replace start-in-claude with loop-in-claude, rename run:self to loop ([1144aae](https://github.com/korchasa/flowai-workflow/commit/1144aae2c91f63b984cde29528f998a95172231b))
* **sdlc:** extract shared agent rules, compress SKILL.md prompts ([22b3717](https://github.com/korchasa/flowai-workflow/commit/22b37179c1d21ba4440c7238b8ed036fe397ee66))


### Documentation

* add ADR-001 research — agent context setup method analysis ([c646e67](https://github.com/korchasa/flowai-workflow/commit/c646e67e0a416c9c1c2e1ca3cfda5f060c7bd552))
* add Mermaid architecture diagrams to README, update pipeline table ([d0a8879](https://github.com/korchasa/flowai-workflow/commit/d0a8879a67c9c39494815daa8019e5f2ec87d5e8))
* add requirement-ticket skill and pipeline structure review ([1c794df](https://github.com/korchasa/flowai-workflow/commit/1c794df43a068a2bc1836bac51cc3090d7cb6771))
* delete superseded ADR-001, preserve actionable content in SDS ([d2dc9c8](https://github.com/korchasa/flowai-workflow/commit/d2dc9c8366e56b7a5e965bb264b051b324571ee4))
* **pm, presenter:** enhance SKILL.md with efficiency tips and clarification on artifact creation ([28d8353](https://github.com/korchasa/flowai-workflow/commit/28d8353ce946de6ee66834fba51c9855e24e4df5))
* remove GHA/CI-CD launch method, adopt local Deno engine execution ([205456d](https://github.com/korchasa/flowai-workflow/commit/205456da743e18088ab2904573fc9b8dbcfd1f8b))
* **requirements:** add FR-E9 run artifacts folder structure ([77dde7a](https://github.com/korchasa/flowai-workflow/commit/77dde7a41f416233ea9555df360b613642594442))
* **srs:** add FR-E5 (directory structure), FR-E6 (verbose output), expand FR-S1 with text input mode ([d7f8070](https://github.com/korchasa/flowai-workflow/commit/d7f8070b3a392e5def6bc7e7d85d557fc38b1725))


### Chores

* add Phase 0 task file for SRS/SDS cleanup ([a5a6f57](https://github.com/korchasa/flowai-workflow/commit/a5a6f57899088400389740b4758566cd4c8cbe1e))
* add task files for Phases 1-4 ([a9ab599](https://github.com/korchasa/flowai-workflow/commit/a9ab59979dee065a717b2e00986af348539cbf4f))
* add whiteboard to gitignore, update roadmap ([bab7e4d](https://github.com/korchasa/flowai-workflow/commit/bab7e4d55ce8dbce162447b9642034374ee9a543))
* **framework:** update flowai framework ([e555a1a](https://github.com/korchasa/flowai-workflow/commit/e555a1af7a11c20c3d855b36b779f7c39da3d822))
* **framework:** update flowai framework ([dafa468](https://github.com/korchasa/flowai-workflow/commit/dafa468752e0a8228707c685f4b288e6660a67d0))
* Phase 0 — SRS/SDS scope cleanup, AC markers, FR-S13 ([ab74fa7](https://github.com/korchasa/flowai-workflow/commit/ab74fa718fe4496a82ce1ca5a996c031e0ed32a8))
* **release:** 0.1.1 ([aca3dac](https://github.com/korchasa/flowai-workflow/commit/aca3dace324028d6c8d9edd099294b690c1c2d1a))
* update claude settings with session permissions ([6a973f9](https://github.com/korchasa/flowai-workflow/commit/6a973f9148fed105cf0987a53d25bc035c007fca))

### 0.1.1 (2026-04-07)


### Features

* add `start-in-claude` deno command to launch app via claude CLI ([af23fe3](https://github.com/korchasa/flowai-workflow/commit/af23fe328e2a83ad78d8f9331d00df4859047c80))
* add agent log storage, claude CLI fixes, task pipeline config ([c7ce8fd](https://github.com/korchasa/flowai-workflow/commit/c7ce8fd5de67cead19f217ab2e334a20a02f61bc))
* add configurable node-based pipeline engine ([e2d757b](https://github.com/korchasa/flowai-workflow/commit/e2d757b33c488297db106e4c5c888f9953e24680))
* add permission flag to claude command in start script ([a02aeb4](https://github.com/korchasa/flowai-workflow/commit/a02aeb442a48f6c5edacebfdf5e28834fb60696b))
* **agent:** replace onOutput with OutputManager in AgentRunOptions ([4e4a57a](https://github.com/korchasa/flowai-workflow/commit/4e4a57a22e18d93e8a128c376987781897139a27))
* **check:** add pipeline integrity validation to deno task check ([d3112e2](https://github.com/korchasa/flowai-workflow/commit/d3112e2636298e8df4a06be70ed991cd020c3015))
* **engine:** add CLI auto-update and automated release pipeline (FR-E41) ([344ea45](https://github.com/korchasa/flowai-workflow/commit/344ea45c35fc150f9b5017ad7ece4dccc4f82913))
* **engine:** add ErrorCategory type for structured node failure classification ([f67bc35](https://github.com/korchasa/flowai-workflow/commit/f67bc35b291728f3a0c1d6b7a4d07404ae4f8e78))
* **engine:** add graceful shutdown — kill child processes on SIGINT/SIGTERM (FR-E25) ([5b3ef14](https://github.com/korchasa/flowai-workflow/commit/5b3ef1404fefe3a46e946517d582be7bf0f03271))
* **engine:** add lock_path option to EngineOptions for test isolation ([4666af1](https://github.com/korchasa/flowai-workflow/commit/4666af1652f893616de6199cb4819412f9f0b151))
* **engine:** add per-node effort level and fallback model configuration ([0730f18](https://github.com/korchasa/flowai-workflow/commit/0730f185e9799a56567d17c3743512c62cc28bff))
* **engine:** add permission_mode config field (FR-E40) ([42d372a](https://github.com/korchasa/flowai-workflow/commit/42d372a47608ce0de2f8421cfa9dbf6cc596c4ec))
* **engine:** add pre_run script support for two-phase config loading (FR-E24) ([56fab5b](https://github.com/korchasa/flowai-workflow/commit/56fab5b05b37f2db83f80982c3e316910c556b03))
* **engine:** add run_always node support for Meta-Agent trigger ([4c0c6d8](https://github.com/korchasa/flowai-workflow/commit/4c0c6d8dcb56607cbdb88b526234b63acb54ab8c))
* **engine:** cache prompt file contents at config load time ([a5d029e](https://github.com/korchasa/flowai-workflow/commit/a5d029ec2ec2776ec8b67087e9f970c37d038b00))
* **engine:** integrate safetyCheckDiff into continuation flow ([acfb7b2](https://github.com/korchasa/flowai-workflow/commit/acfb7b2db6db572f1921274ccb602b496ffbcaa3))
* **engine:** wire verbose output for inputs, safety, commit, agent/loop dispatch ([a759173](https://github.com/korchasa/flowai-workflow/commit/a7591730b1945265a7470468cedfc48a10f7b781))
* **fr-19:** create 9 agent SKILL.md files with frontmatter ([0306348](https://github.com/korchasa/flowai-workflow/commit/0306348e294518f09dd041bce3d44f182e9d898d))
* **fr-19:** create 9 symlinks from .claude/skills/ to agents/ ([dbf098f](https://github.com/korchasa/flowai-workflow/commit/dbf098f69d5a0f85ff68c66d39dbd09b84db5dcf))
* **fr-19:** deferred commit strategy — committer agent replaces auto-commit ([468ebda](https://github.com/korchasa/flowai-workflow/commit/468ebdab5909b88196ed59b8daceeb4672e9604a))
* **fr-19:** fix test fixtures referencing .sdlc/agents/ paths ([8e9730d](https://github.com/korchasa/flowai-workflow/commit/8e9730d8047c0d3f99da812ee53f97d8c8aca4e3))
* **fr-19:** remove .sdlc/agents/ directory after migration ([9f016ad](https://github.com/korchasa/flowai-workflow/commit/9f016adafc0d2babc2fb8425627c526a1e1b1828))
* **fr-19:** update .gitleaks.toml path references for agents/ ([d62c3e2](https://github.com/korchasa/flowai-workflow/commit/d62c3e2b2eeb70674c02d885d363da8a82b25ffd))
* **fr-19:** update pipeline YAML prompt paths to agents/<name>/SKILL.md ([7e63ad5](https://github.com/korchasa/flowai-workflow/commit/7e63ad56599d607dad0dfc49a68e53ed2a7151b6))
* **fr-19:** update SRS path references from .sdlc/agents/ to agents/ ([49fb776](https://github.com/korchasa/flowai-workflow/commit/49fb776b3b3ab701228ae9f7d193e87670f5a2f5))
* **fr-21:** implement Human-in-the-Loop via AskUserQuestion interception ([a0a4e29](https://github.com/korchasa/flowai-workflow/commit/a0a4e294cedd0d4c034b4523b79933284461657a))
* **git:** add gitleaks CLI to safetyCheckDiff ([91a9a0e](https://github.com/korchasa/flowai-workflow/commit/91a9a0e2f1ad54af4f9329ac1bd61e5990b03c3e))
* **git:** enrich CommitResult/SafetyCheckResult return types, add branch() helper ([fb5d311](https://github.com/korchasa/flowai-workflow/commit/fb5d3110438d78c66b0fe40ec24e75bb80aa3f7d))
* **loop:** replace onOutput with OutputManager in LoopRunOptions ([eae9011](https://github.com/korchasa/flowai-workflow/commit/eae90112073b423249e54ba2cfe5fab4a18d9768))
* nest loop body nodes inline in pipeline config ([#18](https://github.com/korchasa/flowai-workflow/issues/18)) ([#24](https://github.com/korchasa/flowai-workflow/issues/24)) ([8d621da](https://github.com/korchasa/flowai-workflow/commit/8d621da3498fe8ada0e2a2e8f7234aec8ec122e0))
* **output:** add 6 verbose methods to OutputManager ([2bdb96f](https://github.com/korchasa/flowai-workflow/commit/2bdb96fbe2a8c383f49570e8155be3587e504a1e))
* **pipeline:** consolidate dual-pipeline into single autonomous pipeline ([421c79c](https://github.com/korchasa/flowai-workflow/commit/421c79cfbc390a1e051ebc1808838510cb28b295))
* **pipeline:** migrate executor check from after hook to custom_script validation ([d02a624](https://github.com/korchasa/flowai-workflow/commit/d02a624e80399143bebdd80ec4334d9b78f264af))
* **pm:** prefer in-progress issues and pull main before triage ([512a3c2](https://github.com/korchasa/flowai-workflow/commit/512a3c266ba6f8ac39029bdf54278f60ee6f8162))
* **pm:** select issues by in-progress label instead of avoiding them ([b7e4ae1](https://github.com/korchasa/flowai-workflow/commit/b7e4ae143e6d491fccdf513591b8813094ad7b94))
* **requirements:** update acceptance criteria for agent prompts and pipeline structure ([3e03fa1](https://github.com/korchasa/flowai-workflow/commit/3e03fa19d79f4d227cb625d30ce2908185f7eed1))
* **scripts:** add self-runner for autonomous issue-driven pipeline execution ([cbcf3de](https://github.com/korchasa/flowai-workflow/commit/cbcf3de11e3a592d3822498fcb736957e90628d7))
* **state:** add label suffix to run IDs for readability ([385b92e](https://github.com/korchasa/flowai-workflow/commit/385b92e70554f549b6e87e805bcc60d2d3aa4db5))
* stream log timestamps — mark FR-E17 complete (issue [#42](https://github.com/korchasa/flowai-workflow/issues/42)) ([#58](https://github.com/korchasa/flowai-workflow/issues/58)) ([c93fa47](https://github.com/korchasa/flowai-workflow/commit/c93fa479bc19718b9464c9404db1a178f01aae3b))
* **validate:** add frontmatter_field validation rule type ([635fdb1](https://github.com/korchasa/flowai-workflow/commit/635fdb13f5e312f58fc964d5d8f9f324edc3b18c))
* vendor @std/assert and @std/yaml for environments where jsr.io is blocked ([9c813be](https://github.com/korchasa/flowai-workflow/commit/9c813befc71347803379eeb0e627c2f3003563c9))


### Bug Fixes

* **agents:** remove hardcoded pipeline paths, add resilience to presenter/meta-agent prompts ([9857853](https://github.com/korchasa/flowai-workflow/commit/9857853f822d56a9aa59ba238e2c267c7d4e5bf1))
* **agents:** replace hardcoded pipeline paths with dynamic task message paths ([f73b2ae](https://github.com/korchasa/flowai-workflow/commit/f73b2ae2394c5b4cbf6d84983d2b1c7c4ac64aec))
* **check:** make comment scan mandatory (exit 1 on markers) ([63a51dc](https://github.com/korchasa/flowai-workflow/commit/63a51dc5bcbe9ee778e6e666289299366c8ba3d9))
* **ci:** install gitleaks in CI and handle missing binary gracefully ([8dd6bed](https://github.com/korchasa/flowai-workflow/commit/8dd6bed9635656af23fe81b2598a639ab5ddceb4))
* clarify Claude CLI auth (OAuth primary, API key optional), fix nested session env ([1ed6284](https://github.com/korchasa/flowai-workflow/commit/1ed62844338454280cab5048043f0804930a3213))
* **config:** add allowed_paths to executor node in pipeline.yaml ([f925a79](https://github.com/korchasa/flowai-workflow/commit/f925a79d3991185420de5e63c3cf264034c71292))
* dashboard result summary display (issue [#47](https://github.com/korchasa/flowai-workflow/issues/47)) ([#61](https://github.com/korchasa/flowai-workflow/issues/61)) ([444c43f](https://github.com/korchasa/flowai-workflow/commit/444c43fda2ce50f147ec181723f8e5954bab1e99))
* **engine:** add frontmatter_field to valid config rule types ([9f3f280](https://github.com/korchasa/flowai-workflow/commit/9f3f280d7e9bc21382265dc6ee9422b294b6336f))
* **engine:** add hostname to pipeline lock for cross-host (Docker) safety ([e5d7495](https://github.com/korchasa/flowai-workflow/commit/e5d749550db2f5be9a1c661244bd826a0eb8f261))
* **engine:** code style and unused-ignore fixes ([7e2213d](https://github.com/korchasa/flowai-workflow/commit/7e2213d4030b5b2b73fadbc40fd9639567938215))
* **engine:** use PID-only stale lock detection, drop hostname comparison ([1ec9381](https://github.com/korchasa/flowai-workflow/commit/1ec9381cea4024c3cf1c237255c11a8a48bf5ae6))
* ensure newline at end of files in flowai-hooks.json, settings.json, and .flowai.yaml ([e1a396a](https://github.com/korchasa/flowai-workflow/commit/e1a396a4c6dca0e00fb27c23b60bb039b340d2dd))
* executor commits own code, PR bodies include Closes #N for auto-close ([2b48dad](https://github.com/korchasa/flowai-workflow/commit/2b48dad30ecbf4cb5b2fd9d6db3afaf0bfaf9d85))
* **loop:** pass claude_args to loop body nodes ([f596254](https://github.com/korchasa/flowai-workflow/commit/f5962543d9903cef38034ce84637a4d88c67e061))
* **pipeline:** add missing input dependencies for template variables ([dbbfe45](https://github.com/korchasa/flowai-workflow/commit/dbbfe45fca261cfea342713aba341581392c764e))
* **pm:** remove {{args.prompt}} from task_template, improve issue triage ([091e79e](https://github.com/korchasa/flowai-workflow/commit/091e79e17826b2ffdd8d3facaa7fc943eeaee388))
* **qa-prompt:** remove hardcoded artifact paths, follow task prompt Output path ([00ff569](https://github.com/korchasa/flowai-workflow/commit/00ff5691780fdd42696a40c3a08522e0d79d8908))
* resolve all lint/fmt issues, add .env.example and .gitignore ([a13f4b2](https://github.com/korchasa/flowai-workflow/commit/a13f4b25577098beff23a4f7c40194c83dcca6b3))
* **skill:** rename agent-committer to committer and add merge step ([d1880a9](https://github.com/korchasa/flowai-workflow/commit/d1880a959a89b495b1dda096aaf9f0562e8ecb19))
* sync pipeline-task.yaml with pipeline.yaml, add gitleaks allowlist ([564d475](https://github.com/korchasa/flowai-workflow/commit/564d475265e7ffc7ca36775977b8abd814c1d2d6))


### Tests

* **engine,git:** add edge case tests — empty input dir, stat failure, zero-file commit ([191daa9](https://github.com/korchasa/flowai-workflow/commit/191daa93b8a9a0b2cd2daff874c0a66c8fc21394))
* **engine:** add AC6 safety check verbose coverage for allowed_paths ([ed73405](https://github.com/korchasa/flowai-workflow/commit/ed73405695ef235c912eaf418346a8008dc0621b))
* **output:** add AC8 negative test — default mode emits zero verbose output ([14e7c6e](https://github.com/korchasa/flowai-workflow/commit/14e7c6e626cee1d484516ce605fe9ac01141d283))


### Chores

* add Phase 0 task file for SRS/SDS cleanup ([a5a6f57](https://github.com/korchasa/flowai-workflow/commit/a5a6f57899088400389740b4758566cd4c8cbe1e))
* add task files for Phases 1-4 ([a9ab599](https://github.com/korchasa/flowai-workflow/commit/a9ab59979dee065a717b2e00986af348539cbf4f))
* add whiteboard to gitignore, update roadmap ([bab7e4d](https://github.com/korchasa/flowai-workflow/commit/bab7e4d55ce8dbce162447b9642034374ee9a543))
* **framework:** update flowai framework ([dafa468](https://github.com/korchasa/flowai-workflow/commit/dafa468752e0a8228707c685f4b288e6660a67d0))
* Phase 0 — SRS/SDS scope cleanup, AC markers, FR-S13 ([ab74fa7](https://github.com/korchasa/flowai-workflow/commit/ab74fa718fe4496a82ce1ca5a996c031e0ed32a8))
* update claude settings with session permissions ([6a973f9](https://github.com/korchasa/flowai-workflow/commit/6a973f9148fed105cf0987a53d25bc035c007fca))


### Code Refactoring

* consolidate to a single autonomous pipeline, removing dual-pipeline structure and CLI flags ([9f234d6](https://github.com/korchasa/flowai-workflow/commit/9f234d6c5b23a0835cc3e8086894710170a8baf5))
* **docs:** split monolithic requirements and design files into engine and SDLC scopes ([f4ca410](https://github.com/korchasa/flowai-workflow/commit/f4ca410427991436c3ec03c3670c454374fc2662))
* **engine:** move stream log into agent node directory ([#29](https://github.com/korchasa/flowai-workflow/issues/29)) ([649e78b](https://github.com/korchasa/flowai-workflow/commit/649e78bbe677724d039850243a995f0c8cf9df9b))
* housekeeping — remove stale run artifacts, rename skill, add cursorignore ([ca8cb35](https://github.com/korchasa/flowai-workflow/commit/ca8cb35e06296dd9c71c93f422a68b1dd2c8277c))
* migrate pipeline assets to native Claude Code primitives ([33d55a0](https://github.com/korchasa/flowai-workflow/commit/33d55a08fc36dd34f923b22ec40cf22cf05ed4af))
* **pipeline:** consolidate commit nodes and merge presenter into committer ([6ae4c38](https://github.com/korchasa/flowai-workflow/commit/6ae4c38ed12d4bd7493db5e11c09311ae6d2ca4a))
* rename pipeline → workflow in code, configs, and docs ([69bf81e](https://github.com/korchasa/flowai-workflow/commit/69bf81e7590737672eab3b973cdb48a5b13bc8c4))
* replace start-in-claude with loop-in-claude, rename run:self to loop ([1144aae](https://github.com/korchasa/flowai-workflow/commit/1144aae2c91f63b984cde29528f998a95172231b))
* **sdlc:** extract shared agent rules, compress SKILL.md prompts ([22b3717](https://github.com/korchasa/flowai-workflow/commit/22b37179c1d21ba4440c7238b8ed036fe397ee66))


### Documentation

* add ADR-001 research — agent context setup method analysis ([c646e67](https://github.com/korchasa/flowai-workflow/commit/c646e67e0a416c9c1c2e1ca3cfda5f060c7bd552))
* add Mermaid architecture diagrams to README, update pipeline table ([d0a8879](https://github.com/korchasa/flowai-workflow/commit/d0a8879a67c9c39494815daa8019e5f2ec87d5e8))
* add requirement-ticket skill and pipeline structure review ([1c794df](https://github.com/korchasa/flowai-workflow/commit/1c794df43a068a2bc1836bac51cc3090d7cb6771))
* delete superseded ADR-001, preserve actionable content in SDS ([d2dc9c8](https://github.com/korchasa/flowai-workflow/commit/d2dc9c8366e56b7a5e965bb264b051b324571ee4))
* **pm, presenter:** enhance SKILL.md with efficiency tips and clarification on artifact creation ([28d8353](https://github.com/korchasa/flowai-workflow/commit/28d8353ce946de6ee66834fba51c9855e24e4df5))
* remove GHA/CI-CD launch method, adopt local Deno engine execution ([205456d](https://github.com/korchasa/flowai-workflow/commit/205456da743e18088ab2904573fc9b8dbcfd1f8b))
* **requirements:** add FR-E9 run artifacts folder structure ([77dde7a](https://github.com/korchasa/flowai-workflow/commit/77dde7a41f416233ea9555df360b613642594442))
* **srs:** add FR-E5 (directory structure), FR-E6 (verbose output), expand FR-S1 with text input mode ([d7f8070](https://github.com/korchasa/flowai-workflow/commit/d7f8070b3a392e5def6bc7e7d85d557fc38b1725))
