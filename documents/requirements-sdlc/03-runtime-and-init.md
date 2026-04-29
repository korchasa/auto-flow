<!-- section file — index: [documents/requirements-sdlc.md](../requirements-sdlc.md) -->

# SRS SDLC — Runtime, Infrastructure, and Init CLI


### 3.10 FR-S10: Runtime Infrastructure

- **Description:** Workflow runs locally inside a devcontainer. The Deno engine orchestrates agent invocations. Legacy shell scripts preserved for backward compatibility.
- **Devcontainer contents** (`.devcontainer/Dockerfile`):
  - `claude` CLI (Claude Code) — installed via `npm install -g @anthropic-ai/claude-code`.
  - `deno` runtime — for running project checks, tests, and the workflow engine.
  - `git` — for branch management, commits, and diff-based safety checks.
  - `gh` CLI — for creating PRs and posting issue comments.
  - `gitleaks` — for secret detection in diff-based safety checks (see engine SRS FR-E1).
- **Stage scripts (legacy):**
  - Located in `.flowai-workflow/scripts/stage-<N>-<role>.sh`.
  - Each script is responsible for:
    1. Preparing input: collecting handoff artifacts, setting environment variables.
    2. Invoking `claude` CLI with the agent prompt from `.flowai-workflow/agents/agent-<role>/SKILL.md`.
    3. Running stage-specific validation (artifact checks, `deno task check` for Developer).
    4. Implementing the Continuation mechanism (engine SRS FR-E1): re-invoking via `--resume` on validation failure.
    5. Committing output artifacts and logs to the feature branch.
    6. Reporting stage status to the GitHub Issue via `gh`.
  - Scripts share common functions via `.flowai-workflow/scripts/lib.sh` (logging, git operations, continuation loop, artifact validation).
- **Acceptance criteria:**
  - Devcontainer builds successfully and contains all listed tools.
  - Primary launch: `deno task run [--prompt "..."]` (engine path).
  - Legacy: each stage can be run independently via `.flowai-workflow/scripts/stage-1-pm.sh`.
  - Stage scripts are executable and pass `shellcheck` without errors.
  - **Retry logic:** `lib.sh` implements a generic retry wrapper (`retry_with_backoff`) used for all external API calls (`claude` CLI, `gh` CLI). Parameters: max attempts = 3, initial delay = 5s, backoff multiplier = 2x. Retryable conditions: non-zero exit code from CLI tools (network errors, rate limits). Non-retryable: validation failures, agent logic errors.



### 3.12 FR-S12: Secrets

- **Description:** Defines the required secrets for workflow operation.
- **Authentication:**
  - **Claude Code CLI:** OAuth session (`claude login`) or `ANTHROPIC_API_KEY` env var. OAuth is the default method in devcontainer; API key is an optional alternative.
  - `GITHUB_TOKEN` — used by `gh` CLI for PR creation and issue comments. Must have `issues:write`, `pull-requests:write`, `contents:write` permissions. Can be obtained via `gh auth token`.
- **Acceptance criteria:**
  - Claude CLI auth is available (OAuth session or API key) before running the engine.
  - No secrets are hardcoded in scripts, prompts, or Dockerfile.
  - Diff-based safety checks (engine SRS FR-E1) detect and reject any secret-like patterns in agent-produced code.



### 3.13 FR-S13: Agents as Skills

- **Description:** Each workflow agent is a Claude Code project skill stored canonically in `.flowai-workflow/agents/agent-<name>/SKILL.md` per the agentskills.io specification. Each skill directory may include a `scripts/` subdirectory with co-located stage scripts. No symlinks. Each agent can be invoked standalone via `/agent-<name>` or used by the workflow engine.
- **Agents (6):** pm, architect, tech-lead, tech-lead-review, developer, qa. (FR-S15: reduced from 10-agent set; removed committer, tech-lead-reviewer, tech-lead-sds; presenter has no agent directory. FR-S9: meta-agent removed. FR-S18: executor renamed to developer.)
- **Supersedes:** Original layout `agents/<name>/SKILL.md` with `.claude/skills/` symlinks (superseded by FR-S17).
- **Acceptance criteria:**
  - [x] Each of 7 agents has a canonical directory `.flowai-workflow/agents/agent-<name>/` containing `SKILL.md` with spec-compliant YAML frontmatter (`name`, `description`, `compatibility`, `allowed-tools`; no `disable-model-invocation`). Expected: `.flowai-workflow/agents/agent-pm/SKILL.md`, `.flowai-workflow/agents/agent-architect/SKILL.md`, `.flowai-workflow/agents/agent-tech-lead/SKILL.md`, `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md`, `.flowai-workflow/agents/agent-developer/SKILL.md`, `.flowai-workflow/agents/agent-qa/SKILL.md`, `.flowai-workflow/agents/agent-meta-agent/SKILL.md`. Evidence: commits `6176e91`, `985e3e5`, `f0085df`; QA PASS runs `20260313T230627`, `20260314T000902`
  - [x] No symlinks in `.claude/skills/` pointing to `agents/`. Evidence: `agents/` directory removed; `.flowai-workflow/agents/agent-*/` are real directories (commits `6176e91`, `985e3e5`)
  - [x] `agents/` top-level directory removed after migration. Evidence: commit `985e3e5 sdlc(impl): remove agents/ directory and fix stale path references`
  - [x] Workflow engine `prompt:` fields in `workflow.yaml` reference `.flowai-workflow/agents/agent-<name>/SKILL.md`. Evidence: `.flowai-workflow/workflow.yaml` (commit `6176e91`)
  - [x] Each agent skill is accessible to the workflow engine via `.flowai-workflow/agents/agent-<name>/SKILL.md`. Interactive standalone invocation via `/agent-<name>` relied on `.claude/skills/` symlinks superseded by FR-S33. Evidence: `.flowai-workflow/workflow.yaml` `prompt:` fields; `.flowai-workflow/agents/agent-*/SKILL.md` (7 files present)
  - [x] `deno task check` passes after migration. Evidence: QA PASS — 436 tests pass (run `20260313T230627`)



### 3.14 FR-S14: Project Documentation (README)

- **Description:** README.md must accurately reflect current project state: vision, architecture (DAG-based engine), usage (`deno task run` with flags), prerequisites (Deno, Docker/devcontainer, Claude CLI, `gh`), available `deno task` commands, configuration mechanism (YAML `workflow.yaml`), project directory structure, and agents-as-skills.
- **Scenario:** A new contributor reads README.md and gets correct, up-to-date information about how to set up, configure, and run the workflow.
- **Acceptance criteria:**
  - [x] README.md reflects DAG-based engine architecture (not shell script
    orchestration).
  - [x] Usage section documents `flowai-workflow run <workflow>` with
    current flags (`--prompt`, `--resume`, `--dry-run`, `-v`, `-q`,
    `--skip`, `--only`, `--env`). Workflow path is positional and
    mandatory (FR-E53).
  - [x] Prerequisites list: Deno, Docker/devcontainer, Claude Code CLI, `gh`
    CLI, Git.
  - [x] Available `deno task` commands documented (run, check, test).
  - [x] Configuration section references `workflow.yaml` (not env vars).
  - [x] Project directory structure matches actual layout (`engine/`,
    `.flowai-workflow/`).
  - [x] Agents-as-skills mentioned with `/agent-<name>` slash command
    examples.
  - [x] Installation/setup instructions are accurate for devcontainer
    workflow.



### 3.23 FR-S23: SDLC Documentation Accuracy

- **Description:** SDLC SDS (`documents/design-sdlc.md`) must accurately reflect the current workflow architecture. Deprecated components must be explicitly labeled with deprecation reason and superseding FR, or removed entirely. References in SDS must match current `deno.json` task state.
- **Rationale:** Legacy diagrams and stubs for removed workflow stages (removed per FR-S15) create architectural confusion for new contributors. `deno.json` task references in SDS 3.2 that no longer match actual state undermine doc trustworthiness.
- **Acceptance criteria:**
  - [x] SDS section 2.1 legacy shell workflow diagram marked "(DEPRECATED — pre-FR-S15)" or removed. Affected nodes: Stage 3 (Reviewer), Stage 4 (Architect), Stage 5 (SDS Update), Stage 8 (Presenter) — all absorbed/removed after FR-S15 workflow restructure. Evidence: `documents/design-sdlc.md` §2.1 heading "Legacy: Shell Script Workflow (REMOVED — superseded by FR-S15)".
  - [x] SDS section 3.2 (Stage Scripts) `deno.json` task references aligned with current state: 9 `test:*` legacy tasks accurately documented with DEPRECATED status. Evidence: `documents/design-sdlc.md` §3.2 heading "Stage Scripts — DELETED (FR-S26)".
  - [x] `deno task check` passes. Evidence: `deno task check` PASS (this commit).



### 3.29 FR-S29: AGENTS.md Agent List Accuracy

- **Description:** `AGENTS.md` must list exactly the 6 active workflow agents: PM, Architect, Tech Lead, Developer, QA, Tech Lead Review. Deprecated/absorbed agents (e.g., Presenter, absorbed into Tech Lead + Tech Lead Review per FR-S15; Meta-Agent, removed per FR-S9) must not appear as active agents.
- **Rationale:** Stale agent references in `AGENTS.md` mislead contributors about workflow structure. Presenter agent was absorbed into Tech Lead + Tech Lead Review per FR-S15. Meta-Agent removed per FR-S9. `AGENTS.md` now lists exactly 6 correct agents; Presenter and Meta-Agent references removed.
- **Acceptance criteria:**
  - [x] `AGENTS.md` agent list contains exactly: PM, Architect, Tech Lead, Developer, QA, Tech Lead Review (6 agents total). Evidence: `AGENTS.md` (6 agents listed, no Presenter, no Meta-Agent), `scripts/check.ts:134-171` (`validateAgentListContent`), `scripts/check_test.ts:96-100` (real AGENTS.md integration test).
  - [x] No reference to "Presenter" as an active agent in `AGENTS.md`. Evidence: `scripts/check.ts:134-171` (`validateAgentListContent` rejects deprecated agents), `scripts/check_test.ts:73-78` (Presenter rejection test).
  - [x] `deno task check` passes. Evidence: `scripts/check.ts:173-184` (`agentListAccuracy` runs as part of check), `scripts/check_test.ts:54-100` (6 test cases).



### 3.46 FR-S46: Project Init CLI (`flowai-workflow init`)

- **Description:** CLI subcommand `flowai-workflow init` copies a bundled
  workflow folder verbatim from `<package>/.flowai-workflow/<workflow>/`
  into the target project's `.flowai-workflow/<workflow>/`. Pure file
  copy — no wizard, no placeholder substitution, no autodetection, no AI
  calls, no network. Single positional flag `--workflow <name>` selects
  which bundled workflow to copy (default `github-inbox`). Project-
  specific configuration (test commands, branch names, repo conventions,
  required runtimes) is delegated to the workflow agents at first run
  via `--prompt`. Init writes ONLY inside
  `.flowai-workflow/<workflow>/` — no `.claude/agents/` writes, no
  top-level `.gitignore` append, no files outside the target directory.
- **Rationale:** The earlier wizard/template approach forked the bundled
  agent prompts and `workflow.yaml` from the dogfooded copies under
  `.flowai-workflow/`, and the two trees drifted. Replacing
  templates+placeholders with verbatim copy of the dogfood folder
  collapses two sources into one: clients run the exact bytes the engine
  project itself runs. Configuration moves from wizard answers into the
  agents' first-run prompt, which is more flexible (agents can probe the
  repo) and keeps the scaffolder trivial.
- **Scope separation:** Init implementation lives at `init/` next to
  the engine modules but is loaded via dynamic `import("./init/mod.ts")`
  from the `cli.ts` dispatcher when `argv[0] === "init"`. The engine
  module graph stays free of init code at runtime. FR-E14 (engine
  domain-agnosticism) is preserved: init contains no scaffolding logic
  beyond verbatim copy, and the bundled workflows under
  `.flowai-workflow/<name>/` are workflow-level concerns, not engine
  concerns.
- **Dep:** FR-S26 (`.flowai-workflow/` asset directory), FR-E14 (engine
  purity), `deno.json#publish` (bundles `.flowai-workflow/<name>/` into
  the JSR tarball, excluding per-run `runs/`, `memory/agent-*.md`, and
  `.template.json`).
- **Acceptance criteria:**
  - [x] `init/mod.ts` exposes `runInit(argv, opts)` with structured
    exit codes (0 success, 1 preflight/scaffold failure, 3 invalid
    args), `--workflow <name>` (default `github-inbox`), `--dry-run`,
    `--allow-dirty`, `--help`. Evidence: `init/mod.ts:64-131`,
    `init/mod_test.ts`.
  - [x] `init/scaffold.ts` `copyTemplate(sourceDir, targetDir)` is a
    verbatim file copy: refuses to overwrite existing files, tracks
    every written path for unwind-on-error, never substitutes
    placeholders. Evidence: `init/scaffold.ts:48-94`,
    `init/scaffold_test.ts::copyTemplate — preserves placeholder-shaped
    strings verbatim`.
  - [x] `init/preflight.ts` checks git repo, target dir absence, and
    (unless `--allow-dirty`) clean-tree. Workflow-specific dependencies
    (`gh`, `claude`, `opencode`, github.com remote) are NOT pre-checked
    — surface at first agent run. Evidence: `init/preflight.ts:97-122`,
    `init/preflight_test.ts`.
  - [x] Engine dispatcher in `cli.ts` routes `init` subcommand to the
    scaffolder via dynamic import, passing `VERSION` as `engineVersion`.
    Evidence: `cli.ts:335-341`.
  - [x] `deno.json#publish.exclude` ships `.flowai-workflow/<name>/`
    folders in the JSR tarball but excludes per-run dirt
    (`*/runs/**`, `*/memory/agent-*.md`, `*/.template.json`). Evidence:
    `deno.json:46-62`, `deno publish --dry-run` file list shows
    `.flowai-workflow/github-inbox/workflow.yaml` and agents.
  - [x] Standalone binaries embed the same publish-clean set via
    `deno compile --include`. `scripts/compile.ts` enumerates the
    files via `git ls-files .flowai-workflow/`, filters
    tracked-but-deleted, and passes one `--include` per file. Init
    discovers them at runtime by reading the embedded virtual FS.
    Evidence: `scripts/compile.ts::discoverBundledWorkflowFiles`,
    `init/mod.ts::listAvailableWorkflows`,
    `init/mod_test.ts::parseInitArgs — --list flag`.
  - [x] `flowai-workflow init --list` enumerates every workflow this
    build ships (sorted, with `(default)` marker), and the
    unknown-workflow error includes the same list. Evidence:
    `init/mod.ts:208-225`,
    `init/integration_test.ts::runInit — --list returns 0 and
    enumerates bundled workflows`.
  - [x] When `--workflow` is omitted and stdin is a TTY, init prints
    the numbered list and prompts the user to pick (empty = default,
    1-based index, or exact name). Re-prompts on bad input; EOF
    cancels with exit 1. Non-TTY stdin silently uses the default for
    backward-compat with scripted callers. Pure dispatch
    (`resolveWorkflowChoice`) is unit-tested without mocking stdin.
    Evidence: `init/mod.ts::promptForWorkflow`, `init/mod.ts::
    resolveWorkflowChoice`, `init/mod_test.ts` (8 picker test cases).
  - [x] On successful scaffold, init prints a ready-to-paste
    **adaptation prompt** wrapped in `--- ADAPTATION PROMPT (start)
    ---` / `(end)` markers. The prompt tells the agents to detect
    language/runtime/test/lint/branch/repo conventions, patch
    `workflow.yaml` + `agents/agent-*.md` in place with a
    `## Project Context` section, leave the diff for review (no
    auto-commit/push/PR). Replaces the deprecated
    placeholder-substitution + wizard answers. Evidence:
    `init/mod.ts::adaptationPrompt`, `init/mod_test.ts` (3 prompt
    test cases),
    `init/integration_test.ts::runInit — scaffolds github-inbox
    verbatim end-to-end` (asserts ADAPTATION PROMPT block in stdout).
  - [x] Integration test stands up a tmp git repo and asserts the
    scaffolded `workflow.yaml` byte-equals the bundled source — the
    dogfooding invariant. Evidence:
    `init/integration_test.ts::runInit — scaffolds github-inbox
    verbatim end-to-end`.
  - [x] `README.md` § "Quick Start: New Project" documents
    `--workflow`, the `--prompt` first-run pattern, and the verbatim-
    copy contract. Evidence: `README.md` § "Quick Start: New Project".
- **Out of scope (deferred):**
  - `flowai-workflow update` command to diff installed workflow against
    bundled upstream. Removed `.template.json` until needed; `init`
    re-scaffolds from JSR cleanly today.
  - Auto-adaptation agent that rewrites `workflow.yaml` and agent
    prompts based on detected project conventions. Replaced by the
    `--prompt` first-run pattern: users (or a wrapper script) tell the
    agents what's project-specific.
  - Restricting the bundled workflow set per release. All
    `.flowai-workflow/<name>/` folders ship; clients pick via
    `--workflow`.


