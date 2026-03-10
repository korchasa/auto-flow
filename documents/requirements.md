# Specification: Agent Development Pipeline

## 0. Resolved Design Decisions

- **Target project:** This repo (auto-sdlc). Project-agnostic reuse deferred.
- **Concurrent pipelines:** One pipeline per branch. Single local execution assumed. No concurrent locking.
- **Cost limits:** Not tracked. No budget constraints.
- **Agent prompts:** Written incrementally alongside implementation.
- **CLAUDE.md interaction:** Target project's CLAUDE.md and agent system prompts complement each other (additive, not conflicting).
- **Issue complexity:** No size/complexity limits for now. Deferred.
- **Testing strategy:** Integration tests in this repo (no separate test repo). Unit tests for `lib.sh`.
- **Meta-Agent:** Auto-applies prompt improvements (commits to feature branch). Reviewed at PR merge.
- **Rollback:** Manual operation (no automated rollback).
- **Retry logic:** 3 attempts with exponential backoff for external API calls (`claude`, `gh`) in `lib.sh`.

## 1. Introduction

- **Document purpose:** Define the specification for the automated multi-agent development pipeline orchestrated via Claude Code agents and Deno engine.
- **Scope:** A locally-run system where a task description triggers a chain of specialized AI agents (via `deno task run:task <path>`, `run:text`, or `run:file`), each performing a distinct role in the software development lifecycle — from specification writing to QA verification.
- **Audience:** Project maintainer (korchasa), contributors.
- **Definitions and abbreviations:**
  - **Agent:** An isolated Claude Code CLI invocation with a dedicated system prompt (role).
  - **Stage:** A single step in the pipeline, executed by one agent.
  - **Handoff Artifact:** A structured Markdown file produced by one agent and consumed by the next.
  - **Agent Log:** A full transcript of an agent's session (input, reasoning, output, tool calls).
  - **Meta-Agent:** A separate agent that analyzes logs of other agents and refines their prompts.
  - **Continuation:** A mechanism for re-invoking an agent within the same session (via `--resume`) to fix issues detected by the stage script (see FR-8).

## 2. General description

- **System context:** Operates as a local Deno engine process triggered by CLI command (`deno task run:task <path>`, `run:text "..."`, or `run:file <path>`). The engine reads pipeline DAG config (`.sdlc/pipeline.yaml`), executes nodes sequentially/in parallel via `claude` CLI, validates outputs, and commits artifacts. Agents communicate through files in the repository.
- **Assumptions and constraints:**
  - A devcontainer provides the runtime environment with all required tools (see FR-12).
  - Each agent is stateless between runs — all context comes from input artifacts and its system prompt.
  - The target project is this repository (auto-sdlc). Pipeline design should be project-agnostic for future reuse in other repos.
- **Goal:** Automate the full development cycle for feature requests: from issue triage to a ready-to-merge PR — fully autonomous, no human gates between stages. PR merge is the only human checkpoint (post-pipeline, not between stages).

## 3. Functional requirements

### 3.1 FR-1: Pipeline Trigger

- **Description:** Pipeline triggered via separate `deno task` subcommands, one per input source type. Each subcommand determines how the initial task description is obtained.
- **Subcommands:**
  - `deno task run:task <path>` — reads task description from a task file (YAML/Markdown). Branch: `agent/<run-id>`.
  - `deno task run:text "description"` — uses inline text as task input. Branch: `agent/<run-id>`.
  - `deno task run:file <path>` — reads task description from a local file. Branch: `agent/<run-id>`.
- **Acceptance criteria:**
  - [ ] `deno task run:task <path>` starts pipeline with task file contents.
  - [ ] `deno task run:text "..."` starts pipeline with provided inline text.
  - [ ] `deno task run:file <path>` starts pipeline with file contents as task input.
  - [ ] Each subcommand maps to a separate `deno.json` task entry.
  - [ ] Common engine flags (`--resume`, `--dry-run`, `-v`, `-q`, `--config`) work with all subcommands.

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
  - Output is committed to a feature branch `agent/<run-id>`.
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
- **Orchestration:** The loop is managed by the engine's `loop` node type (`.sdlc/engine/loop.ts`). It invokes the Executor agent, then QA agent. Based on the QA verdict, it either exits the loop (on `PASS`) or re-invokes the Executor with the QA report (on `FAIL`). Legacy: `stage-6-executor.sh` calls `stage-7-qa.sh` as sub-step.
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
  - **Stage script responsibilities (engine path — `.sdlc/engine/`):**
    1. [x] Invoke `claude` CLI with the stage prompt and input artifacts. Evidence: `.sdlc/engine/agent.ts:208-230` (`buildClaudeArgs`), `.sdlc/engine/agent.ts:75-117` (invocation loop)
    2. After the agent exits, run stage-specific validation checks:
       - [x] **For Executor stage:** run `deno task check` via `custom_script` validation rule. If it fails, continuation is triggered. Evidence: `.sdlc/engine/validate.ts:49-50,127-162` (`checkCustomScript()`), `.sdlc/pipeline.yaml:126-127` (executor node `custom_script` config)
       - [x] **For QA stage:** (1) verify `05-qa-report-N.md` exists and is non-empty, (2) extract verdict via frontmatter parsing, (3) if verdict is not exactly `PASS` or `FAIL` — treat as validation failure, trigger continuation on QA agent. Evidence: `.sdlc/engine/validate.ts:51-52,164-228` (`checkFrontmatterField()`), `.sdlc/engine/validate_test.ts:225-351` (6 tests)
       - [x] **For all stages:** verify the expected output artifact exists and is non-empty. Evidence: `.sdlc/engine/validate.ts:60-88` (`file_exists`, `file_not_empty` rules), `.sdlc/pipeline.yaml` (per-node `validate` config)
    3. [x] If validation fails: re-invoke `claude --resume <session-id>` with the validation error output appended as context. Evidence: `.sdlc/engine/agent.ts:94-116` (resume prompt construction + `invokeClaudeCli` with `resumeSessionId`)
    4. [x] Repeat until validation passes or the continuation limit is reached. Evidence: `.sdlc/engine/agent.ts:75-91` (loop with `continuations < settings.max_continuations`)
  - **Continuation limits:**
    - [x] Maximum continuations per stage: configurable (default 3). Evidence: `.sdlc/pipeline.yaml:9` (`max_continuations: 3`), `.sdlc/engine/agent.ts:82-91`
    - [x] If limit reached: stage is marked as failed, pipeline stops, Meta-Agent is triggered (FR-11). Evidence: `.sdlc/engine/engine.ts:96-109,613-619` (`collectRunAlwaysNodes()`), `.sdlc/engine/types.ts:56-57` (`run_always` field), `.sdlc/engine/agent.ts:110-120` (continuation limit check)
  - **Session persistence:**
    - [x] The `--resume` flag ensures the agent retains full conversation context from the initial invocation. Evidence: `.sdlc/engine/agent.ts:208-230` (`--resume` flag in `buildClaudeArgs`)
    - [x] Each continuation adds only the validation error to the context, not the full prompt. Evidence: `.sdlc/engine/agent.ts:94-97` (resume prompt = failures only)
  - **Diff-based safety checks (all stages that modify files):**
    - After each agent exit, the engine runs `git diff` and checks for:
      - [x] Modifications to files outside the expected scope. Each stage defines an allowlist of files/paths it may modify (configured in `pipeline.yaml` per node via `allowed_paths`). Evidence: `.sdlc/engine/git.ts:56-104` (`safetyCheckDiff` with `allowedPaths` prefix matching)
        - Per-stage allowlists defined in `.sdlc/pipeline.yaml` per node.
        - **Executor (Stage 6):** file allowlist extracted from `04-decision.md` YAML frontmatter via `yq --front-matter=extract '.tasks[].files[]' 04-decision.md`, plus always-allowed paths: `.sdlc/pipeline/<issue-number>/`. Explicitly forbidden: `agents/`, `.sdlc/scripts/`, `.sdlc/engine/`, `CLAUDE.md`.
      - [ ] Deletion of files not mentioned in the task breakdown (Executor only).
      - Secrets detection in committed code (all stages):
        - [x] Primary: `gitleaks detect --no-git --staged` (included in devcontainer, see FR-12). Evidence: `.sdlc/engine/git.ts:179-216` (`runGitleaks()`), `.sdlc/engine/git.ts:108-126` (integration in `safetyCheckDiff()`)
        - [x] Fallback regex: `(?i)(api[_-]?key|secret|token|password|credential)\s*[:=]\s*['"][^'"]{8,}`. Evidence: `.sdlc/engine/git.ts:92-95`
    - [x] If a safety violation is detected: continuation is triggered with a description of the violation, asking the agent to revert the problematic changes. Evidence: `.sdlc/engine/engine.ts:307-395` (safety-continuation loop in `executeAgentNode()`)
  - **Stage script responsibilities (legacy path — `.sdlc/scripts/`):**
    - [x] Legacy shell implementation in `lib.sh`: `continuation_loop()`, `safety_check_diff()`, `run_agent()`, `retry_with_backoff()`. Evidence: `.sdlc/scripts/lib.sh:59-233`
- **Quality metrics:**
  - Continuation success rate: percentage of continuations that resolve the issue (target > 70%).
  - Average continuations per stage (target < 1.0 across all runs).

### 3.9 FR-9: Stage 8 — Presenter (Change Summary)

- **Description:** The Presenter agent creates a human-readable summary of all changes made during the pipeline, suitable for a PR description and issue comment.
- **Input:** `01-spec.md`, `04-decision.md`, latest `05-qa-report-*.md`, `git diff main...HEAD`, updated `documents/requirements.md`, updated `documents/design.md`.
- **Output:** `.sdlc/pipeline/<issue-number>/06-summary.md`, Pull Request targeting `main`.
- **Acceptance criteria:**
  - Agent produces `06-summary.md` containing:
    - Executive summary: what was requested and what was done.
    - Key changes: list of modified/added files with brief descriptions.
    - SRS/SDS changes: what requirements and design sections were added or modified.
    - Before/after comparisons where applicable (API changes, config changes, behavior changes).
    - Testing summary: what was tested, coverage highlights.
    - Known limitations or follow-up items.
  - Agent creates a Pull Request targeting `main` with `06-summary.md` content as the PR body. PR requires manual review and merge — this is the only intentional human gate in the pipeline. Rationale: AI-generated code changes must be reviewed before merging to `main`.
  - **Error handling:** If PR creation via `gh` fails, the stage fails immediately (fail fast). Meta-Agent is triggered for analysis.
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
  - [x] After each non-loop agent node completes successfully, the engine saves two files to `.sdlc/runs/<run-id>/logs/`:
    - `<node-id>.json` — full `ClaudeCliOutput` JSON object (`result`, `session_id`, `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `is_error`).
    - `<node-id>.jsonl` — copy of the JSONL session transcript from `~/.claude/projects/<project-hash>/`, located by matching `session_id` in filenames.
    - Evidence: `.sdlc/engine/engine.ts:266-270`, `.sdlc/engine/log.ts:18-47`
  - [x] If the JSONL transcript file is not found: engine logs a warning and continues — pipeline does NOT fail. Evidence: `.sdlc/engine/log.ts:43-45`
  - [x] Loop body nodes (executor, qa) are excluded from engine-level log saving (deferred). Evidence: `.sdlc/engine/loop.ts` — no `saveAgentLog` call
  - [x] Log-saving logic has unit tests covering: successful save, JSONL-not-found warning path. Evidence: `.sdlc/engine/log_test.ts:29-124` (5 tests)

### 3.11 FR-11: Meta-Agent (Prompt Optimization)

- **Description:** A dedicated agent that runs after every pipeline execution (both success and failure). It analyzes the logs of the current run, identifies errors, friction points, and inefficiencies, and produces actionable prompt improvement suggestions.
- **Trigger conditions:**
  - **On pipeline success:** runs as the final stage after Presenter (Stage 9).
  - **On pipeline failure:** runs automatically when any stage fails after exhausting its continuation limit.
- **Trigger mechanism:** Engine executes meta-agent node as the last DAG node. In `pipeline.yaml`, the meta-agent node depends on all other nodes and is configured to run regardless of upstream success/failure (engine handles this via `run_always: true` or equivalent). Failed node ID is available in `state.json`.
- **Input:**
  - All logs from `.sdlc/pipeline/<issue-number>/logs/`.
  - All handoff artifacts produced before the failure (if failed).
  - Current agent prompts from `agents/`.
  - The continuation/validation error output that caused the failure (if applicable).
- **Output:** `.sdlc/pipeline/<issue-number>/07-meta-report.md`.
- **Acceptance criteria:**
  - Agent produces `07-meta-report.md` containing:
    - **Run summary:** which stages completed, which failed, total continuations triggered.
    - **Error analysis** (if failed): root cause hypothesis for the failure, which prompt or input likely caused it.
    - **Friction points:** stages where the agent needed continuations, produced low-quality output, or took excessive tokens.
    - **Prompt improvements applied:** concrete edits to agent prompts with before/after diffs, committed to the feature branch.
    - **Pattern tracking:** recurring issues across multiple runs (references previous meta-reports if they exist in `.sdlc/pipeline/*/07-meta-report.md`).
  - Meta-Agent auto-applies prompt improvements directly to agent prompt files and commits changes to the feature branch. Changes are reviewed as part of the PR (human gate at merge).
- **Quality metrics:**
  - Every suggestion references a specific log excerpt as evidence.
  - Applied changes are actionable: each includes a concrete prompt diff, not vague advice like "improve clarity".

### 3.12 FR-12: Runtime Infrastructure

- **Description:** Pipeline runs locally inside a devcontainer. The Deno engine orchestrates agent invocations. Legacy shell scripts preserved for backward compatibility.
- **Devcontainer contents** (`.devcontainer/Dockerfile`):
  - `claude` CLI (Claude Code) — installed via `npm install -g @anthropic-ai/claude-code`.
  - `deno` runtime — for running project checks, tests, and the pipeline engine.
  - `git` — for branch management, commits, and diff-based safety checks.
  - `gh` CLI — for creating PRs and posting issue comments.
  - `gitleaks` — for secret detection in diff-based safety checks (see FR-8).
- **Stage scripts (legacy):**
  - Located in `.sdlc/scripts/stage-<N>-<role>.sh`.
  - Each script is responsible for:
    1. Preparing input: collecting handoff artifacts, setting environment variables.
    2. Invoking `claude` CLI with the agent prompt from `agents/<role>/SKILL.md`.
    3. Running stage-specific validation (artifact checks, `deno task check` for Executor).
    4. Implementing the Continuation mechanism (FR-8): re-invoking via `--resume` on validation failure.
    5. Committing output artifacts and logs to the feature branch.
    6. Reporting stage status to the GitHub Issue via `gh`.
  - Scripts share common functions via `.sdlc/scripts/lib.sh` (logging, git operations, continuation loop, artifact validation).
- **Acceptance criteria:**
  - Devcontainer builds successfully and contains all listed tools.
  - Primary launch: `deno task run:task <path>` (engine path).
  - Legacy: each stage can be run independently via `.sdlc/scripts/stage-1-pm.sh`.
  - Stage scripts are executable and pass `shellcheck` without errors.
  - **Retry logic:** `lib.sh` implements a generic retry wrapper (`retry_with_backoff`) used for all external API calls (`claude` CLI, `gh` CLI). Parameters: max attempts = 3, initial delay = 5s, backoff multiplier = 2x. Retryable conditions: non-zero exit code from CLI tools (network errors, rate limits). Non-retryable: validation failures, agent logic errors.

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
  - Engine path: artifacts stored in `.sdlc/runs/<run-id>/<node-id>/`, linked via `{{input.<node-id>}}` templates in `pipeline.yaml`.
  - Legacy path: artifacts in `.sdlc/pipeline/<issue-number>/`.
  - The file system is the single source of truth for inter-stage communication. No manifest or registry.
  - Claude CLI's built-in context auto-compression handles large input sets; no manual context management is required.
- **Commit strategy:**
  - All pipeline work happens on a dedicated feature branch `agent/<run-id>`.
  - Engine commits after each successful node. Legacy scripts commit + push after each stage.
  - Each commit message follows the format: `sdlc(<node-id>): <run-id> — <brief description>`.
  - Commit includes: stage output artifact(s), updated project documents (if any), and the stage log.
  - If a stage fails after exhausting continuations, the partial work is NOT committed.
- **Branch lifecycle:**
  - Branch is created at the start of Stage 1 (or checked out if it already exists from a previous run).
  - On re-run, existing branch is reused — new commits overwrite previous artifacts (previous versions preserved in git history per FR-13).
  - Branch is merged via PR created by the Presenter (Stage 8).
- **Acceptance criteria:**
  - Engine/script validates output artifacts before committing.
  - Every successful stage results in exactly one commit on `agent/<run-id>`.
  - Failed stages produce no commits.
  - Branch is created/reused automatically by the pipeline.

### 3.15 FR-15: Configuration

- **Description:** Pipeline configuration via environment variables and `pipeline.yaml`. Env vars override YAML defaults.
- **Variables:**
  - `SDLC_MAX_CONTINUATIONS` — maximum continuations per stage (default: `3`).
  - `SDLC_MAX_QA_ITERATIONS` — maximum Executor+QA loop iterations (default: `3`).
  - `SDLC_STAGE_TIMEOUT_MINUTES` — default timeout per stage in minutes (default: `30`).
- **Acceptance criteria:**
  - All variables have sensible defaults in `lib.sh` (legacy) and engine config (`.sdlc/engine/config.ts`).
  - Engine and stage scripts read configuration from environment, falling back to defaults.

### 3.16 FR-16: Secrets

- **Description:** Defines the required secrets for pipeline operation.
- **Authentication:**
  - **Claude Code CLI:** OAuth session (`claude login`) or `ANTHROPIC_API_KEY` env var. OAuth is the default method in devcontainer; API key is an optional alternative.
  - `GITHUB_TOKEN` — used by `gh` CLI for PR creation and issue comments. Must have `issues:write`, `pull-requests:write`, `contents:write` permissions. Can be obtained via `gh auth token`.
- **Acceptance criteria:**
  - Claude CLI auth is available (OAuth session or API key) before running the engine.
  - No secrets are hardcoded in scripts, prompts, or Dockerfile.
  - Diff-based safety checks (FR-8) detect and reject any secret-like patterns in agent-produced code.

### 3.17 FR-17: Project Directory Structure

- **Description:** Project directory layout must reflect application structure, not be buried under a single `.sdlc/` prefix. Engine code, agent prompts, pipeline config, and run artifacts should be organized at the top level as distinct concerns.
- **Motivation:** Current `.sdlc/` prefix conflates engine source code, configuration, runtime data, and legacy scripts. This hinders navigation, IDE support, and standard tooling (test runners, linters).
- **Acceptance criteria:**
  - [ ] Engine source code lives under a standard `src/` or dedicated top-level directory (not `.sdlc/engine/`).
  - [ ] Agent prompts in a top-level `agents/` directory (not `.sdlc/agents/`).
  - [ ] Pipeline config (`pipeline.yaml`) at project root or in a config directory.
  - [ ] Run artifacts in a gitignored data directory (e.g., `runs/` or `.runs/`).
  - [ ] Legacy shell scripts in a `scripts/` directory (not `.sdlc/scripts/`).
  - [ ] `deno.json` tasks, imports, and test paths updated accordingly.
  - [ ] All existing tests pass after restructuring.
  - [ ] SDS (`documents/design.md`) Appendix B updated to reflect new layout.

### 3.18 FR-18: Verbose Output (`-v`)

- **Description:** With `-v` flag, engine output must provide full transparency into what is happening at every step — not just node start/stop, but the reasoning context: what input is being passed, what prompt is constructed, what validation is run, what the result is.
- **Motivation:** Current verbose mode shows only lifecycle events (started/completed/failed). Debugging pipeline issues or understanding agent behavior requires reading log files after the fact.
- **Acceptance criteria:**
  - [x] `-v` shows the full task prompt text sent to each agent (after template interpolation). Evidence: `.sdlc/engine/output.ts:109-114` (`verbosePrompt()`), `.sdlc/engine/agent.ts:67-69`
  - [x] `-v` shows the list of input artifacts resolved for each node (file paths + sizes). Evidence: `.sdlc/engine/output.ts:117-123` (`verboseInputs()`), `.sdlc/engine/engine.ts:280`
  - [x] `-v` shows validation rule execution: which rules ran, pass/fail per rule, failure details. Evidence: `.sdlc/engine/output.ts:126-137` (`verboseValidation()`), `.sdlc/engine/agent.ts:98-104`
  - [x] `-v` shows continuation context: why continuation was triggered, what error text is appended. Evidence: `.sdlc/engine/output.ts:140-151` (`verboseContinuation()`), `.sdlc/engine/agent.ts:126-135`
  - [x] `-v` streams agent stdout in real-time (not buffered until completion). Evidence: `.sdlc/engine/output.ts` (`nodeOutput()` method — pre-existing)
  - [x] `-v` shows safety check results: which files were diffed, any violations found. Evidence: `.sdlc/engine/output.ts:154-172` (`verboseSafety()`), `.sdlc/engine/engine.ts:326-330`
  - [x] `-v` shows commit details: files staged, commit message, branch. Evidence: `.sdlc/engine/output.ts:175-188` (`verboseCommit()`), `.sdlc/engine/engine.ts:544-549`
  - [x] Default mode (no `-v`) remains concise: node start/complete/fail + summary. Evidence: `.sdlc/engine/output_test.ts:175-197` (all 6 verbose methods produce zero output in default mode)

### 3.19 FR-19: Agents as Skills

- **Description:** Each pipeline agent is a Claude Code project skill, stored in `./agents/<name>/SKILL.md`. Skills are linked into `.claude/skills/` via symlinks for IDE integration. Each agent can be invoked standalone via `/agent-<name>` or used by the pipeline engine.
- **Agents (9):** pm, tech-lead, tech-lead-reviewer, architect, tech-lead-sds, executor, qa, presenter, meta-agent.
- **Acceptance criteria:**
  - [ ] Each of 9 agents has a dedicated directory under `./agents/<name>/` with a `SKILL.md` file containing YAML frontmatter (name, description, disable-model-invocation) and role instructions.
  - [ ] Symlinks exist: `.claude/skills/agent-<name>` → `../../agents/<name>/` for all 9 agents.
  - [ ] Pipeline engine `prompt:` fields in `pipeline.yaml` and `pipeline-task.yaml` reference the new SKILL.md paths (e.g., `agents/pm/SKILL.md`).
  - [ ] Current `.sdlc/agents/*.md` files are migrated (content preserved, format adapted to SKILL.md with frontmatter).
  - [ ] `.sdlc/agents/` directory removed after migration.
  - [ ] Each agent skill is invocable standalone via `/agent-<name>`.
  - [ ] `deno task check` passes after migration.
  - [ ] References to `.sdlc/agents/` in SRS sections (FR-8, FR-11, FR-12, Interfaces, Appendix B) updated to reflect new `agents/<name>/SKILL.md` paths.

## 4. Non-functional requirements

- **Isolation:** Each agent runs in its own Claude Code process with no shared state except file artifacts. Single local execution assumed (one pipeline at a time). Concurrent execution is not supported.
- **Reproducibility:** Agent prompts are versioned in the repository under `agents/`.
- **Observability:** Full logs stored per stage in `.sdlc/runs/<run-id>/logs/`. Total pipeline duration reported in the final PR description.
- **Fault tolerance:** If a stage fails (agent error, timeout, continuation limit exhausted), the pipeline stops, Meta-Agent runs to analyze the failure. Manual restart via `--resume <run-id>`.
- **Timeouts:** Each stage has a configurable timeout via `SDLC_STAGE_TIMEOUT_MINUTES` env var (default: 30 min). Engine enforces timeout per node. When a timeout fires, the stage is treated as failed — Meta-Agent is triggered for analysis.
- **Security:** Enforced at the engine/stage script level via diff-based checks (see FR-8). Agents run with the local user's permissions.

## 5. Interfaces

- **Trigger:** Separate `deno task` subcommands per input source: `run:task <path>` (task file), `run:text "..."` (inline text), `run:file <path>` (local file). All share common engine flags.
- **Agent runtime:** `claude` CLI invoked by the Deno engine. Invocation: `claude -p "<task prompt>" --append-system-prompt-file agents/<role>/SKILL.md --output-format json`. Key flags:
  - `--append-system-prompt-file` — adds role-specific instructions while preserving Claude Code's built-in capabilities (tool use, file access). Preferred over `--system-prompt-file` which replaces the default prompt entirely.
  - `--output-format json` — returns structured JSON with `result`, `session_id`, `total_cost_usd`, `duration_ms`, `num_turns`, `is_error`.
  - `--resume <session-id>` — re-invokes agent in the same session for continuations (FR-8).
  - `-p "<prompt>"` — non-interactive mode, task description is passed as the prompt argument.
- **Pipeline engine:** Deno/TypeScript engine (`.sdlc/engine/`) reads DAG config from `.sdlc/pipeline.yaml`, resolves node dependencies, executes nodes in topological order, manages state in `.sdlc/runs/<run-id>/state.json`.
- **Legacy stage scripts:** `.sdlc/scripts/stage-<N>-<role>.sh` — handle invocation, validation, continuation, artifact commit. Superseded by engine but preserved.
- **Inter-stage communication:** Engine: artifacts in `.sdlc/runs/<run-id>/<node-id>/`, linked via templates. Legacy: `.sdlc/pipeline/<issue-number>/`. Filesystem is source of truth.
- **Branching & commits:** All work on branch `agent/<run-id>`. One commit per successful stage. Commit format: `sdlc(<node-id>): <run-id> — <description>`. Failed stages produce no commits.

## 6. Acceptance criteria

The system is considered accepted if:

1. Running `deno task run:task <path>` triggers the full pipeline for the given task.
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
agents/                                  # Agent system prompts (versioned, SKILL.md)
  pm/SKILL.md
  tech-lead/SKILL.md
  tech-lead-reviewer/SKILL.md
  architect/SKILL.md
  tech-lead-sds/SKILL.md
  executor/SKILL.md
  qa/SKILL.md
  presenter/SKILL.md
  meta-agent/SKILL.md
.claude/skills/                          # Symlinks for Claude Code skill discovery
  agent-pm -> ../../agents/pm/
  agent-tech-lead -> ../../agents/tech-lead/
  ...                                    # (9 symlinks total)
.sdlc/
  scripts/                             # Stage orchestration scripts
    lib.sh                             # Shared functions (logging, continuation loop, git ops)
    stage-1-pm.sh
    stage-2-tech-lead.sh
    stage-3-reviewer.sh
    stage-4-architect.sh
    stage-5-sds-update.sh
    stage-6-executor.sh                # Loop controller: invokes executor + calls stage-7-qa.sh
    stage-7-qa.sh                      # Called by stage-6, not directly by engine
    stage-8-presenter.sh
    stage-9-meta-agent.sh
  engine/                              # Deno/TypeScript pipeline engine
    cli.ts                             # Entry point: deno task run:{task|text|file}
    engine.ts                          # DAG executor
    ...
  runs/
    <run-id>/                          # Per-run artifacts (engine path)
      <node-id>/                       # Node output directory
      logs/
        <node-id>.json               # CLI JSON output (metadata)
        <node-id>.jsonl              # Full session transcript
      state.json                     # Run state (node statuses, session IDs)
  pipeline/
    <issue-number>/                    # Per-issue artifacts (legacy path, overwritten on re-run)
      01-spec.md
      02-plan.md
      ...
  pipeline.yaml                        # DAG-based pipeline configuration
```

- возможность продолжить работу после остановки по какой-то причине. С указанием шага, с которого продолжаем
- проверки незакомиченности должны проверять конкретные папки, а не все

