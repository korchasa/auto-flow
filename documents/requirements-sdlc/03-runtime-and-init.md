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
  - [x] Usage section documents `deno task run` with current flags
    (`--prompt`, `--resume`, `--dry-run`, `-v`, `-q`, `--config`, `--skip`,
    `--only`, `--env`).
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

- **Description:** New CLI subcommand `flowai-workflow init` scaffolds a
  ready-to-run `.flowai-workflow/` directory in a target project. Pure
  deterministic file copy with placeholder substitution — no AI calls, no
  network, no post-init magic. A short interactive wizard collects project-
  specific values (name, default branch, test/lint commands), autodetected
  defaults are pre-filled from `deno.json` / `package.json` / `go.mod` /
  `pyproject.toml` / `Cargo.toml`. A non-interactive `--answers <file.yaml>`
  mode supports CI-driven provisioning. The bundled template (`sdlc-claude`)
  is framework-independent: generic agent prompts, zero references to
  `FR-E/FR-S` numbering, `scope: engine|sdlc` logic, or flowai-workflow
  internals. Init writes ONLY inside `.flowai-workflow/` — no `.claude/agents/`
  writes, no top-level `.gitignore` append, no files outside the target
  directory (self-containment invariant).
- **Rationale:** Before FR-S46, onboarding required manually creating
  `workflow.yaml`, copying agent prompts, wiring scripts, and editing
  placeholder values. High barrier and error-prone. A one-command scaffolder
  lowers the adoption bar from hours to seconds, and keeps the template
  shippable via JSR alongside the engine.
- **Scope separation:** Init implementation lives in a separate workspace
  member `flowai-init/` (package `@korchasa/flowai-workflow-init`) outside
  `engine/`. Engine adds only a thin dispatcher: when `argv[0] === "init"`,
  it dynamically imports the init module and delegates. FR-E14 (engine
  domain-agnosticism) is preserved — no scaffolding logic or templates live
  inside `engine/`.
- **Dep:** Engine workspace layout (separate deno.json per workspace member),
  FR-S26 (`.flowai-workflow/` asset directory), FR-E14 (engine purity).
- **Acceptance criteria:**
  - [x] New workspace member `flowai-init/` with self-contained `deno.json`,
    `scripts/check.ts`, and JSR package metadata. Evidence:
    `flowai-init/deno.json:1-25`, `flowai-init/scripts/check.ts:1-84`.
  - [x] `flowai-init/templates/sdlc-claude/` ships a framework-independent
    SDLC template: all files live under `.flowai-workflow/` (agents at
    `agents/agent-*.md`, not `.claude/agents/`). Grep for `FR-E`, `FR-S`,
    `scope: engine`, `scope: sdlc`, `deno task` in `flowai-init/templates/`
    returns zero matches. Evidence:
    `flowai-init/templates/sdlc-claude/files/.flowai-workflow/`.
  - [x] Template manifest `template.yaml` declares 4 wizard questions
    (`PROJECT_NAME`, `DEFAULT_BRANCH`, `TEST_CMD`, `LINT_CMD`), hard
    requirements (github.com remote), and file copy rules. Evidence:
    `flowai-init/templates/sdlc-claude/template.yaml:1-46`.
  - [x] `scaffold.ts` implements placeholder substitution, tracked file copy,
    unwind-on-error, and `.template.json` metadata write. Evidence:
    `flowai-init/scaffold.ts:1-180`.
  - [x] `autodetect.ts` implements per-language handlers (deno/npm/cargo/go/
    pyproject) with priority dispatch. Evidence:
    `flowai-init/autodetect.ts:1-210`.
  - [x] `preflight.ts` checks git repo status, `.flowai-workflow/` absence,
    clean-tree, and parses 3 git remote forms (HTTPS, SCP-SSH, URL-SSH).
    Evidence: `flowai-init/preflight.ts:1-220`.
  - [x] `manifest.ts` validates `template.yaml` shape with path-aware errors
    (e.g. `questions[2].detect: unknown handler`). Evidence:
    `flowai-init/manifest.ts:1-200`.
  - [x] `wizard.ts` supports both non-interactive (`--answers`) and
    interactive (stdin prompts) paths with `resolveFinalAnswers` fallback
    chain: detected → file → question.default → required check. Evidence:
    `flowai-init/wizard.ts:1-200`.
  - [x] `mod.ts` `runInit(argv, opts)` orchestrates preflight → autodetect →
    wizard → scaffold → metadata with structured exit codes (0/1/3), dry-run
    path, and help text. Evidence: `flowai-init/mod.ts:1-340`.
  - [x] Engine dispatcher in `engine/cli.ts` routes `init` subcommand to the
    scaffolder via dynamic import, passing `VERSION` as `engineVersion`.
    Evidence: `engine/cli.ts:197-215`.
  - [x] Unit tests cover scaffold, autodetect, preflight, manifest, wizard,
    and flag parsing (79+ tests). Integration tests stand up a tmp git repo,
    run the full `runInit` path in `--answers` mode, and assert on resulting
    file tree, placeholder substitution, and self-containment invariant
    (no files outside `.flowai-workflow/`). Evidence:
    `flowai-init/scaffold_test.ts`, `flowai-init/autodetect_test.ts`,
    `flowai-init/preflight_test.ts`, `flowai-init/manifest_test.ts`,
    `flowai-init/wizard_test.ts`, `flowai-init/mod_test.ts`,
    `flowai-init/integration_test.ts`.
  - [x] `.flowai-workflow/.template.json` records template name, template
    version, engine version, ISO 8601 timestamp, and wizard answers. Layout
    ready for future `flowai-workflow update` command. Evidence:
    `flowai-init/scaffold.ts` `writeTemplateMetadata`.
  - [x] `README.md` quickstart explains the init command. Evidence:
    `README.md` § "Quick Start: New Project".
- **Out of scope (deferred):**
  - AI adaptation / bootstrap workflow / post-init `## Project Context`
    fills. Users edit template-generated agent prompts by hand if they want
    project-specific tuning.
  - `flowai-workflow update` command to pull template changes from upstream.
    v1 records the state (`.template.json`) to enable it later.
  - Lite 3-agent template (draft → review → finalize). v1 ships SDLC-only.
  - Multi-IDE templates (Cursor, OpenCode). Requires alternative agent
    layouts; current layout has zero `.claude/` coupling so adding is a
    pure addition.
  - External template repository. Templates remain in-repo for v1.
  - Non-GitHub remotes (GitLab, Gitea). SDLC template hard-couples to
    GitHub by design.


