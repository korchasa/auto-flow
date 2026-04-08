# SRS: SDLC Workflow

## 0. Resolved Design Decisions

- **Target project:** This repo (flowai-workflow). Project-agnostic reuse deferred.
- **Concurrent workflows:** One workflow per branch. Single local execution assumed. No concurrent locking.
- **Cost limits:** Not tracked. No budget constraints.
- **Agent prompts:** Written incrementally alongside implementation.
- **CLAUDE.md interaction:** Target project's CLAUDE.md and agent system prompts complement each other (additive, not conflicting).
- **Issue complexity:** No size/complexity limits for now. Deferred.
- **Testing strategy:** Integration tests in this repo (no separate test repo). Unit tests for `lib.sh`.
- **Meta-Agent:** Auto-applies prompt improvements (commits to feature branch). Reviewed at PR merge.
- **Rollback:** Manual operation (no automated rollback).
- **Retry logic:** 3 attempts with exponential backoff for external API calls (`claude`, `gh`) in `lib.sh`.

## 1. Introduction

- **Document purpose:** Define the specification for the automated multi-agent SDLC workflow — a chain of specialized AI agents orchestrated by the DAG engine, automating the full development lifecycle from GitHub issue triage to merged PR.
- **Scope:** A locally-run workflow where a GitHub Issue triggers a chain of specialized AI agents (via `deno task run [--prompt "..."]`), each performing a distinct role in the software development lifecycle — from issue triage to QA verification. PM agent autonomously selects and triages open GitHub issues. This document covers workflow-specific concerns: agent roles, prompts, GitHub workflow, devcontainer, dashboard. Engine-level concerns (DAG executor, node types, validation, continuation, resume, HITL, CLI) are in the engine SRS.
- **Audience:** Project maintainer (korchasa), contributors.
- **Definitions and abbreviations:**
  - **Agent:** An isolated Claude Code CLI invocation with a dedicated system prompt (role).
  - **Stage:** A single step in the workflow, executed by one agent.
  - **Handoff Artifact:** A structured Markdown file produced by one agent and consumed by the next.
  - **Agent Log:** A full transcript of an agent's session (input, reasoning, output, tool calls).
  - **Meta-Agent:** A separate agent that analyzes logs of other agents and refines their prompts.
  - **Continuation:** A mechanism for re-invoking an agent within the same session (via `--resume`) to fix issues detected by the stage script (see engine SRS).

## 2. General description

- **System context:** Operates as a local Deno engine process triggered by CLI command (`deno task run [--prompt "..."]`). The engine reads workflow DAG config (`.flowai-workflow/workflow.yaml`), executes nodes sequentially via `claude` CLI, validates outputs, and commits artifacts. PM agent autonomously triages open GitHub issues; `--prompt` passes optional additional context. Agents communicate through files in the repository.
- **Assumptions and constraints:**
  - A devcontainer provides the runtime environment with all required tools (see FR-S10).
  - Each agent is stateless between runs — all context comes from input artifacts and its system prompt.
  - The target project is this repository (flowai-workflow). Workflow design should be project-agnostic for future reuse in other repos.
- **Goal:** Automate the full development cycle for feature requests: from issue triage to a ready-to-merge PR — fully autonomous, no human gates between stages. PR merge is the only human checkpoint (post-workflow, not between stages).

## 3. Functional Requirements

### 3.1 FR-S1 (ex FR-1): Workflow Trigger

- **Description:** Single entry point `deno task run [--prompt "..."]`. PM agent autonomously triages open GitHub issues — selects highest-priority open issue, fetches its title and body, and writes `issue: <N>` in `01-spec.md` YAML frontmatter. `--prompt` provides optional additional context passed to the PM agent.
- **Acceptance criteria:**
  - [x] `deno task run` starts workflow; PM selects highest-priority open issue autonomously. Evidence: `engine/cli.ts:36-76` (CLI argument parsing + workflow entry point), `.flowai-workflow/agents/agent-pm/SKILL.md` (PM triage logic via `gh issue list`)
  - [x] `deno task run --prompt "..."` passes additional context string to PM agent. Evidence: `engine/cli.ts:40-42` (`--prompt` arg parsed into `cliArgs.prompt`)
  - [x] PM writes `issue: <N>` in `01-spec.md` YAML frontmatter after issue selection. Evidence: `.flowai-workflow/agents/agent-pm/SKILL.md` (Output Format section mandates YAML frontmatter with `issue: N`)
  - [x] Common engine flags (`--resume`, `--dry-run`, `-v`, `-q`, `--config`) work with the single entry point. Evidence: `engine/cli.ts:36-76` (`--resume` :43-45, `--dry-run` :47-49, `-v` :50-53, `-q` :58-61, `--config` :37-39)

### 3.2 FR-S2 (ex FR-2): Stage 1 — Project Manager (Specification)

- **Description:** The PM agent reads the issue, analyzes existing documentation, and produces a specification. PM updates only the SRS (what needs to be done), not the SDS (how to do it — that's the Tech Lead's job).
- **Input:** Issue title + body, `documents/requirements-sdlc.md`, `documents/design-sdlc.md`, `AGENTS.md`.
- **Output:** `.flowai-workflow/workflow/<issue-number>/01-spec.md`, updated `documents/requirements-sdlc.md`.
- **Acceptance criteria:**
  - Agent updates `documents/requirements-sdlc.md` with new/modified requirements (marked with status markers per CLAUDE.md conventions).
  - Agent produces `01-spec.md` containing:
    - Problem statement (from the issue).
    - Affected requirements (references to existing FR-* items).
    - Summary of SRS changes made.
    - Scope boundaries (what is NOT included).
  - Output is committed to a feature branch `agent/<run-id>`.
- **Quality metrics:**
  - `01-spec.md` contains all four required sections (problem, affected requirements, SRS changes, scope).
  - Every new requirement in `requirements-sdlc.md` has a status marker.
  - No SDS-level details (implementation, data structures, algorithms) in the output.

### 3.3 FR-S3 (ex FR-3): Stage 2 — Architect (Design-Solution Plan)

- **Description:** The Architect agent (FR-S15: renamed from Tech Lead) reads the specification and produces a design-solution plan with 2-3 implementation variants.
- **Input:** `01-spec.md`, `documents/requirements-sdlc.md`, `documents/design-sdlc.md`, relevant source code.
- **Output:** `02-plan.md` in node output directory.
- **Acceptance criteria:**
  - Agent reads all input artifacts listed above.
  - Agent produces `02-plan.md` containing:
    - 2-3 implementation variants with pros/cons/effort estimates.
    - Affected files and components per variant.
    - Risk assessment per variant.
  - Plan follows the project's existing planning conventions.
- **Quality metrics:**
  - Each variant references concrete files/modules from the codebase (no vague "update the service").
  - Effort estimates are relative to each other (e.g., S/M/L), not absolute time.
  - Risk assessment mentions at least one risk per variant.

### 3.4 FR-S4 (ex FR-4): Plan Critique & Revision (absorbed into Tech Lead, FR-S15)

- **Description:** Plan critique and revision functionality is now absorbed into the Tech Lead agent (FR-S5). The Tech Lead critiques the Architect's plan, selects a variant, and produces the task breakdown — all in one stage. Separate reviewer agent eliminated (FR-S15).
- **Previous input/output:** `02-plan.md` → `03-revised-plan.md` (no longer produced as separate artifact).
- **Acceptance criteria:**
  - Critique is embedded in Tech Lead's `03-decision.md` body (at least one issue per variant).
  - No separate reviewer node in `workflow.yaml`.

### 3.5 FR-S5 (ex FR-5): Stage 3 — Tech Lead (Decision + Branch + PR)

- **Description:** The Tech Lead agent (FR-S15: renamed from Architect) critiques the Architect's plan, selects the final implementation variant, updates the SDS, creates a feature branch and draft PR, and produces a task breakdown for the Developer. Absorbs former reviewer (FR-S4) and SDS-update (FR-S6) responsibilities.
- **Input:** `02-plan.md`, `01-spec.md`, `documents/requirements-sdlc.md`, `documents/design-sdlc.md`, `AGENTS.md`, relevant source code.
- **Output:** `03-decision.md` in node output directory, updated `documents/design-sdlc.md`, feature branch, draft PR.
- **Decision document format:** Every `03-decision.md` MUST begin with YAML frontmatter:
  ```
  ---
  variant: "Variant B"
  tasks:
    - desc: "Add validation function"
      files: ["src/validate.ts", "src/validate_test.ts"]
    - desc: "Update config schema"
      files: ["src/config.ts"]
  ---
  ```
  - `variant` field: required, string — name of the selected variant.
  - `tasks` field: required, array of objects. Each object:
    - `desc`: string — atomic task description.
    - `files`: array of strings — relative file paths the task will create or modify.
  - Tasks MUST be ordered by dependency (blocking tasks first).
  - Parsing file allowlist: `yq --front-matter=extract '.tasks[].files[]' 03-decision.md`.
- **Branch naming:** `sdlc/issue-<N>` for issue-driven runs, `sdlc/{{run_id}}` for `--prompt` mode.
- **Acceptance criteria:**
  - Agent reads all input artifacts listed above.
  - Agent critiques each variant (at least one issue per variant).
  - Agent selects one variant with a justification covering:
    - Technical fit (from the plan).
    - Alignment with product vision and project conventions.
    - Complexity/maintainability trade-off.
  - Agent produces `03-decision.md` starting with YAML frontmatter containing `variant` and `tasks` fields (see format above), followed by critique, justification, and detailed task descriptions.
  - Agent updates `documents/design-sdlc.md` with selected variant's design details.
  - Agent creates feature branch and opens draft PR.
- **Quality metrics:**
  - Justification references at least one point from `AGENTS.md`.
  - Task checklist is ordered by dependency (blocking tasks first).
  - Each task is atomic — achievable in a single commit.
  - Tech Lead prompt MUST include a concrete YAML frontmatter example to ensure LLM compliance.

### 3.6 FR-S6 (ex FR-6): SDS Update (absorbed into Tech Lead, FR-S15)

- **Description:** SDS update functionality is now absorbed into the Tech Lead agent (FR-S5). The Tech Lead updates `documents/design-sdlc.md` as part of its decision-making stage. Separate sds-update agent eliminated (FR-S15).
- **Previous input/output:** `03-decision.md` → updated `documents/design-sdlc.md` (now done by Tech Lead).
- **Acceptance criteria:**
  - Tech Lead updates `documents/design-sdlc.md` with selected variant's design details.
  - No separate sds-update node in `workflow.yaml`.

### 3.7 FR-S7 (ex FR-7): Stage 6-7 — Developer + QA (Iterative Implementation Loop)

- **Description:** The Developer and QA agents work as an iterative pair. Developer implements, QA verifies. If QA finds issues, Developer fixes them. The loop continues until QA passes or the iteration limit is reached.
- **Orchestration:** The loop is managed by the engine's `loop` node type (`engine/loop.ts`). It invokes the Developer agent, then QA agent. Based on the QA verdict, it either exits the loop (on `PASS`) or re-invokes the Developer with the QA report (on `FAIL`). Legacy: `stage-6-developer.sh` calls `stage-7-qa.sh` as sub-step.
- **Developer Input:** `03-decision.md`, `documents/requirements-sdlc.md`, `documents/design-sdlc.md`, source code. On subsequent iterations: previous QA report (`05-qa-report.md`).
- **Developer Output:** Code changes, tests, commits and pushes on feature branch. PR comment with implementation summary.
- **QA Input:** `01-spec.md`, `03-decision.md`, all changed files, test results.
- **QA Output:** `05-qa-report.md` in node output directory. PR review verdict (`gh pr review`: approve/request-changes).
- **QA report format:** Every `05-qa-report-<iteration>.md` MUST begin with YAML frontmatter:
  ```
  ---
  verdict: PASS
  ---
  ```
  - `verdict` field: required, enum `PASS` | `FAIL`.
  - Frontmatter MUST be the first content in the file (lines 1-3 minimum).
  - Primary parsing: `yq --front-matter=extract '.verdict' 05-qa-report.md` (requires yq >= 4.18).
  - Fallback parsing: `sed -n '2p' 05-qa-report.md | grep -oE '(PASS|FAIL)'` (no yq dependency).
- **Acceptance criteria:**
  - **Developer:**
    - Agent reads all input artifacts listed above.
    - Agent implements changes following project code style rules (from CLAUDE.md).
    - Agent writes tests before or alongside implementation.
    - Agent commits and pushes changes after each task (`git add`, `git commit`, `git push`). Commit format: `sdlc(impl): <summary>`.
    - Agent posts PR comment with implementation summary after all tasks complete.
    - On iterations > 1: agent reads the previous QA report and fixes reported issues.
  - **QA:**
    - Agent runs `deno task check` and verifies it passes.
    - Agent verifies each acceptance criterion from the specification.
    - Agent produces `05-qa-report.md` starting with YAML frontmatter containing `verdict: PASS` or `verdict: FAIL`, followed by:
      - Pass/fail status per acceptance criterion.
      - List of issues found (if any).
      - `deno task check` output summary.
      - Verdict details (human-readable explanation).
    - Agent posts verdict as PR review (`gh pr review --approve` or `--request-changes`).
    - If `PASS`: loop ends, proceeds to next stage.
    - If `FAIL`: loop repeats with the next Developer iteration.
  - **Loop config structure:**
    - [ ] Loop body nodes (`developer`, `qa`) MUST be defined inline within the loop node config, not as top-level workflow nodes. Body node IDs are loop-scoped.
    - [ ] Body nodes can declare `inputs` referencing both sibling body nodes (within the same loop) and external top-level nodes.
    - [ ] `{{loop.iteration}}` template variable is only available in loop body node contexts.
  - **Loop constraints:**
    - Maximum iterations: configurable (default 3).
    - If limit reached without `PASS`: workflow stops and reports failure on the issue. Meta-Agent is triggered (see FR-S8).
- **Quality metrics:**
  - `deno task check` passes on every Developer commit (enforced by stage script, see engine SRS FR-8).
  - QA report covers 100% of acceptance criteria from `01-spec.md`.
  - Each QA issue has: description, affected file, severity (blocking/non-blocking).
  - `qa.md` prompt MUST include a concrete YAML frontmatter example to ensure LLM compliance.

### 3.8 FR-S8 (ex FR-9): Stage 8 — Presenter (Change Summary) — ABSORBED

- **Status:** Absorbed into Tech Lead (FR-S5) and Tech Lead Review (FR-S15).
  Tech Lead creates draft PR with summary; Tech Lead Review performs final
  review + merge. No separate Presenter agent.
- **Previous description:** Presenter agent created human-readable change
  summary for PR description. Functionality now covered by:
  - Tech Lead: draft PR creation with implementation plan summary.
  - Developer: PR comments with implementation progress (FR-S7).
  - Tech Lead Review: final review, CI gate, merge decision.

### 3.9 FR-S9 (ex FR-11): Meta-Agent (Prompt Optimization)

- **Description:** A dedicated agent that runs after every workflow execution (both success and failure). It analyzes the logs of the current run, identifies errors, friction points, and inefficiencies, and produces actionable prompt improvement suggestions.
- **Trigger conditions:**
  - **On workflow success:** runs as the final stage after Presenter (Stage 9).
  - **On workflow failure:** runs automatically when any stage fails after exhausting its continuation limit.
- **Trigger mechanism:** Engine executes meta-agent node as a post-workflow node. In `workflow.yaml`, the meta-agent node is configured with `run_on: always` (engine SRS FR-25) to run regardless of upstream success/failure. Failed node ID identified via `state.json` (nodes with `status: "failed"`). Engine does NOT write a separate `failed-node.txt` — that violates engine SRS FR-29.
- **Input:**
  - `.flowai-workflow/memory/agent-meta-agent.md` — own reflection memory (read first; FR-S28).
  - Run logs from `<run-dir>/logs/` and `state.json` (failed node context from `nodes[*].status` field; no `failed-node.txt`).
  - Current agent prompts from `.flowai-workflow/agents/agent-*/`.
- **Output:**
  - Primary: edited `.flowai-workflow/agents/agent-*/SKILL.md` (prompt fixes).
  - Secondary: `<run-dir>/meta-agent/07-changelog.md` (minimal fix log).
  - Persistent: updated `.flowai-workflow/memory/agent-meta-agent.md` (own reflection memory; FR-S28).
- **Acceptance criteria:**
  - Agent analyzes logs, diagnoses problems, and edits agent prompts directly.
  - `07-changelog.md` lists each fix with evidence (turns/cost/error data).
  - `.flowai-workflow/memory/agent-meta-agent.md` rewritten with new patterns, fix outcomes, baselines (FR-S28).
  - Does NOT produce verbose reports — focus is on prompt optimization.
  - [ ] `.flowai-workflow/agents/agent-meta-agent/SKILL.md` Input section references `state.json` for failed-node context; no `failed-node.txt` reference (engine SRS FR-29 compliance).
- **Quality metrics:**
  - Every fix references specific log data as evidence.
  - Fixes are minimal, targeted, and testable in next run.

### 3.10 FR-S10 (ex FR-12): Runtime Infrastructure

- **Description:** Workflow runs locally inside a devcontainer. The Deno engine orchestrates agent invocations. Legacy shell scripts preserved for backward compatibility.
- **Devcontainer contents** (`.devcontainer/Dockerfile`):
  - `claude` CLI (Claude Code) — installed via `npm install -g @anthropic-ai/claude-code`.
  - `deno` runtime — for running project checks, tests, and the workflow engine.
  - `git` — for branch management, commits, and diff-based safety checks.
  - `gh` CLI — for creating PRs and posting issue comments.
  - `gitleaks` — for secret detection in diff-based safety checks (see engine SRS FR-8).
- **Stage scripts (legacy):**
  - Located in `.flowai-workflow/scripts/stage-<N>-<role>.sh`.
  - Each script is responsible for:
    1. Preparing input: collecting handoff artifacts, setting environment variables.
    2. Invoking `claude` CLI with the agent prompt from `.flowai-workflow/agents/agent-<role>/SKILL.md`.
    3. Running stage-specific validation (artifact checks, `deno task check` for Developer).
    4. Implementing the Continuation mechanism (engine SRS FR-8): re-invoking via `--resume` on validation failure.
    5. Committing output artifacts and logs to the feature branch.
    6. Reporting stage status to the GitHub Issue via `gh`.
  - Scripts share common functions via `.flowai-workflow/scripts/lib.sh` (logging, git operations, continuation loop, artifact validation).
- **Acceptance criteria:**
  - Devcontainer builds successfully and contains all listed tools.
  - Primary launch: `deno task run [--prompt "..."]` (engine path).
  - Legacy: each stage can be run independently via `.flowai-workflow/scripts/stage-1-pm.sh`.
  - Stage scripts are executable and pass `shellcheck` without errors.
  - **Retry logic:** `lib.sh` implements a generic retry wrapper (`retry_with_backoff`) used for all external API calls (`claude` CLI, `gh` CLI). Parameters: max attempts = 3, initial delay = 5s, backoff multiplier = 2x. Retryable conditions: non-zero exit code from CLI tools (network errors, rate limits). Non-retryable: validation failures, agent logic errors.

### 3.11 FR-S11 (ex FR-14): Inter-Stage Data Flow & Commit Strategy

- **Description:** Defines how data flows between workflow stages and when commits happen on the feature branch.
- **Data flow:**
  - Engine path: artifacts stored in `.flowai-workflow/runs/<run-id>/[<phase>/]<node-id>/` (phase subdir present when node's `phase` field is set in `workflow.yaml`; flat `<node-id>/` otherwise). Linked via `{{input.<node-id>}}` templates. Phase-aware directory creation depends on engine FR-E9 implementation. Evidence: `documents/design-sdlc.md` §2.2 (Artifact Store subsystem description).
  - Legacy path: artifacts in `.flowai-workflow/workflow/<issue-number>/`.
  - The file system is the single source of truth for inter-stage communication. No manifest or registry.
  - Claude CLI's built-in context auto-compression handles large input sets; no manual context management is required.
- **Commit strategy (FR-S15):**
  - Feature branch `sdlc/issue-<N>` created by Tech Lead agent. Fallback `sdlc/{{run_id}}` for `--prompt` mode.
  - Engine does NOT auto-commit after nodes (invariant preserved).
  - No dedicated committer agent nodes. Developer owns commits: `git add`, `git commit`, `git push` after each task. Commit format: `sdlc(impl): <summary>`.
  - Tech Lead creates draft PR before impl-loop. Developer pushes to same branch.
  - QA posts PR review verdicts. Tech-lead-review performs final review + merge.
  - Legacy scripts commit + push after each stage (unchanged).
- **Branch lifecycle:**
  - Branch created by Tech Lead agent after variant selection.
  - On re-run, existing branch is reused — new commits overwrite previous artifacts (previous versions preserved in git history per FR-13).
  - Branch is merged via tech-lead-review post-workflow agent.
- **Acceptance criteria:**
  - [x] Engine does NOT auto-commit after any node. Evidence: `engine.ts` — no `commitIfNeeded()` calls
  - Developer commits/pushes own code during implementation.
  - Tech Lead creates feature branch and draft PR.
  - Tech-lead-review merges PR if CI passes.

### 3.12 FR-S12 (ex FR-16): Secrets

- **Description:** Defines the required secrets for workflow operation.
- **Authentication:**
  - **Claude Code CLI:** OAuth session (`claude login`) or `ANTHROPIC_API_KEY` env var. OAuth is the default method in devcontainer; API key is an optional alternative.
  - `GITHUB_TOKEN` — used by `gh` CLI for PR creation and issue comments. Must have `issues:write`, `pull-requests:write`, `contents:write` permissions. Can be obtained via `gh auth token`.
- **Acceptance criteria:**
  - Claude CLI auth is available (OAuth session or API key) before running the engine.
  - No secrets are hardcoded in scripts, prompts, or Dockerfile.
  - Diff-based safety checks (engine SRS FR-8) detect and reject any secret-like patterns in agent-produced code.

### 3.13 FR-S13 (ex FR-19): Agents as Skills

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

### 3.14 FR-S14 (ex FR-22): Project Documentation (README)

- **Description:** README.md must accurately reflect current project state: vision, architecture (DAG-based engine), usage (`deno task run` with flags), prerequisites (Deno, Docker/devcontainer, Claude CLI, `gh`), available `deno task` commands, configuration mechanism (YAML `workflow.yaml`), project directory structure, and agents-as-skills.
- **Scenario:** A new contributor reads README.md and gets correct, up-to-date information about how to set up, configure, and run the workflow.
- **Acceptance criteria:**
  - [ ] README.md reflects DAG-based engine architecture (not shell script orchestration).
  - [ ] Usage section documents `deno task run` with current flags (`--prompt`, `--resume`, `--dry-run`, `-v`, `-q`, `--config`, `--skip`, `--only`, `--env`).
  - [ ] Prerequisites list: Deno, Docker/devcontainer, Claude Code CLI, `gh` CLI, Git.
  - [ ] Available `deno task` commands documented (run, check, test).
  - [ ] Configuration section references `workflow.yaml` (not env vars).
  - [ ] Project directory structure matches actual layout (`engine/`, `.flowai-workflow/runs/`, `.claude/skills/`).
  - [ ] Agents-as-skills mentioned with `/agent-<name>` slash command examples.
  - [ ] Installation/setup instructions are accurate for devcontainer workflow.

### 3.15 FR-S15 (ex FR-26): Align Workflow Git Workflow with Standard GitHub Practices

- **Description:** Restructure workflow agent roles and git workflow to match
  standard GitHub development practices. Rename/merge agents to reflect
  real-world roles, eliminate artificial agents (committer, reviewer), move git
  operations (branch, commit, push, PR) to the agents that own the work, and
  use PRs (not issues) as the primary communication channel for code review.
- **Motivation:** Current workflow diverges from standard practices: roles are
  misnamed (tech-lead does architecture, architect does tech-lead work),
  artificial roles exist (committer, reviewer), git operations are deferred to
  separate committer nodes, and QA/review communication happens in issues
  instead of PRs.
- **Target workflow flow:**
  ```
  pm → architect → tech-lead → impl-loop(developer, qa) → tech-lead-review
                                                           ↑
                                                    meta-agent (run_always)
  ```
  5 agent invocations in happy path (was 8): pm, architect, tech-lead,
  developer, qa — plus tech-lead-review and meta-agent as post-workflow.
- **Role changes:**
  - `tech-lead` node (current) → renamed to **`architect`** (designs solution
    with variants). Prompt: `.flowai-workflow/agents/agent-architect/SKILL.md`.
  - `reviewer` node → **removed**. Design review absorbed into new tech-lead.
  - `architect` node (current) → renamed to **`tech-lead`** (reviews design,
    selects variant, task breakdown, updates SDS, creates branch
    `sdlc/issue-<N>`, opens draft PR). Absorbs reviewer + sds-update roles.
  - `tech-lead-sds` node → **removed**. SDS update absorbed into new tech-lead.
  - `committer` nodes → **removed**. Developer commits/pushes own code.
  - New **`tech-lead-review`** node (`run_on: always`) — final code review in
    PR, CI gate, merge if green.
- **Git workflow changes:**
  - **Tech-lead** creates feature branch `sdlc/issue-<N>` + opens draft PR
    after making decision. Fallback branch `sdlc/<run-id>` for `--prompt` mode.
  - **Developer** commits and pushes during implementation, posts progress as PR
    comments.
  - **QA** posts results as PR review (`gh pr review --approve` or
    `--request-changes`), not issue comments.
  - **Tech-lead-review** reviews PR diff, checks CI, merges or leaves open.
- **File changes:**
  - Rename `.flowai-workflow/agents/agent-tech-lead/` ↔ `.flowai-workflow/agents/agent-architect/` (swap roles).
  - Expand `.flowai-workflow/agents/agent-tech-lead/SKILL.md` (design review, SDS update, branch creation, draft PR).
  - Delete `.flowai-workflow/agents/agent-tech-lead-reviewer/`, `.flowai-workflow/agents/agent-tech-lead-sds/`,
    `.flowai-workflow/agents/agent-committer/`.
  - Update `.flowai-workflow/agents/agent-developer/SKILL.md` — add commit/push, PR comments. (FR-S18: formerly `agent-executor`)
  - Update `.flowai-workflow/agents/agent-qa/SKILL.md` — PR review instead of issue comments.
  - New `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md` — code review + CI gate + merge.
  - Update `workflow.yaml` — new DAG with fewer nodes.
- **Invariants (no changes):**
  - `engine/` — engine remains domain-agnostic, no code changes.
  - `.flowai-workflow/agents/agent-pm/` — no changes.
  - `.flowai-workflow/agents/agent-meta-agent/` — no changes.
- **Acceptance criteria:**
  - [x] Agent directory `.flowai-workflow/agents/agent-architect/` contains design-solution prompt. Evidence: `.flowai-workflow/agents/agent-architect/SKILL.md`
  - [x] Agent directory `.flowai-workflow/agents/agent-tech-lead/` contains expanded prompt: critique + variant selection + task breakdown + SDS update + branch creation + draft PR. Evidence: `.flowai-workflow/agents/agent-tech-lead/SKILL.md`
  - [x] `agent-tech-lead-reviewer`, `agent-tech-lead-sds`, `agent-committer` deleted. Evidence: directories removed; `agents/` directory removed (commit `985e3e5`)
  - [x] `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md` created with code review + CI gate + merge logic. Evidence: `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md:21-24`
  - [x] `.flowai-workflow/agents/agent-developer/SKILL.md` exists: commits/pushes own code, posts PR comments, "do not commit" rule removed. Evidence: commit `f0085df sdlc(impl): rename Executor agent role to Developer (FR-37)`, `.flowai-workflow/agents/agent-developer/SKILL.md`
  - [x] `.flowai-workflow/agents/agent-qa/SKILL.md` updated: posts PR reviews via `gh pr review` ONLY (no issue comments). Evidence: `.flowai-workflow/agents/agent-qa/SKILL.md`
  - [x] `workflow.yaml` updated: `finalize` (committer) node removed; `review` node renamed to `tech-lead-review` using `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md` with `run_on: always` + merge capability. Evidence: `.flowai-workflow/workflow.yaml:163-184`
  - [x] Agent skill directories present as `.flowai-workflow/agents/agent-*/` (no `.claude/skills/` symlinks). Evidence: commit `6176e91`, `985e3e5`; FR-S33 removes remaining `.claude/skills/ agent-*` symlinks
  - [x] Workflow produces 5 agent invocations in happy path (pm, architect, tech-lead, developer, qa) plus 1 post-workflow (tech-lead-review). Evidence: commit `f0085df`, `.flowai-workflow/workflow.yaml` (developer node in impl-loop)
  - [x] Developer creates commits on feature branch during implementation. Evidence: commit `f0085df`, `.flowai-workflow/agents/agent-developer/SKILL.md`
  - [x] QA posts review on PR only (not issue comment). Evidence: `.flowai-workflow/agents/agent-qa/SKILL.md`
  - [x] Tech-lead-review merges PR if CI green, or leaves open with comments. Evidence: `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md`
  - [x] `--prompt` mode (no GitHub issue) uses fallback branch name `sdlc/<run-id>`. Evidence: `.flowai-workflow/agents/agent-tech-lead/SKILL.md`
  - [x] All existing engine tests pass (no engine code changes). Evidence: engine/ unchanged.
  - [x] `deno task check` passes after all changes. Evidence: validated post-implementation.
  - [x] SRS, SDS updated to reflect final workflow structure. Evidence: `documents/requirements-sdlc.md`, `documents/design-sdlc.md`

### 3.16 FR-S16 (ex FR-35): Dashboard Result Summary Display

- **Description:** HTML dashboard cards for workflow nodes must display at least the first 3 lines of the agent result text. Long results must be collapsible (expand on click). Single-line results display inline without unnecessary whitespace. Prior implementation used `white-space: nowrap; text-overflow: ellipsis` truncating multi-line results to ~40 chars.
- **Acceptance criteria:**
  - [x] `renderCard()` in `scripts/generate-dashboard.ts` uses `<details>/<summary>` for multi-line results (>1 line): first 3 lines in `<summary>`, full text in `<details>` body. Evidence: `scripts/generate-dashboard.ts:73-77`
  - [x] Single-line results render as `<p class="result">` without `<details>` wrapper. Evidence: `scripts/generate-dashboard.ts:72`
  - [x] No `white-space: nowrap; text-overflow: ellipsis` CSS for result text. Evidence: `scripts/generate-dashboard.ts:189` (`white-space:pre-wrap`)
  - [x] `escHtml()` applied to all result content to prevent XSS. Evidence: `scripts/generate-dashboard.ts:74-75`
  - [x] Unit tests cover: multi-line result (details/summary structure), single-line result (p tag), empty result, HTML special chars in result. Evidence: `scripts/generate-dashboard_test.ts:100-170`
  - [x] `deno task check` passes. Evidence: confirmed by CI run on branch `sdlc/issue-47`

### 3.17 FR-S17 (ex FR-36): Agentskills.io-Compliant Skill Layout

- **Description:** All workflow agent skills must conform to the [agentskills.io specification](https://agentskills.io/specification). Canonical skill directories live in `.flowai-workflow/agents/agent-<name>/`. Associated stage scripts co-located under `scripts/` subdirectory of each skill. Frontmatter uses only spec-defined fields.
- **Motivation:** Spec compliance enables standard skill tooling and discovery. Co-location reduces cognitive overhead. Removing the `agents/` → `.claude/skills/` symlink indirection eliminates broken-symlink failure mode.
- **Acceptance criteria:**
  - [x] Each skill directory `.flowai-workflow/agents/agent-<name>/` contains `SKILL.md` with frontmatter fields: `name` (matches directory name), `description`, `compatibility`, `allowed-tools`. No `disable-model-invocation` field. Expected: `.flowai-workflow/agents/agent-pm/SKILL.md`, `.flowai-workflow/agents/agent-architect/SKILL.md`, `.flowai-workflow/agents/agent-tech-lead/SKILL.md`, `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md`, `.flowai-workflow/agents/agent-developer/SKILL.md`, `.flowai-workflow/agents/agent-qa/SKILL.md`, `.flowai-workflow/agents/agent-meta-agent/SKILL.md`. Evidence: commit `f0085df sdlc(impl): rename Executor agent role to Developer (FR-37)`; QA PASS run `20260314T000902` (436 tests)
  - [x] Stage scripts formally deprecated (superseded by engine); co-location N/A for deprecated scripts. Evidence: deprecation headers added to all `.flowai-workflow/scripts/stage-*.sh`; `AGENT_PROMPT` paths updated to `.flowai-workflow/agents/agent-<name>/SKILL.md` (this commit).
  - [x] `hitl-ask.sh`, `hitl-check.sh`, `lib.sh`, and shared utilities remain in `.flowai-workflow/scripts/` (engine infrastructure, not agent skills). Evidence: `.flowai-workflow/scripts/hitl-ask.sh`, `.flowai-workflow/scripts/hitl-check.sh`, `.flowai-workflow/scripts/lib.sh`
  - [x] `agents/` top-level directory removed; no broken symlinks in `.claude/skills/`. Evidence: commit `985e3e5 sdlc(impl): remove agents/ directory and fix stale path references`
  - [x] `workflow.yaml` `prompt:` fields updated to `.flowai-workflow/agents/agent-<name>/SKILL.md`. Evidence: `.flowai-workflow/workflow.yaml` (commit `6176e91`)
  - [x] `documents/requirements-sdlc.md` path references updated to reflect new `.claude/skills/` layout and FR-S18 rename. Evidence: this update (run `20260314T010515`); commit `f0085df`
  - [x] `deno task check` passes after migration. Evidence: QA PASS — 436 tests pass (run `20260313T230627`)

### 3.18 FR-S18 (ex FR-37): Rename Executor Agent to Developer

- **Description:** Rename the `executor` agent to `developer` across all project files. The executor agent's actual role — writing code, committing, pushing, posting PR comments — matches the industry term "developer", not the generic "executor". All other workflow agents use role-based names; this rename completes the alignment.
- **Scope:** Pure rename — no behavioral changes. Affected artifacts: agent skill directory, workflow config node IDs, all SKILL.md cross-references, legacy shell scripts, engine test fixtures, and documentation.
- **Acceptance criteria:**
  - [x] `.flowai-workflow/agents/agent-executor/` directory renamed to `.flowai-workflow/agents/agent-developer/`. `SKILL.md` frontmatter `name` field updated to `agent-developer`. Evidence: commit `f0085df sdlc(impl): rename Executor agent role to Developer (FR-37)`
  - [x] `.flowai-workflow/workflow.yaml`: loop body node id `executor` → `developer`; all `{{input.executor}}` → `{{input.developer}}` template references updated. Evidence: commit `f0085df`
  - [x] All agent `SKILL.md` files: `{{input.executor}}` → `{{input.developer}}` in cross-agent references. Evidence: commit `f0085df`
  - [x] Legacy scripts renamed: `stage-6-executor.sh` → `stage-6-developer.sh`; internal refs and `AGENT_PROMPT` path updated. `stage-7-qa.sh` executor output references updated. Evidence: commit `f0085df`
  - [x] Engine test fixtures: node IDs using `executor` as example updated to `developer`. Evidence: commit `f0085df`
  - [x] Documentation updated: `documents/requirements-sdlc.md`, `documents/design-sdlc.md`, `AGENTS.md` (if applicable), `README.md`, `documents/meta.md`. Evidence: commit `f0085df`; QA PASS run `20260314T000902` (436 tests)
  - [x] `deno task check` passes after all changes. Evidence: QA PASS run `20260314T000902` — 436 tests pass

### 3.19 FR-S19 (ex FR-38): Timeline Visualization in Dashboard

- **Description:** HTML dashboard must include a Gantt-style timeline section
  showing each workflow node as a horizontal bar. Bar position reflects
  `started_at` offset from run start; bar width reflects `duration_ms`.
  Parallel nodes appear stacked vertically at the same horizontal offset. The
  longest-duration node (bottleneck) is visually highlighted.
- **Rationale:** Current dashboard renders node cards with no temporal view,
  making it impossible to identify parallelism, sequencing, or bottlenecks at
  a glance. `NodeState` already records `started_at`, `completed_at`, and
  `duration_ms` — no engine changes required.
- **Acceptance criteria:**
  - [x] Dashboard HTML includes a Gantt-style timeline section (rendered in
    `generate-dashboard.ts`). Evidence: `scripts/generate-dashboard.ts:117` (`computeTimeline`), `scripts/generate-dashboard.ts:152` (`renderTimeline`), `scripts/generate-dashboard.ts:305-306` (integrated in `renderHtml`).
  - [x] Each node rendered as a horizontal bar: left offset =
    `(node.started_at − run.started_at) / total_duration`; width =
    `node.duration_ms / total_duration` (proportional, percentage-based CSS). Evidence: `scripts/generate-dashboard.ts:140-141` (`offsetPct`, `widthPct` computation).
  - [x] Parallel nodes (overlapping time ranges) are stacked vertically in the
    timeline view (each on its own row). Evidence: `scripts/generate-dashboard.ts:165` (`<div class="timeline-row">` per bar).
  - [x] Bottleneck node (max `duration_ms`) is visually distinguished (e.g.,
    distinct fill color or border). Evidence: `scripts/generate-dashboard.ts:143` (`isBottleneck` flag), `scripts/generate-dashboard.ts:160-161` (CSS class applied), `scripts/generate-dashboard.ts:371` (`.timeline-bottleneck` CSS).
  - [x] Nodes with missing `started_at` or `duration_ms` (skipped/pending) are
    omitted from the timeline. Evidence: `scripts/generate-dashboard.ts:123` (`continue` on missing timing).
  - [x] Timeline renders correctly when only one node has timing data. Evidence: `scripts/generate-dashboard_test.ts:323` (single-node test).
  - [x] No external CDN dependencies; all CSS/JS inlined. Evidence: `scripts/generate-dashboard.ts:369-372` (timeline CSS in inlined `CSS` const).
  - [x] `escHtml()` applied to node labels rendered in the timeline. Evidence: `scripts/generate-dashboard.ts:163` (`label = escHtml(nodeId)`).
  - [x] Unit tests cover: bar position/width calculation, bottleneck detection,
    parallel node stacking, single-node edge case, missing-timing omission. Evidence: `scripts/generate-dashboard_test.ts:288-472`.
  - [x] `deno task check` passes. Evidence: QA PASS — all tests pass (run `20260314T060523`).

### 3.20 FR-S20 (ex FR-40): Dashboard Stream Log Links

- **Description:** Each node card in the HTML dashboard must include a direct
  link to that node's `stream.log` execution log when the file exists. The link
  must be visually distinct from artifact `.md` links (e.g., labeled
  "execution log" or styled differently). Enables direct navigation from a
  failing node card to its detailed execution log without manual filesystem
  navigation.
- **Motivation:** Stream logs are the primary debugging tool for workflow
  failures. The dashboard currently lists only `.md` output artifacts;
  execution logs (`stream.log`) are not linked, making them hard to discover.
  `scanArtifacts` already surfaces `stream.log` in node directories but
  dashboard rendering ignores it.
- **Acceptance criteria:**
  - [x] `renderCard()` in `scripts/generate-dashboard.ts` checks for existence
    of `<node-dir>/stream.log` and includes a link when the file exists.
    Evidence: `scripts/generate-dashboard.ts:47-51` (`renderCard` accepts
    `streamLogHref?`), `scripts/generate-dashboard.ts:82-84` (conditional
    `logLinkHtml`), `scripts/generate-dashboard.ts:419-430` (CLI scans via
    `Deno.stat()`, builds href map).
  - [x] Stream log link is visually distinct from artifact links (e.g.,
    different label such as "execution log", distinct CSS class or style).
    Evidence: `scripts/generate-dashboard.ts:380` (`.log-link` CSS class:
    monospace, 0.75rem, muted color `#6b7280`), `scripts/generate-dashboard.ts:83`
    (`class="log-link"` on anchor).
  - [x] If `stream.log` does not exist for a node, no broken link is rendered.
    Evidence: `scripts/generate-dashboard.ts:82-84` (renders only when
    `streamLogHref` is provided; absent → empty string).
  - [x] `escHtml()` applied to stream log link path/label to prevent XSS.
    Evidence: `scripts/generate-dashboard.ts:83` (`escHtml(streamLogHref)`
    in href attribute).
  - [x] Unit tests cover: stream.log present (link shown), stream.log absent
    (no link), HTML escaping of path.
    Evidence: `scripts/generate-dashboard_test.ts:641-647` (link present),
    `scripts/generate-dashboard_test.ts:649-654` (no link when absent),
    `scripts/generate-dashboard_test.ts:656-678` (threading via `renderHtml`).
  - [x] `deno task check` passes. Evidence: 483 tests pass, 0 failed.

### 3.21 FR-S21 (ex FR-42): Agent Output Summary Section

- **Description:** Every agent in the workflow must produce a `## Summary`
  section in its primary output artifact. The workflow validation must enforce
  its presence via `contains_section: Summary` rule. Ensures traceability:
  any operator or downstream agent can read a single section to understand
  what the stage accomplished.
- **Motivation:** Agent artifacts vary widely in length (spec: ~1 page;
  QA report: multi-page). Without a mandatory summary, downstream agents and
  operators must parse the full artifact to assess outcomes — increasing cost
  and latency.
- **Acceptance criteria:**
  - [x] All 6 agent SKILL.md files include documented requirement for a
    `## Summary` section in their output artifact.
    Agents: `agent-pm`, `agent-architect`, `agent-tech-lead`,
    `agent-developer`, `agent-qa`, `agent-tech-lead-review`.
    Evidence: `.flowai-workflow/agents/agent-pm/SKILL.md:113`,
    `.flowai-workflow/agents/agent-architect/SKILL.md:120`,
    `.flowai-workflow/agents/agent-tech-lead/SKILL.md:87`,
    `.flowai-workflow/agents/agent-developer/SKILL.md:92`,
    `.flowai-workflow/agents/agent-qa/SKILL.md:113`,
    `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md:55`.
  - [x] `workflow.yaml` validation rules include `contains_section: Summary`
    for all 6 agent nodes (`specification`, `design`, `decision`, `build`,
    `verify`, `tech-lead-review`).
    Evidence: `.flowai-workflow/workflow.yaml:61` (specification), `:83` (design),
    `:108` (decision), `:140` (build), `:159` (verify), `:210` (tech-lead-review).
  - [x] Continuation mechanism is triggered when `## Summary` is absent
    (same `contains_section` rule behavior as other section validations).
    Evidence: Inherent behavior of `contains_section` validation in engine;
    `.flowai-workflow/workflow.yaml` `contains_section` rules trigger continuation on
    missing section (same mechanism as all other section validations).
  - [x] `deno task check` passes after changes.
    Evidence: Run 20260314T073009 — 490 tests pass, workflow integrity valid.

### 3.22 FR-S22 (ex FR-43): Agent First-Person Voice in GitHub Interactions

- **Description:** All 6 agent SKILL.md files MUST include a `## Voice` section
  that: (1) explicitly covers GitHub issue comments, PR descriptions, and status
  updates in scope; (2) provides correct/incorrect example pairs including one
  targeting GitHub interactions; (3) uses first-person ("I") in all hardcoded
  `gh issue comment` body strings.
- **Rationale:** FR-S20 established per-agent Voice sections but omitted explicit
  GitHub interaction scope and lacked GitHub-specific examples. Passive/impersonal
  templates in PM, Architect, and Tech Lead comments reduce traceability.
- **Scope:** All `gh issue comment` and `gh pr review` body strings in agent
  SKILL.md files, plus the `## Voice` section scope sentence and examples.
- **Acceptance criteria:**
  - [x] Hardcoded `gh issue comment --body` templates changed to first-person in
    PM, Architect, and Tech Lead SKILL.md files. Evidence:
    `.flowai-workflow/agents/agent-pm/SKILL.md`,
    `.flowai-workflow/agents/agent-architect/SKILL.md`,
    `.flowai-workflow/agents/agent-tech-lead/SKILL.md`
  - [x] "This includes GitHub issue comments, PR descriptions, and status
    updates." scope sentence added to all 6 `## Voice` sections. Evidence:
    `.flowai-workflow/agents/agent-pm/SKILL.md`,
    `.flowai-workflow/agents/agent-architect/SKILL.md`,
    `.flowai-workflow/agents/agent-tech-lead/SKILL.md`,
    `.flowai-workflow/agents/agent-developer/SKILL.md`,
    `.flowai-workflow/agents/agent-qa/SKILL.md`,
    `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md`
  - [x] Third correct/incorrect example pair targeting GitHub interactions added
    to all 6 `## Voice` sections. Evidence: all 6 SKILL.md files listed above.
  - [x] `deno task check` passes.

### 3.23 FR-S23: SDLC Documentation Accuracy

- **Description:** SDLC SDS (`documents/design-sdlc.md`) must accurately reflect the current workflow architecture. Deprecated components must be explicitly labeled with deprecation reason and superseding FR, or removed entirely. References in SDS must match current `deno.json` task state.
- **Rationale:** Legacy diagrams and stubs for removed workflow stages (removed per FR-S15) create architectural confusion for new contributors. `deno.json` task references in SDS 3.2 that no longer match actual state undermine doc trustworthiness.
- **Acceptance criteria:**
  - [x] SDS section 2.1 legacy shell workflow diagram marked "(DEPRECATED — pre-FR-S15)" or removed. Affected nodes: Stage 3 (Reviewer), Stage 4 (Architect), Stage 5 (SDS Update), Stage 8 (Presenter) — all absorbed/removed after FR-S15 workflow restructure. Evidence: `documents/design-sdlc.md` §2.1 heading "Legacy: Shell Script Workflow (REMOVED — superseded by FR-S15)".
  - [x] SDS section 3.2 (Stage Scripts) `deno.json` task references aligned with current state: 9 `test:*` legacy tasks accurately documented with DEPRECATED status. Evidence: `documents/design-sdlc.md` §3.2 heading "Stage Scripts — DELETED (FR-S26)".
  - [x] `deno task check` passes. Evidence: `deno task check` PASS (this commit).

### 3.24 FR-S24: Workflow Config Validation

- **Description:** SDLC workflow config (`.flowai-workflow/workflow.yaml`) must be validated for schema correctness as part of `deno task check`. Detects drift between workflow config and engine schema requirements before runtime failures occur.
- **Rationale:** Unvalidated config changes cause hard-to-diagnose runtime failures. Static validation catches invalid node types, missing required fields, and bad `inputs` references at development time. Maps to SDLC-scope aspect of engine FR-E7 (config drift detection).
- **Acceptance criteria:**
  - [x] `scripts/check.ts` validates `.flowai-workflow/workflow.yaml` schema: node types, required fields, `inputs` references, `run_on` values. Evidence: `scripts/check.ts:84-96` (`workflowIntegrity()` calls `loadConfig()`), `engine/config.ts:43-103` (schema validation), `engine/config.ts:105-249` (node validation — types, inputs, `run_on`).
  - [x] `deno task check` exits non-zero with descriptive error on invalid config. Evidence: `scripts/check.ts:84-96` (`workflowIntegrity()` catches `loadConfig()` exceptions and reports descriptive error messages).
  - [x] `deno task check` passes on valid config with no false positives. Evidence: `deno task check` passes on current `.flowai-workflow/workflow.yaml` with no errors.

### 3.25 FR-S25: Phase-Organized SDLC Artifact Directories

- **Description:** SDLC workflow nodes with a `phase` config field must store output artifacts in phase-organized subdirectories (`.flowai-workflow/runs/<run-id>/<phase>/<node-id>/`). Nodes without `phase` use flat layout (`.flowai-workflow/runs/<run-id>/<node-id>/`). Depends on engine FR-E9 implementation.
- **Rationale:** SDLC workflow nodes are grouped into `plan`, `impl`, `report` phases in `workflow.yaml`. Phase-organized storage improves navigability and aligns artifact structure with declared execution flow. Without engine FR-E9 (phase registry + phase-aware `getNodeDir()`), the `phase` field in `workflow.yaml` has no effect on artifact paths.
- **Acceptance criteria:**
  - [x] All SDLC workflow nodes in `.flowai-workflow/workflow.yaml` have `phase:` field set to `plan`, `impl`, or `report` as appropriate. Evidence: `.flowai-workflow/workflow.yaml` (specification, design, decision → `plan`; implementation → `impl`; tech-lead-review, optimize → `report`).
  - [x] After engine FR-E9 implementation, artifact directories follow `.flowai-workflow/runs/<run-id>/<phase>/<node-id>/` layout for all phased nodes. Evidence: `engine/state.ts:20-36` (`setPhaseRegistry()`), `engine/state.ts:98-103` (`getNodeDir()` phase-aware path), `engine/engine.ts:129-130` (init at run start).
  - [x] `{{input.<node-id>}}` and `{{node_dir}}` template variables resolve to phase-aware paths for phased nodes. Evidence: `engine/state.ts:44-46` (`getPhaseForNode()`); `getNodeDir()` underpins template variable resolution.
  - [x] SDLC workflow runs end-to-end successfully with phase subdirectory layout.
    Evidence: `.flowai-workflow/runs/20260314T154052/plan/specification/`,
    `.flowai-workflow/runs/20260314T154052/plan/design/`,
    `.flowai-workflow/runs/20260314T154052/plan/decision/`,
    `.flowai-workflow/runs/20260314T154052/impl/implementation/`,
    `.flowai-workflow/runs/20260314T154052/report/tech-lead-review/`,
    `.flowai-workflow/runs/20260314T154052/report/optimize/` — 6 phase-organized node
    directories across all 3 phases (`plan`, `impl`, `report`).
  - [x] `deno task check` passes. Evidence: `deno task check` exit 0, 498 tests
    passed, 0 failed, run 20260314T154052.

### 3.26 FR-S26: Workflow Asset Directory Consolidation

- **Desc:** All workflow assets (config, agent prompts, scripts, tasks, runs) MUST be consolidated under `.flowai-workflow/` directory. Eliminates `.flowai-workflow/` (domain-specific naming, violates engine's domain-agnostic principle) and decouples agent prompts from `.claude/skills/` (Claude Code's skill-system coupling).
- **Directory layout:**
  ```
  .flowai-workflow/
  ├── workflow.yaml          # from .flowai-workflow/workflow.yaml
  ├── agents/                # from .flowai-workflow/agents/agent-*/
  │   └── <name>/SKILL.md   # 6 agents
  ├── scripts/               # active scripts only (from .flowai-workflow/scripts/)
  │   ├── rollback-uncommitted.sh
  │   ├── hitl-ask.sh
  │   ├── hitl-check.sh
  │   └── lib.sh
  ├── tasks/                 # from .flowai-workflow/tasks/
  └── runs/                  # from .flowai-workflow/runs/
  ```
- **Rationale:** Single discoverable location; easier portability between projects; `.flowai-workflow/` is engine-brand-aligned and domain-agnostic.
- **Migration actions:**
  - Delete deprecated `stage-*.sh` scripts and their `*_test.ts` files (already marked DEPRECATED).
  - Update all internal path references: `workflow.yaml`, engine CLI defaults, `deno.json` tasks, docs, `CLAUDE.md`.
  - `.claude/hooks/guard-deno-direct.sh` stays in `.claude/hooks/` (Claude Code hooks dir is fixed by Claude Code; not movable).
- **Acceptance:**
  - [ ] `workflow.yaml` at `.flowai-workflow/workflow.yaml`
  - [ ] Agent prompts at `.flowai-workflow/agents/<name>/SKILL.md` (6 agents: pm, architect, tech-lead, developer, qa, tech-lead-review)
  - [ ] Active scripts at `.flowai-workflow/scripts/` (rollback-uncommitted.sh, hitl-ask.sh, hitl-check.sh, lib.sh)
  - [ ] Tasks at `.flowai-workflow/tasks/`; runs at `.flowai-workflow/runs/`
  - [ ] Deprecated stage scripts (`stage-*.sh`) and their `*_test.ts` files deleted
  - [x] Zero `.flowai-workflow/` path references remain in codebase (except git history). Evidence: completed in this commit.
  - [x] Zero `.flowai-workflow/agents/agent-*` path references remain in codebase. Evidence: completed in this commit.
  - [ ] `deno task run` works with `.flowai-workflow/workflow.yaml` as default config path
  - [ ] `deno task check` passes clean
  - [ ] All docs (CLAUDE.md, AGENTS.md, SRS, SDS) updated with new paths
  - [ ] `.claude/hooks/guard-deno-direct.sh` placement decision documented (stays in `.claude/hooks/`)

### 3.27 FR-S27: CLI Help for SDLC Utility Scripts

- **Description:** SDLC utility scripts that accept CLI arguments must respond to `--help` / `-h` with a usage synopsis and exit 0. Unknown flags must produce an error message referencing `--help` and exit non-zero. Output format follows the pattern in `engine/cli.ts`. Applies to: `scripts/self_runner.ts`, `scripts/loop_in_claude.ts`, `scripts/generate-dashboard.ts`.
- **Motivation:** Users must read source code to discover available options for SDLC utility scripts. No help text forces unnecessary source inspection and increases risk of misuse.
- **Acceptance criteria:**
  - [ ] `scripts/self_runner.ts`: `--help` / `-h` prints usage (loop interval, stop conditions, pass-through args) and exits 0.
  - [ ] `scripts/loop_in_claude.ts`: `--help` / `-h` prints usage (description, relation to `self_runner`, accepted args) and exits 0.
  - [ ] `scripts/generate-dashboard.ts`: `--help` / `-h` prints usage (`--run-dir` flag, output path) and exits 0.
  - [ ] All three scripts: unknown flags produce error message referencing `--help` and exit non-zero.
  - [ ] Output format follows `engine/cli.ts` pattern: `<Tool> — <description>\n\nUsage:\n  deno task <name> [options]\n\nOptions:\n  ...\n\nExamples:\n  ...`.
  - [ ] `deno task check` passes.

### 3.28 FR-S28: Per-Agent Reflection Memory

- **Description:** Each agent owns its own reflection memory stored at `.flowai-workflow/memory/<agent-name>.md`. At session start, agent reads its memory file. At session end, agent rewrites the file in full (not append) with compressed current-state knowledge: anti-patterns, effective strategies, environment quirks, baseline metrics. Agent decides what to retain, evicting stale or resolved items.
- **Motivation:** Centralized `documents/meta.md` caused: (1) git history pollution from per-run updates to `documents/`; (2) merge conflicts on concurrent runs; (3) ~60% dead-weight content (resolved patterns duplicate git history); (4) no measurable quality improvement; (5) scope violation (workflow-level data in project docs). Per-agent decentralized memory eliminates all five issues.
- **Storage:** `.flowai-workflow/memory/<agent-name>.md` — one file per agent. Git tracking TBD (tracked enables review; gitignored avoids noise — open decision per issue #117).
- **Lifecycle per agent run:**
  1. Read `.flowai-workflow/memory/<self>.md` at session start before main work.
  2. Execute main task.
  3. Rewrite `.flowai-workflow/memory/<self>.md` at end — full rewrite, compress stale data out.
- **Memory content (agent-curated, ≤50 lines):**
  - Known anti-patterns in own behavior and avoidance strategies.
  - Effective strategies discovered empirically.
  - Environment quirks and gotchas.
  - Baseline metrics (turns, cost) for self-assessment.
- **Scope:** All 6 workflow agents: pm, architect, tech-lead, tech-lead-review, developer, qa.
- **Acceptance criteria:**
  - [ ] `.flowai-workflow/memory/` directory exists in repo.
  - [ ] Each of 6 agent `SKILL.md` files includes: (a) read-memory step at session start, (b) rewrite-memory step at session end.
  - [ ] `workflow.yaml` `task_templates` or `defaults` exposes `.flowai-workflow/memory/<agent-name>.md` path to each agent.
  - [ ] `documents/meta.md` removed or repurposed (no longer used as shared cross-run memory).
  - [ ] At least one end-to-end workflow run completes with agents reading/writing their own memory files.
  - [ ] `deno task check` passes after changes.

### 3.29 FR-S29: AGENTS.md Agent List Accuracy

- **Description:** `AGENTS.md` must list exactly the 6 active workflow agents: PM, Architect, Tech Lead, Developer, QA, Tech Lead Review. Deprecated/absorbed agents (e.g., Presenter, absorbed into Tech Lead + Tech Lead Review per FR-S15; Meta-Agent, removed per FR-S9) must not appear as active agents.
- **Rationale:** Stale agent references in `AGENTS.md` mislead contributors about workflow structure. Presenter agent was absorbed into Tech Lead + Tech Lead Review per FR-S15. Meta-Agent removed per FR-S9. `AGENTS.md` now lists exactly 6 correct agents; Presenter and Meta-Agent references removed.
- **Acceptance criteria:**
  - [x] `AGENTS.md` agent list contains exactly: PM, Architect, Tech Lead, Developer, QA, Tech Lead Review (6 agents total). Evidence: `AGENTS.md` (6 agents listed, no Presenter, no Meta-Agent), `scripts/check.ts:134-171` (`validateAgentListContent`), `scripts/check_test.ts:96-100` (real AGENTS.md integration test).
  - [x] No reference to "Presenter" as an active agent in `AGENTS.md`. Evidence: `scripts/check.ts:134-171` (`validateAgentListContent` rejects deprecated agents), `scripts/check_test.ts:73-78` (Presenter rejection test).
  - [x] `deno task check` passes. Evidence: `scripts/check.ts:173-184` (`agentListAccuracy` runs as part of check), `scripts/check_test.ts:54-100` (6 test cases).

### 3.30 FR-S30: Stale Path Reference Cleanup in SDLC Artifacts

- **Description:** SDLC documentation, task files, utility scripts, config, and agent prompts must contain zero deprecated `.flowai-workflow/` or `.flowai-workflow/agents/agent-*` path references. Additionally, FR-S23 ACs left `[ ]` by #97 (implementation done, bookkeeping skipped) must be marked `[x]` with evidence from `documents/design-sdlc.md`.
- **Motivation:** ~60 stale `.flowai-workflow/` refs across SDLC artifacts cause navigation failures after #111 migration. FR-S23 ACs unstamped despite implementation complete per #97. `.flowai-workflow/agents/agent-*` refs in agent prompts couple them to Claude Code's internal path layout.
- **Acceptance criteria:**
  - [ ] Zero `.flowai-workflow/` path references in `documents/requirements-sdlc.md`. Evidence: grep result = 0.
  - [ ] Zero `.flowai-workflow/` path references in `.flowai-workflow/tasks/fr-18-verbose-output.md`. Evidence: grep result = 0.
  - [ ] Zero `.flowai-workflow/` path references in `scripts/generate-dashboard.ts` and `scripts/generate-dashboard_test.ts`. Evidence: grep result = 0.
  - [ ] Zero `.flowai-workflow/` path references in `.gitignore` and `.gitleaks.toml`. Evidence: grep result = 0.
  - [ ] Zero `.flowai-workflow/agents/agent-*` path references in `documents/requirements-sdlc.md`. Evidence: grep result = 0.
  - [ ] Zero `.flowai-workflow/agents/agent-*` path references in `.flowai-workflow/agents/agent-tech-lead/SKILL.md`. Evidence: file content.
  - [ ] FR-S23 ACs marked `[x]` with evidence from `documents/design-sdlc.md` §2.1 and §3.2. Evidence: `requirements-sdlc.md:561-563`.
  - [ ] `deno task check` passes. Evidence: `deno task check` exit 0.

### 3.31 FR-S31: QA Agent Check Suite Extension

- **Description:** QA agent may autonomously add new verification classes to `scripts/check.ts` when it identifies recurring quality issues not covered by existing checks.
- **Motivation:** Recurring defect patterns (dead exports, unused deps, naming violations, missing error handling) require manual developer action to add checks. Enabling QA to extend the suite reduces defect escape across Developer+QA loop iterations.
- **Rules:**
  - Add a check only when evidence of a real recurring problem exists (not speculative).
  - New checks MUST follow existing `check.ts` architecture: standalone function + call in main flow + `Deno.exit(1)` on failure.
  - Each check MUST print a clear label to stdout (`--- Check Name ---`).
  - New checks MUST NOT produce false positives on the current codebase at time of addition.
  - QA MUST run the extended suite after adding any check to confirm zero false positives.
  - `scripts/check.ts` MUST be listed in QA agent's `Allowed File Modifications` in `SKILL.md`.
- **Acceptance criteria:**
  - [ ] QA agent `SKILL.md` lists `scripts/check.ts` in `Allowed File Modifications`.
  - [ ] QA agent `SKILL.md` documents "Extend check suite" responsibility with all constraints above.
  - [ ] QA agent can implement and wire a new check function in `scripts/check.ts`.
  - [ ] New checks follow existing code style and `run()`/scan pattern.
  - [ ] `deno task check` passes after QA agent adds a new check.

### 3.32 FR-S32: SDLC Artifact File Numbering Standard

- **Description:** SDLC workflow artifact filenames MUST use gapless sequential
  numeric prefixes reflecting actual workflow execution order.
- **Motivation:** Non-gapless or inverted prefix numbering (e.g., `06-impl-summary`
  produced before `05-qa-report`) breaks alphabetical-sort as an execution-order
  proxy, creating confusion for developers and tooling relying on prefix ordering.
- **Rules:**
  - Prefix sequence MUST be gapless (`01, 02, 03, …`) — no skipped numbers.
  - Prefix order MUST match DAG execution order.
  - All references (workflow.yaml, agent SKILL.md prompts, docs, validation rules)
    MUST use the canonical gapless filenames.
- **Acceptance criteria:**
  - [x] Artifact sequence is `01-spec → 02-plan → 03-decision → 04-impl-summary →
    05-qa-report → 06-review` — no gaps, no ordering inversions. Evidence:
    `.flowai-workflow/workflow.yaml` outputs, `documents/design-sdlc.md §2.2`.
  - [x] `workflow.yaml`, all agent SKILL.md files, and documentation reference the
    canonical gapless filenames exclusively (zero matches for old names
    `04-decision`, `06-impl-summary`, `08-review`). Evidence: grep sweep
    post-implementation confirms zero matches across all SKILL.md files and docs.

### 3.33 FR-S33: Remove Stale Agent Symlinks from .claude/skills/

- **Description:** Remove 6 legacy `agent-*` symlinks from `.claude/skills/` (pointing to `.flowai-workflow/agents/agent-*/`), remove obsolete symlink validation from `scripts/check.ts`, and update documentation. Symlinks were legacy from pre-FR-S26 layout; since FR-S17, agent prompts are discovered directly from `.flowai-workflow/agents/agent-<name>/SKILL.md`. Keeping symlinks caused Claude Code to expose workflow-only agents as interactive skills — undesirable.
- **Supersedes:** `.claude/skills/ agent-*/` symlink pattern (from FR-S17 migration; now fully removed).
- **Acceptance criteria:**
  - [x] 6 `agent-*` symlinks deleted from `.claude/skills/` (`agent-pm`, `agent-architect`, `agent-tech-lead`, `agent-tech-lead-review`, `agent-developer`, `agent-qa`). Evidence: `git diff main...HEAD --name-only` shows `deleted file mode 120000` for all 6; `ls .claude/skills/` confirms no `agent-*` entries.
  - [x] `scripts/check.ts` symlink validation block removed. Evidence: `scripts/check.ts` `workflowIntegrity()` (lines 89–102) retains only `loadConfig()` delegation; no symlink loop remains.
  - [x] `documents/design-sdlc.md` updated: §2.2 Agent Runtime symlink clause removed, §3.4 Purpose/Interfaces/Migration updated with FR-S33 reference. Evidence: `documents/design-sdlc.md §2.2`, `§3.4`.
  - [x] `documents/requirements-sdlc.md` updated: this section (3.33) added; Section 4 NFR Reproducibility updated; Appendix B symlink lines removed; Appendix C FR-S33 row added.
  - [x] `deno task check` passes. Evidence: `deno task check` PASS (493 tests, run `20260319T192055`).

### 3.34 FR-S34: Dashboard Diagnostic Enhancements

- **Description:** Three inline diagnostic capabilities added to the HTML run
  dashboard: (1) collapsible inline `stream.log` viewer per node card, (2)
  accurate header run status with distinct visual styling per state value,
  (3) phase aggregate status with `run_on: always` nodes separated from core
  nodes so their outcomes do not mask each other.
- **Extends:** FR-S20 (Dashboard Stream Log Links) — from file-link to inline
  content. Reuses FR-S16 `<details>/<summary>` collapsible pattern.
- **Acceptance criteria:**

  **Group 1 — Inline collapsible stream.log viewer per node card:**

  - [x] `readStreamLog(path, maxHead, maxTail)` returns full content when line
    count ≤ `maxHead+maxTail` (default 200+50); otherwise first `maxHead` lines
    + `\n--- truncated ---\n` + last `maxTail` lines; empty string for
    missing/empty file. Evidence: `scripts/generate-dashboard.ts`,
    `scripts/generate-dashboard_test.ts`.
  - [x] `renderCard()` accepts optional `logContent?: string`; when present and
    non-empty renders `<details><summary>stream log</summary><pre
    class="log-content">${escHtml(logContent)}</pre></details>`; existing
    `<a class="log-link">` href retained. Evidence:
    `scripts/generate-dashboard.ts`.
  - [x] `.log-content` CSS: monospace font, max-height 300px, overflow-y
    scroll; `logContent` HTML-escaped via `escHtml()`. Evidence:
    `scripts/generate-dashboard.ts`.

  **Group 2 — Header status with distinct per-state styling:**

  - [x] `<strong class="${state.status}">` uses actual state value as CSS
    class.
  - [x] Distinct CSS rules: `strong.completed{color:#166534}` (green),
    `strong.running{color:#2563eb}` (blue), `strong.failed{color:#991b1b}`
    (red), `strong.aborted{color:#854d0e}` (orange). `running` does NOT share
    a rule with `completed`. Evidence: `scripts/generate-dashboard.ts`.

  **Group 3 — Phase aggregate status with `run_on: always` separation:**

  - [x] `computePhaseStatus(nodeIds, nodeStates, alwaysNodes)` exported
    function returns `{coreStatus, alwaysStatus?}`; `alwaysStatus` omitted
    when no always-nodes present. Core status: all completed → "completed",
    any failed → "failed", otherwise "running". Always-node status computed
    independently. Evidence: `scripts/generate-dashboard.ts`,
    `scripts/generate-dashboard_test.ts`.
  - [x] CLI entry extracts `run_on: always` from workflow config, builds
    `Set<string>` of always-nodes; passes to `renderHtml()`. Phase heading
    renders secondary `phase-badge-always` badge when `alwaysStatus` present.
    Evidence: `scripts/generate-dashboard.ts`.
  - [x] `deno task check` passes. Evidence: PASS (509 tests, run
    `20260319T194808`).

### 3.35 FR-S35: HITL Artifact Source Node Reference

- **Description:** `defaults.hitl.artifact_source` in `workflow.yaml` MUST
  reference the upstream node via `{{input.<node-id>}}/…` template syntax
  instead of a hardcoded relative path. Engine interpolates the template at
  runtime in `buildScriptArgs()`. SDLC-level validator emits a parse-time error
  if a hardcoded path (no `{{input.`) is detected. HITL polling behavior and
  timing remain unchanged.
- **Extends:** FR-S24 (Workflow Config Validation) — concrete application of
  config validation for `hitl.artifact_source`.
- **Acceptance criteria:**
  - [x] `workflow.yaml` `defaults.hitl.artifact_source` uses
    `{{input.specification}}/01-spec.md` template syntax. Evidence:
    `.flowai-workflow/workflow.yaml:23`.
  - [x] `interpolate()` applied to `artifact_source` in
    `engine/hitl.ts:buildScriptArgs()` before passing value to scripts; ctx
    threaded through `HitlRunOptions`. Evidence: `engine/hitl.ts:257,264`.
  - [x] `validateHitlArtifactSource(config)` exported pure function: returns
    error message for hardcoded path (no `{{`), empty array for template or
    absent field. Evidence: `scripts/check.ts:110–118`.
  - [x] `hitlArtifactSource()` validation function in `scripts/check.ts` reads
    workflow config, calls `validateHitlArtifactSource()`, emits error and
    exits 1 on hardcoded path. Evidence: `scripts/check.ts:120–146`.
  - [x] Test `runHitlLoop — artifact_source template resolved via ctx` in
    `engine/hitl_test.ts` verifies `{{input.specification}}/01-spec.md` →
    `/runs/abc/specification/01-spec.md`. Evidence:
    `engine/hitl_test.ts:232–277`.
  - [x] Tests in `scripts/check_test.ts` cover: valid template path (pass),
    hardcoded path (fail), absent field (skip/pass), empty string (skip/pass).
    Evidence: `scripts/check_test.ts:109–130`.
  - [x] `deno task check` passes. Evidence: PASS (519 tests, run
    `20260319T204544`).

### 3.36 FR-S36: After-Script Failure Observability

- **Description:** The `after:` script in `workflow.yaml` for the
  `tech-lead-review` node MUST surface non-zero exit codes as a warning-level
  log entry rather than silently suppressing them. A wrapper script replaces
  the `|| true` pattern: it runs `deno task dashboard --run-dir "$1"`, emits
  `[WARN] dashboard generation failed (exit $code)` to stderr on non-zero exit
  (captured in `stream.log` by engine), and always exits 0 (non-blocking
  behavior retained). `on_error: continue` and `run_on: always` remain
  unchanged.
- **Acceptance criteria:**
  - [x] `run-dashboard.sh` created at `.flowai-workflow/scripts/run-dashboard.sh`.
    Evidence: `.flowai-workflow/scripts/run-dashboard.sh`.
  - [x] Wrapper receives `$1` as run_dir, executes
    `deno task dashboard --run-dir "$1"`, captures exit code. Evidence:
    `.flowai-workflow/scripts/run-dashboard.sh`.
  - [x] On non-zero exit: emits `[WARN] dashboard generation failed (exit $code)`
    to stderr. Evidence: `.flowai-workflow/scripts/run-dashboard.sh`.
  - [x] Wrapper always exits 0 — non-blocking behavior retained. Evidence:
    `.flowai-workflow/scripts/run-dashboard.sh`.
  - [x] `workflow.yaml` `tech-lead-review` `after:` field updated from
    `deno task dashboard --run-dir {{run_dir}} || true` to
    `.flowai-workflow/scripts/run-dashboard.sh {{run_dir}}`. Evidence:
    `.flowai-workflow/workflow.yaml`.
  - [x] `on_error: continue` and `run_on: always` retained unchanged. Evidence:
    `.flowai-workflow/workflow.yaml`.
  - [x] `deno task check` passes. Evidence: PASS (528 tests, run
    `20260319T215851`).

### 3.37 FR-S37: Verify Node Verdict Frontmatter Validation

- **Description:** The `verify` node in `.flowai-workflow/workflow.yaml` MUST declare a
  `frontmatter_field` rule for `verdict` in its `validate` block, with
  `allowed: [PASS, FAIL]`. This ensures the engine validates the QA agent's verdict
  field at parse time (via FR-E36) and at runtime (presence check), preventing the QA
  agent from silently omitting the verdict.
- **Acceptance criteria:**
  - [x] `workflow.yaml` `verify` node `validate` block includes `type: frontmatter_field`,
    `field: verdict`, `allowed: [PASS, FAIL]`. Evidence: `.flowai-workflow/workflow.yaml:162-165`.
  - [x] `deno task check` passes (workflow integrity validation confirms
    `frontmatter_field: verdict` rule present in verify node). Evidence: run
    `20260319T221833` (533 tests, 0 failures).

### 3.38 FR-S38: Workflow Agent Context via file() Injection in task_template

- **Description:** All 6 agent nodes in `.flowai-workflow/workflow.yaml` MUST inject
  shared rules and their SKILL.md into the agent prompt via `{{file(...)}}` in
  `task_template`, separated by `---`. No agent node may use the `prompt:` field.
  This makes prompt composition explicit and declarative in the workflow config,
  replacing the implicit `prompt:` loading mechanism.
- **Acceptance criteria:**
  - [x] All 6 agent nodes include `{{file(".flowai-workflow/agents/shared-rules.md")}}`
    in `task_template`. Evidence: `.flowai-workflow/workflow.yaml:39, 77, 102, 138, 162, 191`.
  - [x] All 6 agent nodes include `{{file(".flowai-workflow/agents/agent-<name>/SKILL.md")}}`
    in `task_template`. Evidence: `.flowai-workflow/workflow.yaml:41, 79, 104, 140, 164, 193`.
  - [x] No agent node in `workflow.yaml` uses the `prompt:` field. Evidence:
    `workflow_integrity_test.ts` test "workflow.yaml — no agent node uses prompt: field
    (FR-S38 AC#3)" passes; run `20260319T224519` (533 tests, 0 failures).
  - [x] `deno task check` passes. Evidence: PASS (533 tests, run `20260319T224519`).

### 3.39 FR-S39: Remove Redundant shared-rules.md Read Instruction from SKILL.md Files

- **Description:** After FR-S38, `shared-rules.md` is injected into all agent
  prompts via `{{file(...)}}` in `task_template`. The explicit "BEFORE YOU DO
  ANYTHING" block instructing agents to read `shared-rules.md` in each SKILL.md
  is therefore redundant (dead code). FR-S39 removes this block from all 6
  SKILL.md files, eliminating one wasted turn and unnecessary token cost per
  workflow run.
- **Dep:** FR-S38 (file() injection must be implemented first).
- **Acceptance criteria:**
  - [x] "BEFORE YOU DO ANYTHING" heading + shared-rules read instruction removed
    from all 6 SKILL.md files (`agent-pm`, `agent-architect`, `agent-tech-lead`,
    `agent-developer`, `agent-qa`, `agent-tech-lead-review`). Evidence:
    `.flowai-workflow/agents/agent-pm/SKILL.md`,
    `.flowai-workflow/agents/agent-architect/SKILL.md`,
    `.flowai-workflow/agents/agent-tech-lead/SKILL.md`,
    `.flowai-workflow/agents/agent-developer/SKILL.md`,
    `.flowai-workflow/agents/agent-qa/SKILL.md`,
    `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md`.
  - [x] Cross-references like "per shared-rules.md § Scope-Aware Doc Reads"
    preserved in all files. Evidence: verified in each SKILL.md.
  - [x] YAML frontmatter unchanged in each SKILL.md. Evidence: verified in each
    SKILL.md.
  - [x] `deno task check` passes. Evidence: PASS (533 tests, run
    `20260319T230952`).

### 3.40 FR-S40: Workflow Format Change Documentation Sync

- **Description:** After PRs #147–#157 implemented FR-S26–FR-S39, multiple
  documentation artifacts were out of sync with the actual workflow structure:
  SRS referenced 7 agents including removed meta-agent; Appendix A showed Stage
  7 Meta-Agent and old artifact filename `05-qa-report-N.md`; Appendix B listed
  `agent-meta-agent/SKILL.md` and old `prompt:` field pattern; SDS described
  `phases:` block and `prompt:` fields; `workflow-report.md` had outdated
  artifact numbering; `spec-unified-task-template.md` marked Phase 1/2 as
  not-started. FR-S40 formalizes the full documentation sync across SRS, SDS,
  and supporting docs.
- **Dep:** FR-S9 (meta-agent removal), FR-S32 (artifact naming), FR-S38
  (file() injection), FR-S39 (SKILL.md cleanup).
- **Acceptance criteria:**
  - [x] `documents/requirements-sdlc.md`: active agent count updated 7→6 in
    all descriptions; meta-agent removed from all active sections. Evidence:
    `documents/requirements-sdlc.md`, run `20260319T233247` (18 targeted edits,
    impl-summary confirmed).
  - [x] `documents/requirements-sdlc.md` Appendix A: Stage 7 Meta-Agent row
    removed; `05-qa-report-N.md` → `05-qa-report.md`. Evidence:
    `documents/requirements-sdlc.md`, run `20260319T233247`.
  - [x] `documents/requirements-sdlc.md` Appendix B: `agent-meta-agent/SKILL.md`
    entry removed; `prompt:` field references replaced with `task_template`/
    `{{file(...)}}` pattern. Evidence: `documents/requirements-sdlc.md`, run
    `20260319T233247`.
  - [x] `documents/requirements-sdlc.md` Section 5 Interfaces:
    `--append-system-prompt` description replaced with `-p`/`task_template`/
    `{{file(...)}}` mechanism (FR-S38). Evidence:
    `documents/requirements-sdlc.md:916–917`.
  - [x] `documents/design-sdlc.md`: §3.4 marks `prompt:` field as removed with
    `{{file(...)}}` replacement; §8 FR-S40 evidence entry present. Evidence:
    `documents/design-sdlc.md` (Tech Lead pre-applied), run `20260319T233247`.
  - [x] `documents/rnd/workflow-report.md`: artifact numbering updated to
    `01-spec → 02-plan → 03-decision → 04-impl-summary → 05-qa-report →
    06-review`. Evidence: `documents/rnd/workflow-report.md:5`, run
    `20260319T233247`.
  - [x] ADR-001 spec-unified-task-template.md: Phase 1/2 status → "done".
    Evidence: run `20260319T233247`. (ADR-001 deleted — superseded, content
    covered by FR-S38/FR-S39.)

### 3.41 FR-S41: ~~pre_run Auto-Stash~~ (Superseded)

- **Description:** ~~pre_run auto-stash of uncommitted changes.~~ **Superseded
  by engine FR-E24 (worktree isolation).** Engine now creates a git worktree per
  run instead of destructive `git reset --hard`. No auto-stash needed — original
  working tree is never modified. `pre_run` field removed from engine; using it
  throws a migration error.
- **Status:** Superseded. `reset-to-main.sh` no longer invoked.

### 3.42 FR-S42: Migrate Workflow Validate Rules to Composite Artifact Type

- **Description:** The SDLC workflow config (`.flowai-workflow/workflow.yaml`)
  validates each agent artifact using 2–3 separate rules (`file_exists`,
  `file_not_empty`, `contains_section`) per node, creating ~20 lines of
  redundant config across 6 agent nodes. FR-S42 migrates all 6 nodes to the
  engine's composite `artifact` rule type, which handles existence +
  non-emptiness + section checks in a single declaration. `frontmatter_field`
  and `custom_script` rules remain unchanged (not covered by `artifact` type).
  Validation behavior is identical post-migration.
- **Dep:** FR-S21 (agent output summary section), FR-S37 (verify verdict
  frontmatter).
- **Acceptance criteria:**
  - [x] `specification` node validates `01-spec.md` with `type: artifact`,
    sections `["Problem Statement", "Scope", "Summary"]`. Evidence:
    `.flowai-workflow/workflow.yaml`, run `20260320T092158`.
  - [x] `design` node validates `02-plan.md` with `type: artifact`, sections
    `["Summary"]`. Evidence: `.flowai-workflow/workflow.yaml`, run `20260320T092158`.
  - [x] `decision` node validates `03-decision.md` with `type: artifact`,
    sections `["Summary"]`. Evidence: `.flowai-workflow/workflow.yaml`, run
    `20260320T092158`.
  - [x] `build` node validates `04-impl-summary.md` with `type: artifact`,
    sections `["Summary"]`; `custom_script` preserved. Evidence:
    `.flowai-workflow/workflow.yaml`, run `20260320T092158`.
  - [x] `verify` node validates `05-qa-report.md` with `type: artifact`,
    sections `["Summary"]`; `frontmatter_field: verdict` preserved. Evidence:
    `.flowai-workflow/workflow.yaml`, run `20260320T092158`.
  - [x] `tech-lead-review` node validates `06-review.md` with `type: artifact`,
    sections `["Summary"]`. Evidence: `.flowai-workflow/workflow.yaml`, run
    `20260320T092158`.
  - [x] `frontmatter_field` rules for `specification` (issue, scope) unchanged.
    Evidence: `.flowai-workflow/workflow.yaml`, run `20260320T092158`.
  - [x] `deno task check` passes. Evidence: run `20260320T092158` (533 tests,
    workflow integrity valid).

### 3.43 FR-S43: Codebase Exploration inside Architect Agent

- **Description:** Before writing design variants, the Architect agent launches
  2–3 parallel exploration sub-agents (via the `Agent` tool) with distinct focus
  areas: prior art/existing patterns, architecture layers/module boundaries, and
  integration points/external dependencies. Sub-agent findings are incorporated
  as concrete `file:line` references in the variant design. This reduces vague
  component references and improves variant quality without adding new workflow
  phases.
- **Dep:** FR-S3 (Architect stage).
- **Acceptance criteria:**
  - [x] `agent-architect/SKILL.md` contains `## Codebase Exploration` section
    defining 2–3 parallel sub-agent launch pattern (Prior art, Architecture
    layers, Integration points). Evidence: `.flowai-workflow/agents/agent-architect/SKILL.md`.
  - [x] `Agent` tool explicitly allowed in `## Codebase Exploration` with
    shared-rules.md override reference. Evidence:
    `.flowai-workflow/agents/agent-architect/SKILL.md`.
  - [x] Architect Responsibility #3 updated to incorporate exploration findings
    as `file:line` references. Evidence: `.flowai-workflow/agents/agent-architect/SKILL.md`.

### 3.44 FR-S44: Confidence-Scored QA Review

- **Description:** QA agent assigns a 0–100 confidence score to each finding.
  Findings with confidence ≥ 80 are verdict-affecting; findings with confidence
  < 80 are listed in an `## Observations` section (non-blocking). QA report
  frontmatter includes an optional `high_confidence_issues: <N>` field (required
  on FAIL, optional on PASS). This filters noise from low-confidence
  observations and ensures only high-confidence findings drive the verdict.
- **Dep:** FR-S7 (QA stage), FR-S31 (QA check suite).
- **Acceptance criteria:**
  - [x] `agent-qa/SKILL.md` contains `## Confidence Scoring` section with 0–100
    scale, ≥80 verdict-affecting, <80 non-blocking. Evidence:
    `.flowai-workflow/agents/agent-qa/SKILL.md`.
  - [x] QA report frontmatter template includes `high_confidence_issues` field.
    Evidence: `.flowai-workflow/agents/agent-qa/SKILL.md`.
  - [x] `## Observations` section template defined for low-confidence findings;
    omitted when empty. Evidence: `.flowai-workflow/agents/agent-qa/SKILL.md`.

### 3.45 FR-S45: Multi-Focus Parallel Review inside QA Agent

- **Description:** QA agent launches 2–3 parallel sub-agents (via the `Agent`
  tool) with distinct review focus areas: (1) correctness/bugs, (2)
  simplicity/DRY, (3) conventions/abstractions. Each sub-agent reports findings
  independently; QA consolidates into per-focus sections in the QA report.
  Responsibility #4 ("Review changed files") delegates to sub-agents.
- **Dep:** FR-S7 (QA stage), FR-S44 (confidence scoring).
- **Acceptance criteria:**
  - [x] `agent-qa/SKILL.md` contains `## Multi-Focus Review` section defining
    2–3 parallel Agent sub-agents with distinct focus areas. Evidence:
    `.flowai-workflow/agents/agent-qa/SKILL.md`.
  - [x] `Agent` tool explicitly allowed in `## Multi-Focus Review` with
    shared-rules.md override reference. Evidence:
    `.flowai-workflow/agents/agent-qa/SKILL.md`.
  - [x] QA Responsibility #4 updated to delegate to sub-agents with per-focus
    consolidation. Evidence: `.flowai-workflow/agents/agent-qa/SKILL.md`.

## 4. Non-functional requirements

- **Isolation:** Each agent runs in its own Claude Code process with no shared state except file artifacts. Single local execution assumed (one workflow at a time). Concurrent execution is not supported.
- **Reproducibility:** Agent prompts are versioned in the repository under `.flowai-workflow/agents/`.
- **Observability:** Full logs stored per stage in `.flowai-workflow/runs/<run-id>/logs/`. Total workflow duration reported in the final PR description.
- **Fault tolerance:** If a stage fails (agent error, timeout, continuation limit exhausted), the workflow stops. Manual restart via `--resume <run-id>`.
- **Timeouts:** Each stage has a configurable timeout via `SDLC_STAGE_TIMEOUT_MINUTES` env var (default: 30 min). Engine enforces timeout per node. When a timeout fires, the stage is treated as failed.
- **Security:** Enforced at the engine/stage script level via diff-based checks (see engine SRS FR-8). Agents run with the local user's permissions.

## 5. Interfaces

- **Trigger:** Single entry point `deno task run [--prompt "..."]`. PM agent autonomously selects and triages open GitHub issues. `--prompt` passes optional additional context to PM. Common engine flags: `--resume`, `--dry-run`, `-v`, `-q`, `--config`.
- **Agent runtime:** `claude` CLI invoked by the Deno engine. Agent context (shared rules + SKILL.md) injected via `{{file(...)}}` in `task_template`, delivered as user message (`-p`) per FR-S38. Key flags:
  - `-p "<task>"` — passes task prompt derived from `task_template`. Shared rules and SKILL.md inlined via `{{file(...)}}` template function (FR-S38). No `--append-system-prompt` used for workflow agents.
  - `--output-format stream-json` — streams JSON events line-by-line; `result` event contains `result`, `session_id`, `total_cost_usd`, `duration_ms`, `num_turns`, `is_error`.
  - `--resume <session-id>` — re-invokes agent in the same session for continuations (engine SRS FR-8).
  - `-p "<prompt>"` — non-interactive mode, task description is passed as the prompt argument.
- **Workflow engine:** Deno/TypeScript engine (`engine/`) reads DAG config from `.flowai-workflow/workflow.yaml`, resolves node dependencies, executes nodes in topological order, manages state in `.flowai-workflow/runs/<run-id>/state.json`.
- **Legacy stage scripts:** `.flowai-workflow/scripts/stage-<N>-<role>.sh` — handle invocation, validation, continuation, artifact commit. Superseded by engine but preserved.
- **Inter-stage communication:** Engine: artifacts in `.flowai-workflow/runs/<run-id>/[<phase>/]<node-id>/`, linked via templates. Legacy: `.flowai-workflow/workflow/<issue-number>/`. Filesystem is source of truth.
- **Branching & commits:** Feature branch `sdlc/issue-<N>` created by Tech Lead (fallback `sdlc/{{run_id}}` for `--prompt` mode). Developer owns commits (`git add`, `git commit`, `git push` per task). Commit format: `sdlc(impl): <summary>`. Failed stages produce no commits.

## 6. Acceptance criteria

The system is considered accepted if:

1. Running `deno task run` triggers the full workflow; PM autonomously selects the highest-priority open GitHub issue.
2. Each stage produces its expected artifact with all required sections.
3. The Continuation mechanism catches and fixes `deno task check` failures without human intervention.
4. The Developer+QA loop iterates until quality checks pass.
5. Tech Lead creates draft PR; Tech Lead Review performs final review and merge.
6. All agent logs are preserved and accessible.
7. Re-running the workflow on the same issue cleanly overwrites artifacts.

## Appendix A: Workflow Stage Map

| Stage | Role             | Artifact                                | Key Validation                               |
| ----- | ---------------- | --------------------------------------- | -------------------------------------------- |
| 1     | Project Manager  | `01-spec.md` + updated SRS              | Has all 4 sections, no SDS details           |
| 2     | Architect        | `02-plan.md`                            | 2-3 variants with concrete file refs         |
| 3     | Tech Lead        | `03-decision.md` + SDS + branch + PR    | Variant selected, SDS updated, PR opened     |
| 4-5   | Developer + QA   | Code + commits + `05-qa-report.md`      | `deno task check` passes, PR reviews posted  |
| 6*    | Tech Lead Review | PR review + merge                       | CI green, code review passed                 |

\* Post-workflow node. Tech Lead Review runs as `run_on: always`.

## Appendix B: File Structure

```
.claude/skills/                          # Non-agent project skills (agent-* symlinks removed by FR-S33)
.flowai-workflow/                              # Workflow assets (FR-S26)
  agents/                               # Canonical agent prompts (agentskills.io-compliant, FR-S17)
    agent-pm/SKILL.md                    # PM: issue triage + spec
    agent-architect/SKILL.md             # Architect: design-solution plan with variants
    agent-tech-lead/SKILL.md             # Tech Lead: critique + decision + SDS + branch + PR
    agent-tech-lead-review/SKILL.md      # Final code review + CI gate + merge (post-workflow)
    agent-developer/SKILL.md             # Implementation + commits + push (FR-S18)
    agent-qa/SKILL.md                    # QA via PR reviews
  scripts/                              # HITL scripts (engine infrastructure)
    lib.sh                              # Shared functions (logging, continuation loop, git ops)
    hitl-ask.sh                         # HITL question delivery via GitHub issue
    hitl-check.sh                       # HITL reply polling via GitHub issue
  runs/                                 # Per-run artifacts (engine-controlled path)
    <run-id>/                           # Per-run artifacts
      <phase>/<node-id>/                # Phase-grouped node output
      logs/
        <node-id>.json                # CLI JSON output (metadata)
        <node-id>.jsonl               # Full session transcript
      state.json                      # Run state (node statuses, session IDs)
  workflow.yaml                         # DAG-based workflow configuration
engine/                                # Deno/TypeScript workflow engine
    cli.ts                             # Entry point: deno task run
    engine.ts                          # DAG executor
    ...
```

## Appendix C: FR Cross-Reference

| Old ID | New ID | Title |
| ------ | ------ | ----- |
| FR-1   | FR-S1  | Workflow Trigger |
| FR-2   | FR-S2  | Stage 1 — Project Manager (Specification) |
| FR-3   | FR-S3  | Stage 2 — Architect (Design-Solution Plan) |
| FR-4   | FR-S4  | Plan Critique & Revision (absorbed into Tech Lead) |
| FR-5   | FR-S5  | Stage 3 — Tech Lead (Decision + Branch + PR) |
| FR-6   | FR-S6  | SDS Update (absorbed into Tech Lead) |
| FR-7   | FR-S7  | Stage 6-7 — Developer + QA (Iterative Implementation Loop) |
| FR-9   | FR-S8  | Stage 8 — Presenter (Change Summary) — ABSORBED |
| FR-11  | FR-S9  | Meta-Agent (Prompt Optimization) |
| FR-12  | FR-S10 | Runtime Infrastructure |
| FR-14  | FR-S11 | Inter-Stage Data Flow & Commit Strategy |
| FR-16  | FR-S12 | Secrets |
| FR-19  | FR-S13 | Agents as Skills |
| FR-22  | FR-S14 | Project Documentation (README) |
| FR-26  | FR-S15 | Align Workflow Git Workflow with Standard GitHub Practices |
| FR-35  | FR-S16 | Dashboard Result Summary Display |
| FR-36  | FR-S17 | Agentskills.io-Compliant Skill Layout |
| FR-37  | FR-S18 | Rename Executor Agent to Developer |
| FR-38  | FR-S19 | Timeline Visualization in Dashboard |
| FR-40  | FR-S20 | Dashboard Stream Log Links |
| FR-42  | FR-S21 | Agent Output Summary Section |
| FR-43  | FR-S22 | Agent First-Person Voice in GitHub Interactions |
| —      | FR-S23 | SDLC Documentation Accuracy |
| —      | FR-S24 | Workflow Config Validation |
| —      | FR-S25 | Phase-Organized SDLC Artifact Directories |
| —      | FR-S26 | Workflow Asset Directory Consolidation |
| —      | FR-S27 | CLI Help for SDLC Utility Scripts |
| —      | FR-S28 | Per-Agent Reflection Memory |
| —      | FR-S29 | AGENTS.md Agent List Accuracy |
| —      | FR-S30 | Stale Path Reference Cleanup in SDLC Artifacts |
| —      | FR-S31 | QA Agent Check Suite Extension |
| —      | FR-S32 | SDLC Artifact File Numbering Standard |
| —      | FR-S33 | Remove Stale Agent Symlinks from .claude/skills/ |
| —      | FR-S34 | Dashboard Diagnostic Enhancements |
| —      | FR-S35 | HITL Artifact Source Node Reference |
| —      | FR-S36 | After-Script Failure Observability |
| —      | FR-S37 | Verify Node Verdict Frontmatter Validation |
| —      | FR-S38 | Workflow Agent Context via file() Injection in task_template |
| —      | FR-S39 | Remove Redundant shared-rules.md Read Instruction from SKILL.md Files |
| —      | FR-S40 | Workflow Format Change Documentation Sync |
| —      | FR-S41 | ~~pre_run Auto-Stash~~ (Superseded by FR-E24)       |
| —      | FR-S42 | Migrate Workflow Validate Rules to Composite Artifact Type |
| —      | FR-S43 | Codebase Exploration inside Architect Agent                |
| —      | FR-S44 | Confidence-Scored QA Review                               |
| —      | FR-S45 | Multi-Focus Parallel Review inside QA Agent               |
