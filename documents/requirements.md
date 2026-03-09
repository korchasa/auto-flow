# Specification: Agent Development Pipeline

## 0. Resolved Design Decisions

- **Target project:** This repo (auto-sdlc). Project-agnostic reuse deferred.
- **Concurrent pipelines:** One pipeline per branch enforced by GHA concurrency guard (FR-1). No additional locking on shared docs.
- **Cost limits:** Not tracked. No budget constraints.
- **Agent prompts:** Written incrementally alongside implementation.
- **CLAUDE.md interaction:** Target project's CLAUDE.md and agent system prompts complement each other (additive, not conflicting).
- **Issue complexity:** No size/complexity limits for now. Deferred.
- **Testing strategy:** Integration tests in this repo (no separate test repo). Unit tests for `lib.sh`.
- **Meta-Agent:** Auto-applies prompt improvements (commits to feature branch). Reviewed at PR merge.
- **Rollback:** Manual operation (no automated rollback).
- **Retry logic:** 3 attempts with exponential backoff for external API calls (`claude`, `gh`) in `lib.sh`.

## 1. Introduction

- **Document purpose:** Define the specification for the automated multi-agent development pipeline orchestrated via Claude Code agents and GitHub Actions.
- **Scope:** A CI/CD-integrated system where a GitHub Issue triggers a chain of specialized AI agents, each performing a distinct role in the software development lifecycle — from specification writing to QA verification.
- **Audience:** Project maintainer (korchasa), contributors.
- **Definitions and abbreviations:**
  - **Agent:** An isolated Claude Code CLI invocation with a dedicated system prompt (role).
  - **Stage:** A single step in the pipeline, executed by one agent.
  - **Handoff Artifact:** A structured Markdown file produced by one agent and consumed by the next.
  - **Agent Log:** A full transcript of an agent's session (input, reasoning, output, tool calls).
  - **Meta-Agent:** A separate agent that analyzes logs of other agents and refines their prompts.
  - **Continuation:** A mechanism for re-invoking an agent within the same session (via `--resume`) to fix issues detected by the stage script (see FR-8).

## 2. General description

- **System context:** Operates as a GitHub Actions workflow triggered by issue events. All stages run inside the same Docker image containing all required tools. Each stage is a separate shell script that invokes `claude` CLI with stage-specific prompts and handles validation/continuation logic. Agents communicate through files committed to the repository.
- **Assumptions and constraints:**
  - A single Docker image provides the runtime for all stages (see FR-13).
  - Each agent is stateless between runs — all context comes from input artifacts and its system prompt.
  - The target project is this repository (auto-sdlc). Pipeline design should be project-agnostic for future reuse in other repos.
- **Goal:** Automate the full development cycle for feature requests: from issue triage to a ready-to-merge PR — fully autonomous, no human gates between stages. PR merge is the only human checkpoint (post-pipeline, not between stages).

## 3. Functional requirements

### 3.1 FR-1: Pipeline Trigger

- **Description:** A GitHub Issue with a specific label triggers the agent pipeline.
- **Use case scenario:** Maintainer creates an issue describing a feature/bug, adds the label `agent-pipeline`. GitHub Actions workflow starts.
- **Acceptance criteria:**
  - Pipeline triggers on `issues.labeled` event when label is `agent-pipeline`.
  - Issue body and title are extracted and passed as input to the first agent.
  - Pipeline does NOT trigger on issues without the label.
  - **Re-run guard:** Before starting Stage 1, the pipeline checks if a PR from branch `agent/<issue-number>` has already been merged. If yes, the pipeline posts a comment on the issue ("Pipeline already completed for this issue. Close this issue and create a new one for further changes.") and exits without running any stages. This prevents duplicate work on already-merged changes.
  - **Concurrent pipeline guard:** GitHub Actions workflow uses `concurrency: { group: agent-pipeline-${{ github.event.issue.number }}, cancel-in-progress: false }`. If a pipeline is already running for issue N, a second trigger queues and waits until the first completes. This prevents race conditions on branch `agent/N` (parallel commits/pushes to same worktree).

### 3.2 FR-2: Stage 1 — Project Manager (Specification)

- **Description:** The PM agent reads the issue, analyzes existing documentation, and produces a specification. PM updates only the SRS (what needs to be done), not the SDS (how to do it — that's the Tech Lead's job).
- **Input:** Issue title + body, `documents/requirements.md`, `documents/design.md`, `AGENTS.md`.
- **Output:** `.sdlc/pipeline/<issue-number>/01-spec.md`, updated `documents/requirements.md`.
- **Acceptance criteria:**
  - Agent updates `documents/requirements.md` with new/modified requirements (marked with status markers per CLAUDE.md conventions).
  - Agent produces `01-spec.md` containing:
    - Problem statement (from the issue).
    - Affected requirements (references to existing FR-* items).
    - Summary of SRS changes made.
    - Scope boundaries (what is NOT included).
  - Output is committed to a feature branch `agent/<issue-number>`.
- **Quality metrics:**
  - `01-spec.md` contains all four required sections (problem, affected requirements, SRS changes, scope).
  - Every new requirement in `requirements.md` has a status marker.
  - No SDS-level details (implementation, data structures, algorithms) in the output.

### 3.3 FR-3: Stage 2 — Tech Lead (Plan with Variants)

- **Description:** The Tech Lead agent reads the specification and produces an implementation plan with 2-3 variants.
- **Input:** `01-spec.md`, `documents/requirements.md`, `documents/design.md`, relevant source code.
- **Output:** `.sdlc/pipeline/<issue-number>/02-plan.md`.
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

### 3.4 FR-4: Stage 3 — Tech Lead Reviewer (Critique & Revision)

- **Description:** A separate Tech Lead agent reviews the plan critically, identifies flaws, and produces a revised plan that addresses the critique. Combines critique and revision in a single stage to reduce overhead.
- **Input:** `02-plan.md`, `01-spec.md`, `documents/requirements.md`, `documents/design.md`, relevant source code.
- **Output:** `.sdlc/pipeline/<issue-number>/03-revised-plan.md`.
- **Acceptance criteria:**
  - Agent reads all input artifacts listed above.
  - Agent produces `03-revised-plan.md` containing:
    - **Critique section:** identified issues, risks, or gaps in each variant.
    - **Revision section:** updated plan addressing critique points, with clear marks of what changed and why.
    - Recommendation on which variant to prefer (with justification).
- **Quality metrics:**
  - Critique identifies at least one issue or gap per variant.
  - Revision section explicitly references each critique point and states how it was addressed.
  - Recommended variant has a justification referencing both technical and specification criteria.

### 3.5 FR-5: Stage 4 — Architect (Variant Selection & Task Breakdown)

- **Description:** The Architect agent selects the final implementation variant considering both technical and non-technical criteria (maintainability, alignment with vision, complexity budget) and produces a task breakdown for the executor.
- **Input:** `03-revised-plan.md`, `01-spec.md`, `AGENTS.md`.
- **Output:** `.sdlc/pipeline/<issue-number>/04-decision.md`.
- **Decision document format:** Every `04-decision.md` MUST begin with YAML frontmatter:
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
  - Parsing file allowlist: `yq --front-matter=extract '.tasks[].files[]' 04-decision.md`.
- **Acceptance criteria:**
  - Agent reads all input artifacts listed above.
  - Agent selects one variant with a justification covering:
    - Technical fit (from the revised plan).
    - Alignment with product vision and project conventions.
    - Complexity/maintainability trade-off.
  - Agent produces `04-decision.md` starting with YAML frontmatter containing `variant` and `tasks` fields (see format above), followed by justification and detailed task descriptions.
- **Quality metrics:**
  - Justification references at least one point from `AGENTS.md`.
  - Task checklist is ordered by dependency (blocking tasks first).
  - Each task is atomic — achievable in a single commit.
  - `architect.md` prompt MUST include a concrete YAML frontmatter example to ensure LLM compliance.

### 3.6 FR-6: Stage 5 — Tech Lead (SDS Update)

- **Description:** The Tech Lead updates the Software Design Specification based on the selected variant and task breakdown.
- **Input:** `04-decision.md`, `03-revised-plan.md`, `documents/design.md`.
- **Output:** Updated `documents/design.md`, `.sdlc/pipeline/<issue-number>/04a-sds-diff.md`.
- **Acceptance criteria:**
  - Agent reads decision and revised plan.
  - Agent updates `documents/design.md` with new/modified components, data structures, algorithms.
  - Changes are scoped to the selected variant only.
  - After the agent exits, stage script generates `04a-sds-diff.md` containing the unified diff of `documents/design.md` (via `git diff`). This artifact serves as an audit trail for the Meta-Agent and debugging.
- **Quality metrics:**
  - Every new component in SDS has: purpose, interfaces, dependencies.
  - No orphan references (every component mentioned in the plan exists in SDS after update).

### 3.7 FR-7: Stage 6-7 — Executor + QA (Iterative Implementation Loop)

- **Description:** The Executor and QA agents work as an iterative pair. Executor implements, QA verifies. If QA finds issues, Executor fixes them. The loop continues until QA passes or the iteration limit is reached.
- **Orchestration:** The loop is managed by `stage-6-executor.sh`, which acts as the loop controller. It invokes the Executor agent, then calls `stage-7-qa.sh` as a sub-step. Based on the QA verdict, it either exits the loop (on `PASS`) or re-invokes the Executor with the QA report (on `FAIL`). `stage-7-qa.sh` is not called independently by the CI/CD workflow — it is always invoked by `stage-6-executor.sh`.
- **Executor Input:** `04-decision.md`, `documents/requirements.md`, `documents/design.md`, source code. On subsequent iterations: previous QA report (`05-qa-report-N.md`).
- **Executor Output:** Code changes, tests, commits on feature branch.
- **QA Input:** `01-spec.md`, `04-decision.md`, all changed files, test results.
- **QA Output:** `.sdlc/pipeline/<issue-number>/05-qa-report-<iteration>.md`.
- **QA report format:** Every `05-qa-report-<iteration>.md` MUST begin with YAML frontmatter:
  ```
  ---
  verdict: PASS
  ---
  ```
  - `verdict` field: required, enum `PASS` | `FAIL`.
  - Frontmatter MUST be the first content in the file (lines 1-3 minimum).
  - Primary parsing: `yq --front-matter=extract '.verdict' 05-qa-report-N.md` (requires yq >= 4.18).
  - Fallback parsing: `sed -n '2p' 05-qa-report-N.md | grep -oE '(PASS|FAIL)'` (no yq dependency).
- **Acceptance criteria:**
  - **Executor:**
    - Agent reads all input artifacts listed above.
    - Agent implements changes following project code style rules (from CLAUDE.md).
    - Agent writes tests before or alongside implementation.
    - Agent commits changes incrementally to the feature branch.
    - On iterations > 1: agent reads the previous QA report and fixes reported issues.
  - **QA:**
    - Agent runs `deno task check` and verifies it passes.
    - Agent verifies each acceptance criterion from the specification.
    - Agent produces `05-qa-report-<iteration>.md` starting with YAML frontmatter containing `verdict: PASS` or `verdict: FAIL`, followed by:
      - Pass/fail status per acceptance criterion.
      - List of issues found (if any).
      - `deno task check` output summary.
      - Verdict details (human-readable explanation).
    - If `PASS`: loop ends, proceeds to next stage.
    - If `FAIL`: loop repeats with the next Executor iteration.
  - **Loop constraints:**
    - Maximum iterations: configurable (default 3).
    - If limit reached without `PASS`: pipeline stops and reports failure on the issue. Meta-Agent is triggered (see FR-10).
- **Quality metrics:**
  - `deno task check` passes on every Executor commit (enforced by stage script, see FR-8).
  - QA report covers 100% of acceptance criteria from `01-spec.md`.
  - Each QA issue has: description, affected file, severity (blocking/non-blocking).
  - `qa.md` prompt MUST include a concrete YAML frontmatter example to ensure LLM compliance.

### 3.8 FR-8: Continuation Mechanism

- **Description:** Each stage script wraps the Claude Code CLI invocation and validates the agent's output before considering the stage complete. If validation fails, the script re-invokes the agent in the same session using `--resume` with a description of the problem, giving the agent a chance to fix its output without starting from scratch.
- **Acceptance criteria:**
  - **Stage script responsibilities:**
    1. Invoke `claude` CLI with the stage prompt and input artifacts.
    2. After the agent exits, run stage-specific validation checks:
       - **For Executor stage:** run `deno task check`. If it fails, continuation is triggered.
       - **For QA stage (called by stage-6):** (1) verify `05-qa-report-N.md` exists and is non-empty, (2) extract verdict via `yq --front-matter=extract '.verdict' 05-qa-report-N.md`, (3) if verdict is not exactly `PASS` or `FAIL` — treat as validation failure, trigger continuation on QA agent.
       - **For all stages:** verify the expected output artifact exists and is non-empty.
    3. If validation fails: re-invoke `claude --resume <session-id>` with the validation error output appended as context (e.g., "deno task check failed with: <error output>. Fix the issues.").
    4. Repeat until validation passes or the continuation limit is reached.
  - **Continuation limits:**
    - Maximum continuations per stage: configurable (default 3).
    - If limit reached: stage is marked as failed, pipeline stops, Meta-Agent is triggered (FR-11).
  - **Session persistence:**
    - The `--resume` flag ensures the agent retains full conversation context from the initial invocation.
    - Each continuation adds only the validation error to the context, not the full prompt.
  - **Diff-based safety checks (all stages that modify files):**
    - After each agent exit, the stage script runs `git diff` and checks for:
      - Modifications to files outside the expected scope. Each stage defines an allowlist of files/paths it may modify:
        - **PM (Stage 1):** `documents/requirements.md`, `.sdlc/pipeline/<issue-number>/01-spec.md`.
        - **Tech Lead (Stage 2):** `.sdlc/pipeline/<issue-number>/02-plan.md`.
        - **Reviewer (Stage 3):** `.sdlc/pipeline/<issue-number>/03-revised-plan.md`.
        - **Architect (Stage 4):** `.sdlc/pipeline/<issue-number>/04-decision.md`.
        - **Tech Lead SDS (Stage 5):** `documents/design.md`.
        - **Executor (Stage 6):** file allowlist extracted from `04-decision.md` YAML frontmatter via `yq --front-matter=extract '.tasks[].files[]' 04-decision.md`, plus always-allowed paths: `.sdlc/pipeline/<issue-number>/`. Explicitly forbidden: `.github/`, `.sdlc/agents/`, `.sdlc/scripts/`, `CLAUDE.md`.
        - **Presenter (Stage 8):** `.sdlc/pipeline/<issue-number>/06-summary.md`.
      - Deletion of files not mentioned in the task breakdown (Executor only).
      - Addition of secret-like patterns in committed code (all stages). Detection: primary tool is `gitleaks detect --no-git --staged` (included in Docker image, see FR-12). Fallback regex: `(?i)(api[_-]?key|secret|token|password|credential)\s*[:=]\s*['"][^'"]{8,}`.
    - If a safety violation is detected: continuation is triggered with a description of the violation, asking the agent to revert the problematic changes.
- **Quality metrics:**
  - Continuation success rate: percentage of continuations that resolve the issue (target > 70%).
  - Average continuations per stage (target < 1.0 across all runs).

### 3.9 FR-9: Stage 8 — Presenter (Change Summary)

- **Description:** The Presenter agent creates a human-readable summary of all changes made during the pipeline, suitable for a PR description and issue comment.
- **Input:** `01-spec.md`, `04-decision.md`, latest `05-qa-report-*.md`, `git diff main...HEAD`, updated `documents/requirements.md`, updated `documents/design.md`.
- **Output:** `.sdlc/pipeline/<issue-number>/06-summary.md`, Pull Request targeting `main`, issue comment.
- **Acceptance criteria:**
  - Agent produces `06-summary.md` containing:
    - Executive summary: what was requested and what was done.
    - Key changes: list of modified/added files with brief descriptions.
    - SRS/SDS changes: what requirements and design sections were added or modified.
    - Before/after comparisons where applicable (API changes, config changes, behavior changes).
    - Testing summary: what was tested, coverage highlights.
    - Known limitations or follow-up items.
  - Agent creates a Pull Request targeting `main` with `06-summary.md` content as the PR body. PR requires manual review and merge — this is the only intentional human gate in the pipeline. Rationale: AI-generated code changes must be reviewed before merging to `main`.
  - Agent posts a summary comment on the original issue.
  - **Error handling:** If any `gh` operation fails (PR creation, comment posting), the stage fails immediately (fail fast). The error is reported on the issue (if possible) and Meta-Agent is triggered for analysis. No partial results — either all three outputs are produced, or the stage fails.
- **Quality metrics:**
  - PR description mentions every file from `git diff --name-only main...HEAD`.
  - Summary contains no hallucinated file names (all referenced files exist in the diff).

### 3.10 FR-10: Agent Log Storage

- **Description:** Every agent's full session transcript is stored for analysis and prompt improvement.
- **Log sources:**
  - **JSON output:** Claude CLI with `--output-format json` returns a structured JSON object with `result`, `session_id`, `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `is_error`. This is captured by the stage script or engine.
  - **JSONL transcript:** Claude CLI automatically stores full session transcripts as JSONL files in `~/.claude/projects/`. Each line is a JSON event (messages, tool calls, responses).
- **Acceptance criteria (legacy shell script path):**
  - Each stage script saves two log files:
    - `.sdlc/pipeline/<issue-number>/logs/stage-<N>-<role>.json` — the JSON output from `claude` CLI (metadata: cost, duration, session ID, result).
    - `.sdlc/pipeline/<issue-number>/logs/stage-<N>-<role>.jsonl` — copy of the JSONL transcript from `~/.claude/projects/` for the session.
  - Logs are committed to the feature branch after each stage.
  - Stage script locates the JSONL transcript by session ID extracted from the JSON output.
- **Acceptance criteria (Deno engine path):**
  - [ ] After each non-loop agent node completes successfully, the engine saves two files to `.sdlc/runs/<run-id>/logs/`:
    - `<node-id>.json` — full `ClaudeCliOutput` JSON object (`result`, `session_id`, `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `is_error`).
    - `<node-id>.jsonl` — copy of the JSONL session transcript from `~/.claude/projects/<project-hash>/`, located by matching `session_id` in filenames.
  - [ ] If the JSONL transcript file is not found: engine logs a warning and continues — pipeline does NOT fail.
  - [ ] Loop body nodes (executor, qa) are excluded from engine-level log saving (deferred).
  - [ ] Log-saving logic has unit tests covering: successful save, JSONL-not-found warning path.

### 3.11 FR-11: Meta-Agent (Prompt Optimization)

- **Description:** A dedicated agent that runs after every pipeline execution (both success and failure). It analyzes the logs of the current run, identifies errors, friction points, and inefficiencies, and produces actionable prompt improvement suggestions.
- **Trigger conditions:**
  - **On pipeline success:** runs as the final stage after Presenter (Stage 9).
  - **On pipeline failure:** runs automatically when any stage fails after exhausting its continuation limit.
- **Trigger mechanism:** GitHub Actions workflow defines the Meta-Agent job with `if: always()` and `needs: [all-stage-jobs]`. The job receives pipeline status via `needs.<job>.result` context. On failure: stage scripts export `SDLC_FAILED_STAGE=<stage-number>` as a GitHub Actions output; the Meta-Agent job reads this to identify the failed stage. The Meta-Agent job runs regardless of upstream job success/failure.
- **Input:**
  - All logs from `.sdlc/pipeline/<issue-number>/logs/`.
  - All handoff artifacts produced before the failure (if failed).
  - Current agent prompts from `.sdlc/agents/`.
  - The continuation/validation error output that caused the failure (if applicable).
- **Output:** `.sdlc/pipeline/<issue-number>/07-meta-report.md`.
- **Acceptance criteria:**
  - Agent produces `07-meta-report.md` containing:
    - **Run summary:** which stages completed, which failed, total continuations triggered.
    - **Error analysis** (if failed): root cause hypothesis for the failure, which prompt or input likely caused it.
    - **Friction points:** stages where the agent needed continuations, produced low-quality output, or took excessive tokens.
    - **Prompt improvements applied:** concrete edits to agent prompts with before/after diffs, committed to the feature branch.
    - **Pattern tracking:** recurring issues across multiple runs (references previous meta-reports if they exist in `.sdlc/pipeline/*/07-meta-report.md`).
  - Meta-Agent auto-applies prompt improvements directly to `.sdlc/agents/*.md` files and commits changes to the feature branch. Changes are reviewed as part of the PR (human gate at merge).
  - Meta-Agent posts a summary comment on the issue with key findings and list of applied changes.
- **Quality metrics:**
  - Every suggestion references a specific log excerpt as evidence.
  - Applied changes are actionable: each includes a concrete prompt diff, not vague advice like "improve clarity".

### 3.12 FR-12: Runtime Infrastructure

- **Description:** All pipeline stages run inside a single Docker image. Each stage has a dedicated shell script that orchestrates agent invocation, validation, and continuation.
- **Docker image contents:**
  - `claude` CLI (Claude Code) — installed via `npm install -g @anthropic-ai/claude-code`.
  - `deno` runtime — for running project checks and tests.
  - `git` — for branch management, commits, and diff-based safety checks.
  - `gh` CLI — for creating PRs and posting issue comments.
  - `gitleaks` — for secret detection in diff-based safety checks (see FR-8).
- **Stage scripts:**
  - Located in `.sdlc/scripts/stage-<N>-<role>.sh`.
  - Each script is responsible for:
    1. Preparing input: collecting handoff artifacts, setting environment variables.
    2. Invoking `claude` CLI with the agent prompt from `.sdlc/agents/<role>.md`.
    3. Running stage-specific validation (artifact checks, `deno task check` for Executor).
    4. Implementing the Continuation mechanism (FR-8): re-invoking via `--resume` on validation failure.
    5. Committing output artifacts and logs to the feature branch.
    6. Reporting stage status to the GitHub Issue via `gh`.
  - Scripts share common functions via `.sdlc/scripts/lib.sh` (logging, git operations, continuation loop, artifact validation).
- **Acceptance criteria:**
  - The Docker image builds successfully and contains all listed tools.
  - Each stage can be run independently by executing its script with the issue number as argument: `.sdlc/scripts/stage-1-pm.sh <issue-number>`.
  - The GitHub Actions workflow uses the same image for all jobs, only varying the script and secrets.
  - Stage scripts are executable and pass `shellcheck` without errors.
  - **Retry logic:** `lib.sh` implements a generic retry wrapper (`retry_with_backoff`) used for all external API calls (`claude` CLI, `gh` CLI). Parameters: max attempts = 3, initial delay = 5s, backoff multiplier = 2x. Retryable conditions: non-zero exit code from CLI tools (network errors, rate limits). Non-retryable: validation failures, agent logic errors.
- **Quality metrics:**
  - Image build time < 5 minutes.
  - Image size < 2 GB.

### 3.13 FR-13: Artifact Versioning

- **Description:** Defines how pipeline artifacts are managed on repeated runs for the same issue.
- **Acceptance criteria:**
  - On re-run, artifacts in `.sdlc/pipeline/<issue-number>/` are overwritten.
  - Previous versions are preserved in git history of the feature branch.
  - QA reports use iteration suffix (`05-qa-report-1.md`, `05-qa-report-2.md`) within a single run; on re-run, iteration numbering restarts from 1.
  - Log files are overwritten on re-run (previous logs preserved in git history).

### 3.14 FR-14: Inter-Stage Data Flow & Commit Strategy

- **Description:** Defines how data flows between pipeline stages and when commits happen on the feature branch.
- **Data flow:**
  - Each agent reads its input artifacts directly from the filesystem (`.sdlc/pipeline/<issue-number>/` and `documents/`).
  - Each stage script is responsible for validating that all expected output artifacts exist and are non-empty before the stage is considered complete (see FR-8).
  - There is no manifest or registry — the file system is the single source of truth for inter-stage communication.
  - Claude CLI's built-in context auto-compression handles large input sets; no manual context management is required from the pipeline.
- **Commit strategy:**
  - All pipeline work happens on a dedicated feature branch `agent/<issue-number>`.
  - The stage script creates the branch (or checks it out) before the first stage and commits + pushes after every stage completes successfully.
  - Each commit message follows the format: `sdlc(<role>): <issue-number> — <brief description>`.
  - Commit includes: stage output artifact(s), updated project documents (if any), and the stage log.
  - If a stage fails after exhausting continuations, the partial work is NOT committed. The failure is reported on the issue.
- **Branch lifecycle:**
  - Branch is created at the start of Stage 1 (or checked out if it already exists from a previous run).
  - On re-run, existing branch is reused — new commits overwrite previous artifacts (previous versions preserved in git history per FR-13).
  - Branch is merged via PR created by the Presenter (Stage 8).
- **Concurrent pipeline isolation:**
  - Each pipeline run uses `git worktree add` to create an isolated working directory for its branch `agent/<issue-number>`.
  - This prevents concurrent pipelines (different issues) from interfering with each other's file modifications.
  - Worktree is cleaned up after the pipeline completes (success or failure).
- **Acceptance criteria:**
  - Stage script validates output artifacts before committing.
  - Every successful stage results in exactly one commit + push to `agent/<issue-number>`.
  - Failed stages produce no commits.
  - Branch is created/reused automatically by the pipeline.

### 3.15 FR-15: Configuration

- **Description:** All pipeline configuration is managed via environment variables. No config files — environment is the single source of truth.
- **Variables:**
  - `SDLC_MAX_CONTINUATIONS` — maximum continuations per stage (default: `3`).
  - `SDLC_MAX_QA_ITERATIONS` — maximum Executor+QA loop iterations (default: `3`).
  - `SDLC_STAGE_TIMEOUT_MINUTES` — default timeout per stage in minutes (default: `30`). Can be overridden per stage via `SDLC_STAGE_<N>_TIMEOUT_MINUTES`.
- **Acceptance criteria:**
  - All variables have sensible defaults in `lib.sh`.
  - Stage scripts read configuration from environment, falling back to defaults.
  - Variables can be set in GitHub Actions workflow YAML per job.

### 3.16 FR-16: Secrets

- **Description:** Defines the required secrets for pipeline operation.
- **Required secrets (GitHub Actions secrets):**
  - `ANTHROPIC_API_KEY` — API key for Claude Code CLI authentication.
  - `GITHUB_TOKEN` — automatically provided by GitHub Actions; used by `gh` CLI for PR creation and issue comments. Must have `issues:write`, `pull-requests:write`, `contents:write` permissions.
- **Acceptance criteria:**
  - Secrets are passed as environment variables to stage scripts by the GitHub Actions workflow.
  - No secrets are hardcoded in scripts, prompts, or Dockerfile.
  - Diff-based safety checks (FR-8) detect and reject any secret-like patterns in agent-produced code.

## 4. Non-functional requirements

- **Isolation:** Each agent runs in its own Claude Code process with no shared state except file artifacts. When multiple pipelines run concurrently for different issues, each pipeline operates in its own working directory cloned from the repository (worktree per branch `agent/<issue-number>`). This prevents file-level conflicts between concurrent pipelines modifying shared documents (`requirements.md`, `design.md`). Merge conflicts between branches are resolved manually by the maintainer at PR merge time. Deferred: automatic rebase-and-retry in a future version.
- **Reproducibility:** Agent prompts are versioned in the repository under `.sdlc/agents/`.
- **Observability:** Full logs stored per stage. Total pipeline duration reported in the final PR description.
- **Fault tolerance:** If a stage fails (agent error, timeout, continuation limit exhausted), the pipeline stops, Meta-Agent runs to analyze the failure, and the failure is reported on the issue. Manual restart is possible. Meta-Agent trigger is guaranteed by GitHub Actions `if: always()` on the Meta-Agent job (see FR-11 trigger mechanism).
- **Timeouts:** Each stage has a timeout configured at the CI/CD job level (GitHub Actions `timeout-minutes`). Default values are set via environment variables (see FR-15). When a timeout fires, the stage is treated as failed — Meta-Agent is triggered for analysis.
- **Security:** Enforced at the stage script level via diff-based checks (see FR-8). Agents do not have elevated permissions beyond what the CI runner provides.

## 5. Interfaces

- **Trigger:** GitHub Issues API (`issues.labeled` event).
- **Agent runtime:** `claude` CLI inside the pipeline Docker image. Invocation method: `claude -p "<task prompt>" --append-system-prompt-file .sdlc/agents/<role>.md --output-format json`. Key flags:
  - `--append-system-prompt-file` — adds role-specific instructions while preserving Claude Code's built-in capabilities (tool use, file access). This is preferred over `--system-prompt-file` which replaces the default prompt entirely and disables built-in tools.
  - `--output-format json` — returns structured JSON with `result`, `session_id`, `total_cost_usd`, `duration_ms`, `num_turns`, `is_error`. Stage scripts extract `session_id` via `jq -r '.session_id'` for use with `--resume`.
  - `--resume <session-id>` — re-invokes agent in the same session for continuations (FR-8). Session ID is stored in a shell variable during the stage script execution.
  - `-p "<prompt>"` — non-interactive mode, task description is passed as the prompt argument.
- **Stage orchestration:** Each stage is a shell script (`.sdlc/scripts/stage-<N>-<role>.sh`) that handles invocation, validation, continuation, and artifact commit.
- **Inter-stage communication:** Structured files in `.sdlc/pipeline/<issue-number>/` (one artifact per stage + logs). Each agent reads input files directly from the filesystem. Stage scripts validate output artifacts exist before committing. No manifest — filesystem is source of truth. On re-run, files are overwritten; history preserved in git.
- **Branching & commits:** All work on branch `agent/<issue-number>`. One commit + push per successful stage. Commit format: `sdlc(<role>): <issue-number> — <description>`. Failed stages produce no commits.
- **Human interaction:** GitHub Issue comments for status updates, progress reporting, and Meta-Agent findings (posted via `gh` CLI from stage scripts).
- **CI/CD:** GitHub Actions workflow with sequential jobs. All jobs use the same Docker image; each job runs its stage script. Workflow-level `concurrency` key (`group: agent-pipeline-<issue-number>`, `cancel-in-progress: false`) ensures at most one pipeline runs per issue; queued runs start after current completes. The Meta-Agent job is defined with `if: always()` and `needs: [all-stage-jobs]`, ensuring it runs on both success and failure. Failed stage scripts export `SDLC_FAILED_STAGE` as a GitHub Actions step output for the Meta-Agent to consume.

## 6. Acceptance criteria

The system is considered accepted if:

1. Creating a labeled issue triggers the full pipeline.
2. Each stage produces its expected artifact with all required sections.
3. The Continuation mechanism catches and fixes `deno task check` failures without human intervention.
4. The Executor+QA loop iterates until quality checks pass.
5. The Presenter creates a comprehensive PR with a human-readable summary.
6. All agent logs are preserved and accessible.
7. The Meta-Agent runs after every pipeline execution and produces actionable analysis.
8. Re-running the pipeline on the same issue cleanly overwrites artifacts.

## Appendix A: Pipeline Stage Map

| Stage | Role               | Artifact                       | Key Validation                               | Commit Contents                          |
| ----- | ------------------ | ------------------------------ | -------------------------------------------- | ---------------------------------------- |
| 1     | Project Manager    | `01-spec.md` + updated SRS     | Has all 4 sections, no SDS details           | `01-spec.md`, `requirements.md`, log     |
| 2     | Tech Lead          | `02-plan.md`                   | 2-3 variants with concrete file refs         | `02-plan.md`, log                        |
| 3     | Tech Lead Reviewer | `03-revised-plan.md`           | Critique + revision + recommendation         | `03-revised-plan.md`, log                |
| 4     | Architect          | `04-decision.md`               | Vision-aligned justification + task list     | `04-decision.md`, log                    |
| 5     | Tech Lead          | Updated SDS + `04a-sds-diff.md`| New components have purpose/interfaces/deps  | `design.md`, `04a-sds-diff.md`, log      |
| 6-7   | Executor + QA      | Code + `05-qa-report-N.md`     | `deno task check` passes, all AC covered     | Code changes, tests, QA reports, log     |
| 8     | Presenter          | `06-summary.md` + PR + comment | All diff files mentioned, no hallucinations  | `06-summary.md`, log                     |
| 9*    | Meta-Agent         | `07-meta-report.md`            | Evidence-based suggestions with prompt diffs | `07-meta-report.md`, log                 |

\* Meta-Agent also runs on pipeline failure at any stage.

## Appendix B: File Structure

```
.sdlc/
  agents/                              # Agent system prompts (versioned)
    pm.md
    tech-lead.md
    tech-lead-reviewer.md
    architect.md
    executor.md
    qa.md
    presenter.md
    meta-agent.md
  scripts/                             # Stage orchestration scripts
    lib.sh                             # Shared functions (logging, continuation loop, git ops)
    stage-1-pm.sh
    stage-2-tech-lead.sh
    stage-3-reviewer.sh
    stage-4-architect.sh
    stage-5-sds-update.sh
    stage-6-executor.sh                # Loop controller: invokes executor + calls stage-7-qa.sh
    stage-7-qa.sh                      # Called by stage-6, not directly by CI/CD
    stage-8-presenter.sh
    stage-9-meta-agent.sh
  pipeline/
    <issue-number>/                    # Per-issue artifacts (overwritten on re-run)
      01-spec.md
      02-plan.md
      03-revised-plan.md
      04-decision.md
      04a-sds-diff.md
      05-qa-report-<N>.md
      06-summary.md
      07-meta-report.md
      logs/
        stage-1-pm.json              # CLI JSON output (metadata)
        stage-1-pm.jsonl             # Full session transcript
        stage-2-tech-lead.json
        stage-2-tech-lead.jsonl
        ...
  Dockerfile                           # Single image for all stages
```
