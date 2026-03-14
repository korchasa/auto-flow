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
- **Scope:** A locally-run system where a GitHub Issue triggers a chain of specialized AI agents (via `deno task run [--prompt "..."]`), each performing a distinct role in the software development lifecycle — from issue triage to QA verification. PM agent autonomously selects and triages open GitHub issues.
- **Audience:** Project maintainer (korchasa), contributors.
- **Definitions and abbreviations:**
  - **Agent:** An isolated Claude Code CLI invocation with a dedicated system prompt (role).
  - **Stage:** A single step in the pipeline, executed by one agent.
  - **Handoff Artifact:** A structured Markdown file produced by one agent and consumed by the next.
  - **Agent Log:** A full transcript of an agent's session (input, reasoning, output, tool calls).
  - **Meta-Agent:** A separate agent that analyzes logs of other agents and refines their prompts.
  - **Continuation:** A mechanism for re-invoking an agent within the same session (via `--resume`) to fix issues detected by the stage script (see FR-8).

## 2. General description

- **System context:** Operates as a local Deno engine process triggered by CLI command (`deno task run [--prompt "..."]`). The engine reads pipeline DAG config (`.sdlc/pipeline.yaml`), executes nodes sequentially/in parallel via `claude` CLI, validates outputs, and commits artifacts. PM agent autonomously triages open GitHub issues; `--prompt` passes optional additional context. Agents communicate through files in the repository.
- **Assumptions and constraints:**
  - A devcontainer provides the runtime environment with all required tools (see FR-12).
  - Each agent is stateless between runs — all context comes from input artifacts and its system prompt.
  - The target project is this repository (auto-sdlc). Pipeline design should be project-agnostic for future reuse in other repos.
- **Goal:** Automate the full development cycle for feature requests: from issue triage to a ready-to-merge PR — fully autonomous, no human gates between stages. PR merge is the only human checkpoint (post-pipeline, not between stages).

## 3. Functional requirements

### 3.1 FR-1: Pipeline Trigger

- **Description:** Single entry point `deno task run [--prompt "..."]`. PM agent autonomously triages open GitHub issues — selects highest-priority open issue, fetches its title and body, and writes `issue: <N>` in `01-spec.md` YAML frontmatter. `--prompt` provides optional additional context passed to the PM agent.
- **Acceptance criteria:**
  - [ ] `deno task run` starts pipeline; PM selects highest-priority open issue autonomously.
  - [ ] `deno task run --prompt "..."` passes additional context string to PM agent.
  - [ ] PM writes `issue: <N>` in `01-spec.md` YAML frontmatter after issue selection.
  - [ ] Common engine flags (`--resume`, `--dry-run`, `-v`, `-q`, `--config`) work with the single entry point.

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

### 3.3 FR-3: Stage 2 — Architect (Design-Solution Plan)

- **Description:** The Architect agent (FR-26: renamed from Tech Lead) reads the specification and produces a design-solution plan with 2-3 implementation variants.
- **Input:** `01-spec.md`, `documents/requirements.md`, `documents/design.md`, relevant source code.
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

### 3.4 FR-4: Plan Critique & Revision (absorbed into Tech Lead, FR-26)

- **Description:** Plan critique and revision functionality is now absorbed into the Tech Lead agent (FR-5). The Tech Lead critiques the Architect's plan, selects a variant, and produces the task breakdown — all in one stage. Separate reviewer agent eliminated (FR-26).
- **Previous input/output:** `02-plan.md` → `03-revised-plan.md` (no longer produced as separate artifact).
- **Acceptance criteria:**
  - Critique is embedded in Tech Lead's `04-decision.md` body (at least one issue per variant).
  - No separate reviewer node in `pipeline.yaml`.

### 3.5 FR-5: Stage 3 — Tech Lead (Decision + Branch + PR)

- **Description:** The Tech Lead agent (FR-26: renamed from Architect) critiques the Architect's plan, selects the final implementation variant, updates the SDS, creates a feature branch and draft PR, and produces a task breakdown for the Developer. Absorbs former reviewer (FR-4) and SDS-update (FR-6) responsibilities.
- **Input:** `02-plan.md`, `01-spec.md`, `documents/requirements.md`, `documents/design.md`, `AGENTS.md`, relevant source code.
- **Output:** `04-decision.md` in node output directory, updated `documents/design.md`, feature branch, draft PR.
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
- **Branch naming:** `sdlc/issue-<N>` for issue-driven runs, `sdlc/{{run_id}}` for `--prompt` mode.
- **Acceptance criteria:**
  - Agent reads all input artifacts listed above.
  - Agent critiques each variant (at least one issue per variant).
  - Agent selects one variant with a justification covering:
    - Technical fit (from the plan).
    - Alignment with product vision and project conventions.
    - Complexity/maintainability trade-off.
  - Agent produces `04-decision.md` starting with YAML frontmatter containing `variant` and `tasks` fields (see format above), followed by critique, justification, and detailed task descriptions.
  - Agent updates `documents/design.md` with selected variant's design details.
  - Agent creates feature branch and opens draft PR.
- **Quality metrics:**
  - Justification references at least one point from `AGENTS.md`.
  - Task checklist is ordered by dependency (blocking tasks first).
  - Each task is atomic — achievable in a single commit.
  - Tech Lead prompt MUST include a concrete YAML frontmatter example to ensure LLM compliance.

### 3.6 FR-6: SDS Update (absorbed into Tech Lead, FR-26)

- **Description:** SDS update functionality is now absorbed into the Tech Lead agent (FR-5). The Tech Lead updates `documents/design.md` as part of its decision-making stage. Separate sds-update agent eliminated (FR-26).
- **Previous input/output:** `04-decision.md` → updated `documents/design.md` (now done by Tech Lead).
- **Acceptance criteria:**
  - Tech Lead updates `documents/design.md` with selected variant's design details.
  - No separate sds-update node in `pipeline.yaml`.

### 3.7 FR-7: Stage 6-7 — Developer + QA (Iterative Implementation Loop)

- **Description:** The Developer and QA agents work as an iterative pair. Developer implements, QA verifies. If QA finds issues, Developer fixes them. The loop continues until QA passes or the iteration limit is reached.
- **Orchestration:** The loop is managed by the engine's `loop` node type (`engine/loop.ts`). It invokes the Developer agent, then QA agent. Based on the QA verdict, it either exits the loop (on `PASS`) or re-invokes the Developer with the QA report (on `FAIL`). Legacy: `stage-6-developer.sh` calls `stage-7-qa.sh` as sub-step.
- **Developer Input:** `04-decision.md`, `documents/requirements.md`, `documents/design.md`, source code. On subsequent iterations: previous QA report (`05-qa-report-N.md`).
- **Developer Output:** Code changes, tests, commits and pushes on feature branch. PR comment with implementation summary.
- **QA Input:** `01-spec.md`, `04-decision.md`, all changed files, test results.
- **QA Output:** `05-qa-report.md` in node output directory. PR review verdict (`gh pr review`: approve/request-changes).
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
    - [ ] Loop body nodes (`developer`, `qa`) MUST be defined inline within the loop node config, not as top-level pipeline nodes. Body node IDs are loop-scoped.
    - [ ] Body nodes can declare `inputs` referencing both sibling body nodes (within the same loop) and external top-level nodes.
    - [ ] `{{loop.iteration}}` template variable is only available in loop body node contexts.
  - **Loop constraints:**
    - Maximum iterations: configurable (default 3).
    - If limit reached without `PASS`: pipeline stops and reports failure on the issue. Meta-Agent is triggered (see FR-10).
- **Quality metrics:**
  - `deno task check` passes on every Developer commit (enforced by stage script, see FR-8).
  - QA report covers 100% of acceptance criteria from `01-spec.md`.
  - Each QA issue has: description, affected file, severity (blocking/non-blocking).
  - `qa.md` prompt MUST include a concrete YAML frontmatter example to ensure LLM compliance.

### 3.8 FR-8: Continuation Mechanism

- **Description:** Each stage script wraps the Claude Code CLI invocation and validates the agent's output before considering the stage complete. If validation fails, the script re-invokes the agent in the same session using `--resume` with a description of the problem, giving the agent a chance to fix its output without starting from scratch.
- **Acceptance criteria:**
  - **Stage script responsibilities (engine path — `engine/`):**
    1. [x] Invoke `claude` CLI with the stage prompt and input artifacts. Evidence: `engine/agent.ts:208-230` (`buildClaudeArgs`), `engine/agent.ts:75-117` (invocation loop)
    2. After the agent exits, run stage-specific validation checks:
       - [x] **For Developer stage:** run `deno task check` via `custom_script` validation rule. If it fails, continuation is triggered. Evidence: `engine/validate.ts:49-50,127-162` (`checkCustomScript()`), `.sdlc/pipeline.yaml` (developer node `custom_script` config)
       - [x] **For QA stage:** (1) verify `05-qa-report-N.md` exists and is non-empty, (2) extract verdict via frontmatter parsing, (3) if verdict is not exactly `PASS` or `FAIL` — treat as validation failure, trigger continuation on QA agent. Evidence: `engine/validate.ts:51-52,164-228` (`checkFrontmatterField()`), `engine/validate_test.ts:225-351` (6 tests)
       - [x] **For all stages:** verify the expected output artifact exists and is non-empty. Evidence: `engine/validate.ts:60-88` (`file_exists`, `file_not_empty` rules), `.sdlc/pipeline.yaml` (per-node `validate` config)
    3. [x] If validation fails: re-invoke `claude --resume <session-id>` with the validation error output appended as context. Evidence: `engine/agent.ts:94-116` (resume prompt construction + `invokeClaudeCli` with `resumeSessionId`)
    4. [x] Repeat until validation passes or the continuation limit is reached. Evidence: `engine/agent.ts:75-91` (loop with `continuations < settings.max_continuations`)
  - **Continuation limits:**
    - [x] Maximum continuations per stage: configurable (default 3). Evidence: `.sdlc/pipeline.yaml:9` (`max_continuations: 3`), `engine/agent.ts:82-91`
    - [x] If limit reached: stage is marked as failed, pipeline stops, Meta-Agent is triggered (FR-11, FR-25). Evidence: `engine/engine.ts:96-109,613-619` (`collectRunOnNodes()`), `engine/types.ts:56-57` (`run_on` field), `engine/agent.ts:110-120` (continuation limit check)
  - **Session persistence:**
    - [x] The `--resume` flag ensures the agent retains full conversation context from the initial invocation. Evidence: `engine/agent.ts:208-230` (`--resume` flag in `buildClaudeArgs`)
    - [x] Each continuation adds only the validation error to the context, not the full prompt. Evidence: `engine/agent.ts:94-97` (resume prompt = failures only)
  - **Secret detection (moved to `deno task check`):**
    - [x] `gitleaks detect --no-git` runs as part of `scripts/check.ts` (after lint, before tests). `allowFailure=true` — skips if gitleaks binary not found. Evidence: `scripts/check.ts:87`
    - Scope check (`allowed_paths`) and engine-level `safetyCheckDiff()` removed. Rationale: engine no longer commits per-node; scope enforcement via agent prompts and QA validation.
    - [ ] Future: simplified safety checks via `git diff` + file hash comparison
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
    - Evidence: `engine/engine.ts:266-270`, `engine/log.ts:18-47`
  - [x] If the JSONL transcript file is not found: engine logs a warning and continues — pipeline does NOT fail. Evidence: `engine/log.ts:43-45`
  - [ ] Loop body nodes (developer, qa) must have logs saved after each iteration. Log files use iteration-qualified names: `<node-id>-iter-<N>.json` and `<node-id>-iter-<N>.jsonl`. `runLoop()` calls `saveAgentLog()` for each body node after successful completion.
  - [ ] `LoopResult` includes per-iteration `AgentResult` references (with `ClaudeCliOutput`) to enable log extraction by the engine.
  - [x] Log-saving logic has unit tests covering: successful save, JSONL-not-found warning path. Evidence: `engine/log_test.ts:29-124` (5 tests)

### 3.11 FR-11: Meta-Agent (Prompt Optimization)

- **Description:** A dedicated agent that runs after every pipeline execution (both success and failure). It analyzes the logs of the current run, identifies errors, friction points, and inefficiencies, and produces actionable prompt improvement suggestions.
- **Trigger conditions:**
  - **On pipeline success:** runs as the final stage after Presenter (Stage 9).
  - **On pipeline failure:** runs automatically when any stage fails after exhausting its continuation limit.
- **Trigger mechanism:** Engine executes meta-agent node as a post-pipeline node. In `pipeline.yaml`, the meta-agent node is configured with `run_on: always` (FR-25) to run regardless of upstream success/failure. Failed node ID is available in `state.json`.
- **Input:**
  - `documents/meta.md` — persistent memory (read first).
  - Run logs from `<run-dir>/logs/` and `state.json`.
  - Current agent prompts from `.claude/skills/agent-*/`.
  - `<run-dir>/failed-node.txt` (on pipeline failure).
- **Output:**
  - Primary: edited `.claude/skills/agent-*/SKILL.md` (prompt fixes).
  - Secondary: `<run-dir>/meta-agent/07-changelog.md` (minimal fix log).
  - Persistent: updated `documents/meta.md` (cross-run memory).
- **Acceptance criteria:**
  - Agent analyzes logs, diagnoses problems, and edits agent prompts directly.
  - `07-changelog.md` lists each fix with evidence (turns/cost/error data).
  - `documents/meta.md` updated with new patterns, fix outcomes, baselines.
  - Does NOT produce verbose reports — focus is on prompt optimization.
- **Quality metrics:**
  - Every fix references specific log data as evidence.
  - Fixes are minimal, targeted, and testable in next run.

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
    2. Invoking `claude` CLI with the agent prompt from `.claude/skills/agent-<role>/SKILL.md`.
    3. Running stage-specific validation (artifact checks, `deno task check` for Developer).
    4. Implementing the Continuation mechanism (FR-8): re-invoking via `--resume` on validation failure.
    5. Committing output artifacts and logs to the feature branch.
    6. Reporting stage status to the GitHub Issue via `gh`.
  - Scripts share common functions via `.sdlc/scripts/lib.sh` (logging, git operations, continuation loop, artifact validation).
- **Acceptance criteria:**
  - Devcontainer builds successfully and contains all listed tools.
  - Primary launch: `deno task run [--prompt "..."]` (engine path).
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
- **Commit strategy (FR-26):**
  - Feature branch `sdlc/issue-<N>` created by Tech Lead agent. Fallback `sdlc/{{run_id}}` for `--prompt` mode.
  - Engine does NOT auto-commit after nodes (invariant preserved).
  - No dedicated committer agent nodes. Developer owns commits: `git add`, `git commit`, `git push` after each task. Commit format: `sdlc(impl): <summary>`.
  - Tech Lead creates draft PR before impl-loop. Developer pushes to same branch.
  - QA posts PR review verdicts. Tech-lead-review performs final review + merge.
  - Legacy scripts commit + push after each stage (unchanged).
- **Branch lifecycle:**
  - Branch created by Tech Lead agent after variant selection.
  - On re-run, existing branch is reused — new commits overwrite previous artifacts (previous versions preserved in git history per FR-13).
  - Branch is merged via tech-lead-review post-pipeline agent.
- **Acceptance criteria:**
  - [x] Engine does NOT auto-commit after any node. Evidence: `engine.ts` — no `commitIfNeeded()` calls
  - Developer commits/pushes own code during implementation.
  - Tech Lead creates feature branch and draft PR.
  - Tech-lead-review merges PR if CI passes.

### 3.15 FR-15: Configuration

- **Description:** Pipeline configuration via environment variables and `pipeline.yaml`. Env vars override YAML defaults.
- **Variables:**
  - `SDLC_MAX_CONTINUATIONS` — maximum continuations per stage (default: `3`).
  - `SDLC_MAX_QA_ITERATIONS` — maximum Developer+QA loop iterations (default: `3`).
  - `SDLC_STAGE_TIMEOUT_MINUTES` — default timeout per stage in minutes (default: `30`).
- **Acceptance criteria:**
  - All variables have sensible defaults in `lib.sh` (legacy) and engine config (`engine/config.ts`).
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
  - [x] Engine source code lives under a standard `src/` or dedicated top-level directory (not `.sdlc/engine/`). Evidence: `engine/` (top-level directory, 30 files moved via `git mv .sdlc/engine/ engine/`)
  - ~~`[ ] Agent prompts in a top-level agents/ directory`~~ — superseded by FR-36/FR-19: canonical location is `.claude/skills/agent-<name>/`.
  - [ ] Pipeline config (`pipeline.yaml`) at project root or in a config directory.
  - [ ] Run artifacts in a gitignored data directory (e.g., `runs/` or `.sdlc/runs/`); `.gitignore` updated.
  - [ ] Legacy shell scripts in a `scripts/` directory (not `.sdlc/scripts/`).
  - [ ] `deno.json` tasks (`run`, `run:validate`, `test:engine`), imports, and test paths updated to reference new engine path.
  - [ ] All existing tests pass after restructuring.
  - [ ] SDS (`documents/design.md`) Appendix B updated to reflect new layout.

### 3.18 FR-18: Verbose Output (`-v`)

- **Description:** With `-v` flag, engine output must provide full transparency into what is happening at every step — not just node start/stop, but the reasoning context: what input is being passed, what prompt is constructed, what validation is run, what the result is.
- **Motivation:** Current verbose mode shows only lifecycle events (started/completed/failed). Debugging pipeline issues or understanding agent behavior requires reading log files after the fact.
- **Acceptance criteria:**
  - [x] `-v` shows the full task prompt text sent to each agent (after template interpolation). Evidence: `engine/output.ts:109-114` (`verbosePrompt()`), `engine/agent.ts:67-69`
  - [x] `-v` shows the list of input artifacts resolved for each node (file paths + sizes). Evidence: `engine/output.ts:117-123` (`verboseInputs()`), `engine/engine.ts:280`
  - [x] `-v` shows validation rule execution: which rules ran, pass/fail per rule, failure details. Evidence: `engine/output.ts:126-137` (`verboseValidation()`), `engine/agent.ts:98-104`
  - [x] `-v` shows continuation context: why continuation was triggered, what error text is appended. Evidence: `engine/output.ts:140-151` (`verboseContinuation()`), `engine/agent.ts:126-135`
  - [x] `-v` streams agent stdout in real-time (not buffered until completion). Evidence: `engine/output.ts` (`nodeOutput()` method — pre-existing)
  - ~~`-v` shows safety check results~~ — `verboseSafety()` removed (FR-56: engine domain-agnostic refactor; safety output now via agent stdout).
  - ~~`-v` shows commit details~~ — `verboseCommit()` removed (FR-56: engine no longer commits; git operations delegated to agent nodes).
  - [x] Default mode (no `-v`) remains concise: node start/complete/fail + summary. Evidence: `engine/output_test.ts:175-197` (all 6 verbose methods produce zero output in default mode)

### 3.19 FR-19: Agents as Skills

- **Description:** Each pipeline agent is a Claude Code project skill stored canonically in `.claude/skills/agent-<name>/SKILL.md` per the agentskills.io specification. Each skill directory may include a `scripts/` subdirectory with co-located stage scripts. No symlinks. Each agent can be invoked standalone via `/agent-<name>` or used by the pipeline engine.
- **Agents (7):** pm, architect, tech-lead, tech-lead-review, developer, qa, meta-agent. (FR-26: reduced from 10-agent set; removed committer, tech-lead-reviewer, tech-lead-sds; presenter has no agent directory. FR-37: executor renamed to developer.)
- **Supersedes:** Original layout `agents/<name>/SKILL.md` with `.claude/skills/` symlinks (superseded by FR-36).
- **Acceptance criteria:**
  - [x] Each of 7 agents has a canonical directory `.claude/skills/agent-<name>/` containing `SKILL.md` with spec-compliant YAML frontmatter (`name`, `description`, `compatibility`, `allowed-tools`; no `disable-model-invocation`). Expected: `.claude/skills/agent-pm/SKILL.md`, `.claude/skills/agent-architect/SKILL.md`, `.claude/skills/agent-tech-lead/SKILL.md`, `.claude/skills/agent-tech-lead-review/SKILL.md`, `.claude/skills/agent-developer/SKILL.md`, `.claude/skills/agent-qa/SKILL.md`, `.claude/skills/agent-meta-agent/SKILL.md`. Evidence: commits `6176e91`, `985e3e5`, `f0085df`; QA PASS runs `20260313T230627`, `20260314T000902`
  - [x] No symlinks in `.claude/skills/` pointing to `agents/`. Evidence: `agents/` directory removed; `.claude/skills/agent-*/` are real directories (commits `6176e91`, `985e3e5`)
  - [x] `agents/` top-level directory removed after migration. Evidence: commit `985e3e5 sdlc(impl): remove agents/ directory and fix stale path references`
  - [x] Pipeline engine `prompt:` fields in `pipeline.yaml` reference `.claude/skills/agent-<name>/SKILL.md`. Evidence: `.sdlc/pipeline.yaml` (commit `6176e91`)
  - [x] Each agent skill is invocable standalone via `/agent-<name>`. Evidence: Claude Code discovers skills from canonical `.claude/skills/agent-<name>/SKILL.md` location; no symlinks required
  - [x] `deno task check` passes after migration. Evidence: QA PASS — 436 tests pass (run `20260313T230627`)

### 3.20 FR-20: Pipeline Config Drift Detection

- **Description:** Automated verification that pipeline YAML configs (`pipeline.yaml`, `pipeline-task.yaml`) remain consistent with engine expectations and SRS requirements. Detects mismatches in node declarations, required fields, hook syntax, and validation rules.
- **Acceptance criteria:**
  - [ ] A `deno task check:pipeline` command validates both `pipeline.yaml` and `pipeline-task.yaml` against engine schema expectations (required node fields per type, valid validation rule types, template variable syntax).
  - [ ] Check verifies all node types used in configs are supported by the engine dispatcher (`agent`, `loop`, `merge`, `human`).
  - [ ] Check verifies `after`/`before` hook commands use valid template variables (no unresolved `{{...}}` patterns after interpolation context is known).
  - [ ] Check verifies loop nodes reference existing body nodes and condition nodes declared in the same config.
  - [ ] Check runs as part of `deno task check` (integrated into `scripts/check.ts`).
  - [ ] Failures produce actionable error messages with config file path and line context.

### 3.21 FR-21: Human-in-the-Loop (Agent-Initiated)

- **Description:** Any pipeline agent can request human input mid-task by calling the built-in `AskUserQuestion` tool. The engine detects this call (denied in `-p` mode but visible in JSON output as `permission_denials`), delegates question delivery and reply polling to external pipeline scripts, and resumes the agent session with the human's answer via `--resume`.
- **Mechanism:**
  1. Agent calls `AskUserQuestion` → Claude CLI denies it in `-p` mode (no terminal) → structured question visible in `permission_denials` field of JSON `result` event.
  2. Engine extracts question (`{question, header, options[], multiSelect}`) and `session_id`.
  3. Engine invokes configurable `ask_script` (pipeline script, not engine code) to deliver question (e.g., `gh issue comment`).
  4. Engine enters poll loop: `sleep poll_interval` → invoke `check_script` → if exit 0 (reply found), read reply from stdout.
  5. Engine resumes agent: `claude --resume <session_id> -p "<reply>"`. Agent continues with full session context.
- **Key constraint:** Engine contains zero GitHub/Slack/email-specific code. All delivery/polling logic lives in pipeline scripts (`.sdlc/scripts/`).
- **Acceptance criteria:**
  - [x] Engine detects `AskUserQuestion` in `permission_denials` of Claude CLI JSON output after agent node completes. Evidence: `engine/hitl.ts:61-93` (`detectHitlRequest()`), `engine/engine.ts:316-319` (call in `executeAgentNode`)
  - [x] Engine saves `session_id`, question JSON, and node status `waiting` to `state.json`. Evidence: `engine/state.ts:93-103` (`markNodeWaiting()`), `engine/engine.ts:324-325` (call + saveState), `engine/types.ts:104` (`question_json` field)
  - [x] Engine invokes `ask_script` (path from `pipeline.yaml` `defaults.hitl`) with args: `--run-dir`, `--artifact-source`, `--run-id`, `--node-id`, `--question-json`. Evidence: `engine/hitl.ts:111-125` (`buildScriptArgs("ask")`), `engine/hitl.ts:127-134` (ask invocation)
  - [x] Engine enters poll loop calling `check_script` with args: `--run-dir`, `--artifact-source`, `--run-id`, `--node-id`, `--exclude-login`. Exit 0 = reply in stdout; exit 1 = no reply yet. Evidence: `engine/hitl.ts:137-175` (poll loop), `engine/hitl_test.ts:184-214` (poll test)
  - [x] On reply: engine resumes agent via `claude --resume <session_id> -p "<reply>"`. Evidence: `engine/hitl.ts:158-172` (claudeRun with resumeSessionId)
  - [x] Configurable `poll_interval` (default 60s) and `timeout` (default 7200s) per pipeline. Evidence: `engine/types.ts:170-175` (`HitlConfig`), `.sdlc/pipeline.yaml:16-20` (defaults.hitl)
  - [x] On timeout: node fails, Meta-Agent triggered. Evidence: `engine/hitl.ts:183-188` (timeout return), `engine/engine.ts:342-347` (markNodeFailed on HITL failure), `engine/hitl_test.ts:216-230` (timeout test)
  - [x] `deno task run` on a pipeline with `waiting` nodes auto-resumes polling (no manual `--resume` needed). Evidence: `engine/engine.ts:278-310` (wasWaiting resume path in executeAgentNode)
  - [x] Pipeline scripts `hitl-ask.sh` and `hitl-check.sh` exist in `.sdlc/scripts/`. Evidence: `.sdlc/scripts/hitl-ask.sh`, `.sdlc/scripts/hitl-check.sh`
  - [x] `hitl-ask.sh` renders question JSON → markdown with HTML marker `<!-- hitl:<run-id>:<node-id> -->`, posts via `gh issue comment`. Evidence: `.sdlc/scripts/hitl-ask.sh:52-76` (markdown render + marker + gh post)
  - [x] `hitl-check.sh` finds first non-bot comment after marker, outputs body to stdout (exit 0) or exits 1 if no reply. Evidence: `.sdlc/scripts/hitl-check.sh:39-54` (jq filter + exit codes)

### 3.22 FR-22: Project Documentation (README)

- **Description:** README.md must accurately reflect current project state: vision, architecture (DAG-based engine), usage (`deno task run` with flags), prerequisites (Deno, Docker/devcontainer, Claude CLI, `gh`), available `deno task` commands, configuration mechanism (YAML `pipeline.yaml`), project directory structure, and agents-as-skills.
- **Scenario:** A new contributor reads README.md and gets correct, up-to-date information about how to set up, configure, and run the pipeline.
- **Acceptance criteria:**
  - [ ] README.md reflects DAG-based engine architecture (not shell script orchestration).
  - [ ] Usage section documents `deno task run` with current flags (`--prompt`, `--resume`, `--dry-run`, `-v`, `-q`, `--config`, `--skip`, `--only`, `--env`).
  - [ ] Prerequisites list: Deno, Docker/devcontainer, Claude Code CLI, `gh` CLI, Git.
  - [ ] Available `deno task` commands documented (run, check, test).
  - [ ] Configuration section references `pipeline.yaml` (not env vars).
  - [ ] Project directory structure matches actual layout (`engine/`, `.sdlc/runs/`, `.claude/skills/`).
  - [ ] Agents-as-skills mentioned with `/agent-<name>` slash command examples.
  - [ ] Installation/setup instructions are accurate for devcontainer workflow.

### 3.23 FR-23: Run Artifacts Folder Structure

- **Description:** Run artifacts under `.sdlc/runs/<run-id>/` must follow a
  hierarchical layout that groups node output directories by pipeline phase,
  separating agent output artifacts from runtime metadata (logs, state).
- **Motivation:** Current flat layout intermixes planning nodes, implementation
  loop nodes, commit nodes, and infrastructure files (`logs/`, `state.json`)
  at the same level. This hinders navigability and does not reflect the
  pipeline execution flow.
- **Layout:** Node output directories grouped into phase subdirectories
  reflecting the DAG execution flow. Runtime metadata (`state.json`, `logs/`)
  at the run root level (not inside phase groups).
- **Acceptance criteria:**
  - [ ] Node output directories are grouped by pipeline phase under
    `.sdlc/runs/<run-id>/` (e.g., `plan/`, `impl/`, `report/` or similar
    phase names derived from pipeline stages).
  - [ ] `state.json` and `logs/` remain at the run root level
    (`.sdlc/runs/<run-id>/state.json`, `.sdlc/runs/<run-id>/logs/`).
  - [ ] `{{node_dir}}` and `{{input.<node-id>}}` template variables resolve
    correctly to the new hierarchical paths.
  - [ ] Engine's state manager, log saver, and artifact validator work with
    the new directory structure.
  - [ ] Existing pipeline.yaml node definitions require minimal changes (phase
    grouping derived from config or convention, not hardcoded per-node paths).
  - [ ] All existing engine tests pass after restructuring.

### 3.24 FR-24: Loop Body Node Nesting

- **Description:** Loop nodes in `pipeline.yaml` must define their body nodes
  inline as nested objects, not reference top-level node IDs. This makes the
  parent-child relationship explicit, prevents body nodes from being executed
  outside their loop context, and aligns config structure with execution model.
- **Motivation:** Current config declares loop body nodes (`developer`, `qa`) at
  the top level alongside pipeline-level nodes. Body nodes use loop-scoped
  template variables (`{{loop.iteration}}`) but nothing in their declaration
  indicates loop scope. This creates namespace pollution, implicit coupling,
  and misconfiguration risk.
- **Config structure:** Loop node gains a `nodes` sub-object containing inline
  body node definitions. The `body` field references IDs within `nodes`.
  Example:
  ```yaml
  impl-loop:
    type: loop
    body: [developer, qa]
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    max_iterations: 3
    nodes:
      developer:
        type: agent
        prompt: ".claude/skills/agent-developer/SKILL.md"
        inputs: [architect, sds-update]
        ...
      qa:
        type: agent
        prompt: ".claude/skills/agent-qa/SKILL.md"
        inputs: [pm, architect, developer]
        ...
  ```
- **Acceptance criteria:**
  - [ ] Loop nodes define body nodes inline via `nodes` sub-object in
    `pipeline.yaml`.
  - [ ] Body node IDs in `nodes` are not registered as top-level DAG nodes.
  - [ ] Body nodes can reference external (top-level) nodes in their `inputs`.
  - [ ] Body nodes can reference sibling body nodes (within the same loop) in
    their `inputs`.
  - [ ] `{{loop.iteration}}` template variable resolves only inside loop body
    node contexts.
  - [ ] Engine config loader (`config.ts`) parses nested node definitions from
    loop nodes.
  - [ ] Engine DAG builder (`dag.ts`) excludes loop body nodes from top-level
    topological sort.
  - [ ] Engine loop executor (`loop.ts`) resolves body node configs from the
    loop node's `nodes` sub-object.
  - [ ] Template resolver handles `{{input.<node-id>}}` for both body-to-body
    and body-to-external references.
  - [ ] `pipeline.yaml` and any other pipeline configs updated to use nested
    body node definitions.
  - [ ] All existing engine tests pass after restructuring.
  - [ ] `deno task check` passes.

### 3.25 FR-25: Conditional Post-Pipeline Node Execution (`run_on`)

- **Description:** Replace the binary `run_always: boolean` flag with a
  `run_on: always | success | failure` enum on `NodeConfig`. Engine collects
  post-pipeline nodes (those with `run_on` set) and executes them after all DAG
  levels complete, filtering by pipeline outcome. This prevents committer nodes
  from creating PRs/merging when the pipeline failed, while allowing meta-agent
  to always run.
- **Motivation:** `run_always: true` causes committer nodes to run on failure,
  creating PRs with `Closes #N` that merge broken code. Prompt-level guards are
  unreliable (LLM can ignore them). Engine-level gating is required.
- **Enum semantics:**
  - `run_on: always` — execute regardless of pipeline outcome (current
    `run_always: true` behavior).
  - `run_on: success` — execute only when all regular DAG nodes passed.
  - `run_on: failure` — execute only when pipeline failed.
  - Nodes without `run_on` execute in normal DAG order (no change).
- **Backward compatibility:** `run_always: true` in config is normalized to
  `run_on: "always"` during config loading. `run_always: false` (or absent) is
  unchanged (no `run_on` set).
- **Acceptance criteria:**
  - [ ] `NodeConfig` in `types.ts` has `run_on?: "always" | "success" | "failure"` field. `run_always` deprecated.
  - [ ] `config.ts` normalizes `run_always: true` → `run_on: "always"` for backward compat.
  - [ ] Engine filters post-pipeline nodes: skips `run_on: success` nodes when pipeline failed, skips `run_on: failure` nodes when pipeline succeeded.
  - [ ] Committer nodes (`commit-present`, `commit-meta`) do NOT run when pipeline fails (configured as `run_on: success`).
  - [ ] Meta-agent runs on every outcome (`run_on: always`).
  - [ ] `pipeline.yaml` migrated from `run_always: true` to appropriate `run_on` values.
  - [x] Engine remains domain-agnostic — no git/PR/GitHub logic in engine code. Evidence: `engine/git.ts` deleted; `engine/engine.ts` uses generic `on_failure_script` hook; `engine/mod.ts` git re-exports removed.
  - [ ] All existing engine tests pass; new tests cover `run_on` filtering logic.
  - [ ] `deno task check` passes.

### 3.26 FR-26: Align Pipeline Git Workflow with Standard GitHub Practices

- **Description:** Restructure pipeline agent roles and git workflow to match
  standard GitHub development practices. Rename/merge agents to reflect
  real-world roles, eliminate artificial agents (committer, reviewer), move git
  operations (branch, commit, push, PR) to the agents that own the work, and
  use PRs (not issues) as the primary communication channel for code review.
- **Motivation:** Current pipeline diverges from standard practices: roles are
  misnamed (tech-lead does architecture, architect does tech-lead work),
  artificial roles exist (committer, reviewer), git operations are deferred to
  separate committer nodes, and QA/review communication happens in issues
  instead of PRs.
- **Target pipeline flow:**
  ```
  pm → architect → tech-lead → impl-loop(developer, qa) → tech-lead-review
                                                           ↑
                                                    meta-agent (run_always)
  ```
  5 agent invocations in happy path (was 8): pm, architect, tech-lead,
  developer, qa — plus tech-lead-review and meta-agent as post-pipeline.
- **Role changes:**
  - `tech-lead` node (current) → renamed to **`architect`** (designs solution
    with variants). Prompt: `.claude/skills/agent-architect/SKILL.md`.
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
  - Rename `.claude/skills/agent-tech-lead/` ↔ `.claude/skills/agent-architect/` (swap roles).
  - Expand `.claude/skills/agent-tech-lead/SKILL.md` (design review, SDS update, branch creation, draft PR).
  - Delete `.claude/skills/agent-tech-lead-reviewer/`, `.claude/skills/agent-tech-lead-sds/`,
    `.claude/skills/agent-committer/`.
  - Update `.claude/skills/agent-developer/SKILL.md` — add commit/push, PR comments. (FR-37: formerly `agent-executor`)
  - Update `.claude/skills/agent-qa/SKILL.md` — PR review instead of issue comments.
  - New `.claude/skills/agent-tech-lead-review/SKILL.md` — code review + CI gate + merge.
  - Update `pipeline.yaml` — new DAG with fewer nodes.
- **Invariants (no changes):**
  - `engine/` — engine remains domain-agnostic, no code changes.
  - `.claude/skills/agent-pm/` — no changes.
  - `.claude/skills/agent-meta-agent/` — no changes.
- **Acceptance criteria:**
  - [x] Agent directory `.claude/skills/agent-architect/` contains design-solution prompt. Evidence: `.claude/skills/agent-architect/SKILL.md`
  - [x] Agent directory `.claude/skills/agent-tech-lead/` contains expanded prompt: critique + variant selection + task breakdown + SDS update + branch creation + draft PR. Evidence: `.claude/skills/agent-tech-lead/SKILL.md`
  - [x] `agent-tech-lead-reviewer`, `agent-tech-lead-sds`, `agent-committer` deleted. Evidence: directories removed; `agents/` directory removed (commit `985e3e5`)
  - [x] `.claude/skills/agent-tech-lead-review/SKILL.md` created with code review + CI gate + merge logic. Evidence: `.claude/skills/agent-tech-lead-review/SKILL.md:21-24`
  - [x] `.claude/skills/agent-developer/SKILL.md` exists: commits/pushes own code, posts PR comments, "do not commit" rule removed. Evidence: commit `f0085df sdlc(impl): rename Executor agent role to Developer (FR-37)`, `.claude/skills/agent-developer/SKILL.md`
  - [x] `.claude/skills/agent-qa/SKILL.md` updated: posts PR reviews via `gh pr review` ONLY (no issue comments). Evidence: `.claude/skills/agent-qa/SKILL.md`
  - [x] `pipeline.yaml` updated: `finalize` (committer) node removed; `review` node renamed to `tech-lead-review` using `.claude/skills/agent-tech-lead-review/SKILL.md` with `run_on: always` + merge capability. Evidence: `.sdlc/pipeline.yaml:163-184`
  - [x] `.claude/skills/` canonical agent directories present (no symlinks). Evidence: commit `6176e91`, `985e3e5`
  - [x] Pipeline produces 5 agent invocations in happy path (pm, architect, tech-lead, developer, qa) plus 2 post-pipeline (tech-lead-review, meta-agent). Evidence: commit `f0085df`, `.sdlc/pipeline.yaml` (developer node in impl-loop)
  - [x] Developer creates commits on feature branch during implementation. Evidence: commit `f0085df`, `.claude/skills/agent-developer/SKILL.md`
  - [x] QA posts review on PR only (not issue comment). Evidence: `.claude/skills/agent-qa/SKILL.md`
  - [x] Tech-lead-review merges PR if CI green, or leaves open with comments. Evidence: `.claude/skills/agent-tech-lead-review/SKILL.md`
  - [x] `--prompt` mode (no GitHub issue) uses fallback branch name `sdlc/<run-id>`. Evidence: `.claude/skills/agent-tech-lead/SKILL.md`
  - [x] All existing engine tests pass (no engine code changes). Evidence: engine/ unchanged.
  - [x] `deno task check` passes after all changes. Evidence: validated post-implementation.
  - [x] SRS, SDS updated to reflect final pipeline structure. Evidence: `documents/requirements.md`, `documents/design.md`

### 3.27 FR-27: Per-Node Model Configuration

- **Description:** Add `model` field to `PipelineDefaults` and `NodeConfig` in
  pipeline config. Engine emits `--model <value>` flag when invoking Claude CLI
  for agent nodes. Node-level `model` overrides default; absent = CLI default.
  Enables cost optimization (cheap model for simple stages) and quality
  optimization (strong model for complex stages).
- **Motivation:** All nodes currently use the same model. Simple stages (PM, QA)
  don't need expensive reasoning models. Complex stages (architect, tech-lead,
  meta-agent) benefit from stronger models. Static per-node config is the
  simplest approach.
- **Config schema:**
  ```yaml
  defaults:
    model: "claude-sonnet-4-6"  # default for all nodes
  nodes:
    architect:
      model: "claude-opus-4-6"    # override for complex stages
  ```
- **Engine behavior:**
  - On fresh invocation: if `model` resolved (node-level or default), append
    `--model <value>` to Claude CLI args.
  - On `--resume`: do NOT emit `--model`. Session inherits model from original
    invocation.
  - Loop body nodes: inherit loop node's `model` unless overridden in inline
    `nodes` config.
- **Acceptance criteria:**
  - [x] `PipelineDefaults` in `types.ts` has `model?: string` field. Evidence: `engine/types.ts:21`
  - [x] `NodeConfig` in `types.ts` has `model?: string` field. Evidence: `engine/types.ts:39`
  - [x] `config.ts` parses `model` from defaults and node configs. Evidence: `engine/config.ts:26-33` (YAML pass-through via structural typing; `PipelineDefaults`/`NodeConfig` types carry `model?`)
  - [x] `agent.ts` `buildClaudeArgs()` emits `--model <value>` when model is set. Evidence: `engine/agent.ts:309-311`
  - [x] `agent.ts` does NOT emit `--model` on `--resume` invocations. Evidence: `engine/agent.ts:309` (`&& !opts.resumeSessionId` guard)
  - [x] Loop body nodes resolve model from: own config > loop node config > defaults. Evidence: `engine/loop.ts:76`
  - [x] `pipeline.yaml` updated: default model + per-node overrides for complex stages. Evidence: `.sdlc/pipeline.yaml:15` (default), `.sdlc/pipeline.yaml:65,84,147` (overrides)
  - [x] All existing engine tests pass; new tests cover model flag emission and resolution. Evidence: `engine/agent_test.ts:207-233` (3 model tests); 434 tests pass.
  - [x] `deno task check` passes. Evidence: validated — 434 passed, 0 failed.

### 3.29 FR-29: Engine-Pipeline Separation Invariant

- **Description:** The pipeline engine (`engine/`) is a domain-agnostic DAG executor. It MUST be physically separated from pipeline-specific concerns (config, agents, run artifacts) by directory structure, not only by convention. This constraint is structural and must be enforced by the project layout.
- **Rationale:** Issue #12 — collocating engine source with pipeline data under `.sdlc/` obscures boundaries, hinders tooling, and blocks future engine reuse.
- **Rules:**
  - Engine source lives in a dedicated top-level directory (e.g., `engine/` or a standardized path); no pipeline, agent, git, or GitHub-specific logic inside.
  - Pipeline config (`pipeline.yaml`), agent prompts (`.claude/skills/`), and run artifacts (`runs/`) are domain-specific — must not be nested under the engine directory.
  - `deno.json` tasks and imports reference the new layout consistently.
- **Acceptance criteria:**
  - [x] Engine source directory contains only domain-agnostic DAG executor code. Evidence: `engine/git.ts` and `engine/git_test.ts` deleted; `engine/mod.ts` git exports removed; `engine/types.ts` `HitlConfig` fields renamed to domain-neutral names (`artifact_source`, `exclude_login`).
  - [ ] No `pipeline.yaml`, agent skill files, or run artifacts reside inside the engine directory.
  - [ ] `deno task run` and `deno task test:engine` reference the new engine path.
  - [ ] `deno task check` passes after restructure.

### 3.28 FR-28: Accurate Dry-Run Output

- **Description:** `--dry-run` flag displays execution plan that mirrors actual
  engine execution order: regular levels (without `run_on` post-pipeline nodes)
  shown first, followed by a separate "Post-pipeline" section listing `run_on`
  nodes in topological order. Eliminates misleading display of post-pipeline
  nodes intermixed with regular levels.
- **Motivation:** Current dry-run path uses raw `buildLevels()` output, bypassing
  the `run_on` collection and filtering applied in normal execution. This causes
  operators to misread the execution order (e.g., `meta-agent` appears to run in
  parallel with `pm`, `commit` appears as a regular level node).
- **Acceptance criteria:**
  - [ ] `--dry-run` output excludes `run_on`-configured nodes from regular level display.
  - [ ] `--dry-run` output includes a "Post-pipeline" section listing `run_on` nodes in topological order.
  - [ ] Dry-run applies the same `collectRunOnNodes()` filtering logic as normal execution.
  - [ ] `OutputManager.dryRunPlan()` accepts and displays post-pipeline nodes separately.
  - [ ] Engine unit tests cover dry-run output with `run_on` nodes present.
  - [ ] `deno task check` passes.

### 3.30 FR-31: Prompt Path Validation at Config Load

- **Description:** Pipeline engine validates that all `prompt` file paths declared
  in `pipeline.yaml` exist on the filesystem before any node executes. Validation
  runs once at config load time, accumulates all missing paths, and throws a single
  error listing every missing file. Paths containing `{{` (template variables) are
  skipped — they cannot be resolved at load time.
- **Motivation:** Misconfigured `prompt` paths cause silent agent failures 30+ min
  into a pipeline run (incident: run `20260313T025203`). Early batch validation
  surfaces all misconfigurations in one error before any API compute is spent.
- **Acceptance criteria:**
  - [x] Config load throws an error if any non-template `prompt` path does not exist.
    Evidence: `engine/config.ts:336` (`validatePromptPaths()`).
  - [x] Error message lists all missing paths (batch, not fail-on-first).
    Evidence: `engine/config.ts:365-367` (accumulates into `missing[]`, throws once).
  - [x] Paths containing `{{` are skipped (unresolvable at load time).
    Evidence: `engine/config.ts:340` (`!node.prompt.includes("{{")`).
  - [x] Validation covers loop body node `prompt` paths (recursion into `nodes`).
    Evidence: `engine/config.ts:350-362` (nested loop over `node.nodes`).
  - [x] `validatePromptPaths()` called at end of `mergeDefaults()` on fully-resolved config.
    Evidence: `engine/config.ts:327` (call in `mergeDefaults()` before return).
  - [x] Tests: missing file, existing file, template skip, multiple missing, loop body miss.
    Evidence: `engine/config_test.ts:568-659`.
  - [x] `deno task check` passes.

### 3.31 FR-32: Aggregate Cost Data in state.json

- **Description:** Pipeline engine persists per-node cost and pipeline-level total
  cost in `state.json`, eliminating the need to read N+1 separate log files to
  build a cost summary. Per-node `cost_usd` is sourced from
  `ClaudeCliOutput.total_cost_usd`; top-level `total_cost_usd` is the sum across
  all completed nodes.
- **Motivation:** Dashboards and external tooling currently must open one log file
  per node to compute cost. A single `state.json` read is sufficient with this
  change.
- **Acceptance criteria:**
  - [x] `NodeState.cost_usd?: number` field written at node completion time.
    Evidence: `engine/types.ts` (`NodeState.cost_usd`), `engine/state.ts`
    (`markNodeCompleted()` optional `costUsd` param).
  - [x] `RunState.total_cost_usd?: number` is the sum of all `nodes[*].cost_usd`.
    Evidence: `engine/state.ts` (`updateRunCost()` / `recomputeTotalCost()`).
  - [x] Fields written alongside existing fields at node completion.
    Evidence: `engine/engine.ts` and `engine/loop.ts` — both pass
    `result.output?.total_cost_usd` to `markNodeCompleted()`.
  - [x] Loop iteration nodes also report cost.
    Evidence: `engine/loop.ts` loop body call site.
  - [x] Backward-compatible: fields are optional; existing state files without
    cost fields remain valid.
  - [x] Unit tests cover: cost present, cost absent, mixed multi-node, all-undefined.
    Evidence: `engine/state_test.ts`.

### 3.32 FR-33: Stream Log Timestamps

- **Description:** Each non-empty line written to the stream log file
  (`.sdlc/runs/<run-id>/logs/<node-id>.jsonl`) is prefixed with a wall-clock
  timestamp in `[HH:MM:SS]` format (24-hour, zero-padded). Empty lines pass
  through without prefix. Terminal output via `onOutput` callback is NOT
  prefixed — timestamps appear in persisted logs only.
- **Motivation:** Raw JSONL log files lack temporal context, making it hard to
  correlate log entries with real-world events during post-incident analysis.
- **Acceptance criteria:**
  - [x] Each non-empty line in the stream log file is prefixed with `[HH:MM:SS]`.
    Evidence: `engine/agent.ts:606-611` (`stampLines()`),
    `engine/agent_test.ts:400-407` (single-line test),
    `engine/agent_test.ts:409-424` (multi-line test).
  - [x] Timestamp reflects wall-clock time when the event was received (not batch time).
    Evidence: `engine/agent.ts:594-600` (`tsPrefix()` calls `new Date()` at call time),
    `engine/agent.ts:384,402` (`stampLines` called inside stream processing loop).
  - [x] Terminal output via `onOutput` callback is NOT prefixed with timestamps.
    Evidence: `engine/agent.ts:386,404` (`onOutput` receives raw `summary` without `stampLines`).
  - [x] Timestamp format is `[HH:MM:SS] <content>` (24-hour, zero-padded, space before content).
    Evidence: `engine/agent.ts:594-600` (format construction),
    `engine/agent_test.ts:391-398` (format regex test).
  - [x] Empty lines pass through to stream log without timestamp prefix.
    Evidence: `engine/agent.ts:609` (identity branch in `stampLines` map),
    `engine/agent_test.ts:426-442` (empty-line test).
  - [x] `deno task check` passes.

### 3.33 FR-34: Generic Pipeline Failure Hook (`on_failure_script`)

- **Description:** Engine supports a configurable `on_failure_script` field in `PipelineDefaults` (YAML: `defaults.on_failure_script`). When the pipeline fails, the engine executes the specified script via `Deno.Command`. Replaces the former hard-wired `rollbackUncommitted()` git call, which violated the domain-agnostic invariant (FR-29).
- **Rationale:** Domain-specific failure recovery (e.g., git rollback) belongs in pipeline scripts, not engine code. The engine provides a generic hook; the pipeline wires it to the appropriate script.
- **Acceptance criteria:**
  - [ ] `PipelineDefaults` in `engine/types.ts` includes `on_failure_script?: string`.
  - [ ] Engine executes `on_failure_script` via `Deno.Command` on pipeline failure (if configured).
  - [ ] Engine does NOT import or call any git functions on failure.
  - [ ] `.sdlc/pipeline.yaml` sets `on_failure_script: .sdlc/scripts/rollback.sh`.
  - [ ] If script path not found: engine logs warning and continues (no hard failure).
  - [ ] Unit test covers `on_failure_script` execution path.
  - [ ] `deno task check` passes.

### 3.34 FR-35: Dashboard Result Summary Display

- **Description:** HTML dashboard cards for pipeline nodes must display at least the first 3 lines of the agent result text. Long results must be collapsible (expand on click). Single-line results display inline without unnecessary whitespace. Prior implementation used `white-space: nowrap; text-overflow: ellipsis` truncating multi-line results to ~40 chars.
- **Acceptance criteria:**
  - [x] `renderCard()` in `scripts/generate-dashboard.ts` uses `<details>/<summary>` for multi-line results (>1 line): first 3 lines in `<summary>`, full text in `<details>` body. Evidence: `scripts/generate-dashboard.ts:73-77`
  - [x] Single-line results render as `<p class="result">` without `<details>` wrapper. Evidence: `scripts/generate-dashboard.ts:72`
  - [x] No `white-space: nowrap; text-overflow: ellipsis` CSS for result text. Evidence: `scripts/generate-dashboard.ts:189` (`white-space:pre-wrap`)
  - [x] `escHtml()` applied to all result content to prevent XSS. Evidence: `scripts/generate-dashboard.ts:74-75`
  - [x] Unit tests cover: multi-line result (details/summary structure), single-line result (p tag), empty result, HTML special chars in result. Evidence: `scripts/generate-dashboard_test.ts:100-170`
  - [x] `deno task check` passes. Evidence: confirmed by CI run on branch `sdlc/issue-47`

### 3.35 FR-36: Agentskills.io-Compliant Skill Layout

- **Description:** All pipeline agent skills must conform to the [agentskills.io specification](https://agentskills.io/specification). Canonical skill directories live in `.claude/skills/agent-<name>/`. Associated stage scripts co-located under `scripts/` subdirectory of each skill. Frontmatter uses only spec-defined fields.
- **Motivation:** Spec compliance enables standard skill tooling and discovery. Co-location reduces cognitive overhead. Removing the `agents/` → `.claude/skills/` symlink indirection eliminates broken-symlink failure mode.
- **Acceptance criteria:**
  - [x] Each skill directory `.claude/skills/agent-<name>/` contains `SKILL.md` with frontmatter fields: `name` (matches directory name), `description`, `compatibility`, `allowed-tools`. No `disable-model-invocation` field. Expected: `.claude/skills/agent-pm/SKILL.md`, `.claude/skills/agent-architect/SKILL.md`, `.claude/skills/agent-tech-lead/SKILL.md`, `.claude/skills/agent-tech-lead-review/SKILL.md`, `.claude/skills/agent-developer/SKILL.md`, `.claude/skills/agent-qa/SKILL.md`, `.claude/skills/agent-meta-agent/SKILL.md`. Evidence: commit `f0085df sdlc(impl): rename Executor agent role to Developer (FR-37)`; QA PASS run `20260314T000902` (436 tests)
  - [x] Stage scripts formally deprecated (superseded by engine); co-location N/A for deprecated scripts. Evidence: deprecation headers added to all `.sdlc/scripts/stage-*.sh`; `AGENT_PROMPT` paths updated to `.claude/skills/agent-<name>/SKILL.md` (this commit).
  - [x] `hitl-ask.sh`, `hitl-check.sh`, `lib.sh`, and shared utilities remain in `.sdlc/scripts/` (engine infrastructure, not agent skills). Evidence: `.sdlc/scripts/hitl-ask.sh`, `.sdlc/scripts/hitl-check.sh`, `.sdlc/scripts/lib.sh`
  - [x] `agents/` top-level directory removed; no broken symlinks in `.claude/skills/`. Evidence: commit `985e3e5 sdlc(impl): remove agents/ directory and fix stale path references`
  - [x] `pipeline.yaml` `prompt:` fields updated to `.claude/skills/agent-<name>/SKILL.md`. Evidence: `.sdlc/pipeline.yaml` (commit `6176e91`)
  - [x] `documents/requirements.md` path references updated to reflect new `.claude/skills/` layout and FR-37 rename. Evidence: this update (run `20260314T010515`); commit `f0085df`
  - [x] `deno task check` passes after migration. Evidence: QA PASS — 436 tests pass (run `20260313T230627`)

### 3.36 FR-37: Rename Executor Agent to Developer

- **Description:** Rename the `executor` agent to `developer` across all project files. The executor agent's actual role — writing code, committing, pushing, posting PR comments — matches the industry term "developer", not the generic "executor". All other pipeline agents use role-based names; this rename completes the alignment.
- **Scope:** Pure rename — no behavioral changes. Affected artifacts: agent skill directory, pipeline config node IDs, all SKILL.md cross-references, legacy shell scripts, engine test fixtures, and documentation.
- **Acceptance criteria:**
  - [x] `.claude/skills/agent-executor/` directory renamed to `.claude/skills/agent-developer/`. `SKILL.md` frontmatter `name` field updated to `agent-developer`. Evidence: commit `f0085df sdlc(impl): rename Executor agent role to Developer (FR-37)`
  - [x] `.sdlc/pipeline.yaml`: loop body node id `executor` → `developer`; all `{{input.executor}}` → `{{input.developer}}` template references updated. Evidence: commit `f0085df`
  - [x] All agent `SKILL.md` files: `{{input.executor}}` → `{{input.developer}}` in cross-agent references. Evidence: commit `f0085df`
  - [x] Legacy scripts renamed: `stage-6-executor.sh` → `stage-6-developer.sh`; internal refs and `AGENT_PROMPT` path updated. `stage-7-qa.sh` executor output references updated. Evidence: commit `f0085df`
  - [x] Engine test fixtures: node IDs using `executor` as example updated to `developer`. Evidence: commit `f0085df`
  - [x] Documentation updated: `documents/requirements.md`, `documents/design.md`, `AGENTS.md` (if applicable), `README.md`, `documents/meta.md`. Evidence: commit `f0085df`; QA PASS run `20260314T000902` (436 tests)
  - [x] `deno task check` passes after all changes. Evidence: QA PASS run `20260314T000902` — 436 tests pass

---

## 4. Non-functional requirements

- **Isolation:** Each agent runs in its own Claude Code process with no shared state except file artifacts. Single local execution assumed (one pipeline at a time). Concurrent execution is not supported.
- **Reproducibility:** Agent prompts are versioned in the repository under `.claude/skills/`.
- **Observability:** Full logs stored per stage in `.sdlc/runs/<run-id>/logs/`. Total pipeline duration reported in the final PR description.
- **Fault tolerance:** If a stage fails (agent error, timeout, continuation limit exhausted), the pipeline stops, Meta-Agent runs to analyze the failure. Manual restart via `--resume <run-id>`.
- **Timeouts:** Each stage has a configurable timeout via `SDLC_STAGE_TIMEOUT_MINUTES` env var (default: 30 min). Engine enforces timeout per node. When a timeout fires, the stage is treated as failed — Meta-Agent is triggered for analysis.
- **Security:** Enforced at the engine/stage script level via diff-based checks (see FR-8). Agents run with the local user's permissions.

## 5. Interfaces

- **Trigger:** Single entry point `deno task run [--prompt "..."]`. PM agent autonomously selects and triages open GitHub issues. `--prompt` passes optional additional context to PM. Common engine flags: `--resume`, `--dry-run`, `-v`, `-q`, `--config`.
- **Agent runtime:** `claude` CLI invoked by the Deno engine. Prompt content cached at config load time and passed inline via `--append-system-prompt`; fallback to `--append-system-prompt-file` for template paths. Key flags:
  - `--append-system-prompt` — adds role-specific instructions inline (content cached from `.claude/skills/agent-<name>/SKILL.md` at startup). Preserves Claude Code's built-in capabilities. Fallback: `--append-system-prompt-file` for template-path prompts.
  - `--output-format json` — returns structured JSON with `result`, `session_id`, `total_cost_usd`, `duration_ms`, `num_turns`, `is_error`.
  - `--resume <session-id>` — re-invokes agent in the same session for continuations (FR-8).
  - `-p "<prompt>"` — non-interactive mode, task description is passed as the prompt argument.
- **Pipeline engine:** Deno/TypeScript engine (`engine/`) reads DAG config from `.sdlc/pipeline.yaml`, resolves node dependencies, executes nodes in topological order, manages state in `.sdlc/runs/<run-id>/state.json`.
- **Legacy stage scripts:** `.sdlc/scripts/stage-<N>-<role>.sh` — handle invocation, validation, continuation, artifact commit. Superseded by engine but preserved.
- **Inter-stage communication:** Engine: artifacts in `.sdlc/runs/<run-id>/<node-id>/`, linked via templates. Legacy: `.sdlc/pipeline/<issue-number>/`. Filesystem is source of truth.
- **Branching & commits:** All work on branch `agent/<run-id>`. Commits at dedicated committer agent nodes (not per-stage). Commit format: `sdlc(<phase>): <summary>`. Failed stages produce no commits.

## 6. Acceptance criteria

The system is considered accepted if:

1. Running `deno task run` triggers the full pipeline; PM autonomously selects the highest-priority open GitHub issue.
2. Each stage produces its expected artifact with all required sections.
3. The Continuation mechanism catches and fixes `deno task check` failures without human intervention.
4. The Developer+QA loop iterates until quality checks pass.
5. The Presenter creates a comprehensive PR with a human-readable summary.
6. All agent logs are preserved and accessible.
7. The Meta-Agent runs after every pipeline execution and produces actionable analysis.
8. Re-running the pipeline on the same issue cleanly overwrites artifacts.

## Appendix A: Pipeline Stage Map

| Stage | Role             | Artifact                                | Key Validation                               |
| ----- | ---------------- | --------------------------------------- | -------------------------------------------- |
| 1     | Project Manager  | `01-spec.md` + updated SRS              | Has all 4 sections, no SDS details           |
| 2     | Architect        | `02-plan.md`                            | 2-3 variants with concrete file refs         |
| 3     | Tech Lead        | `04-decision.md` + SDS + branch + PR    | Variant selected, SDS updated, PR opened     |
| 4-5   | Developer + QA   | Code + commits + `05-qa-report-N.md`    | `deno task check` passes, PR reviews posted  |
| 6*    | Tech Lead Review | PR review + merge                       | CI green, code review passed                 |
| 7*    | Meta-Agent       | `07-changelog.md` + prompt fixes        | Evidence-based suggestions with prompt diffs |

\* Post-pipeline nodes. Tech Lead Review and Meta-Agent run as `run_on: always`.

## Appendix B: File Structure

```
.claude/skills/                          # Canonical agent skills (agentskills.io-compliant, FR-36)
  agent-pm/SKILL.md                      # PM: issue triage + spec
  agent-architect/SKILL.md               # Architect: design-solution plan with variants
  agent-tech-lead/SKILL.md               # Tech Lead: critique + decision + SDS + branch + PR
  agent-tech-lead-review/SKILL.md        # Final code review + CI gate + merge (post-pipeline)
  agent-developer/SKILL.md               # Implementation + commits + push (FR-37: formerly agent-executor)
  agent-qa/SKILL.md                      # QA via PR reviews
  agent-meta-agent/SKILL.md              # Prompt optimization + failure analysis (post-pipeline)
  flow-*/SKILL.md                        # Utility skills (unaffected)
.sdlc/
  scripts/                             # Stage orchestration & HITL scripts (engine infrastructure)
    lib.sh                             # Shared functions (logging, continuation loop, git ops)
    hitl-ask.sh                        # HITL question delivery via GitHub issue
    hitl-check.sh                      # HITL reply polling via GitHub issue
    stage-*.sh                         # Legacy stage scripts (preserved; co-location deferred FR-36)
engine/                                # Deno/TypeScript pipeline engine
    cli.ts                             # Entry point: deno task run
    engine.ts                          # DAG executor
    ...
  runs/
    <run-id>/                          # Per-run artifacts (engine path)
      <phase>/<node-id>/               # Phase-grouped node output
      logs/
        <node-id>.json               # CLI JSON output (metadata)
        <node-id>.jsonl              # Full session transcript
      state.json                     # Run state (node statuses, session IDs)
  pipeline.yaml                        # DAG-based pipeline configuration
```

- возможность продолжить работу после остановки по какой-то причине. С указанием шага, с которого продолжаем
- проверки незакомиченности должны проверять конкретные папки, а не все

