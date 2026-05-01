<!-- section file — index: [documents/requirements-sdlc.md](../requirements-sdlc.md) -->

# SRS SDLC — Workflow Stages (S1–S9)


### 3.1 FR-S1: Workflow Trigger

- **Description:** Single entry point `deno task run [--prompt "..."]`. PM agent autonomously triages open GitHub issues — selects highest-priority open issue, fetches its title and body, and writes `issue: <N>` in `01-spec.md` YAML frontmatter. `--prompt` provides optional additional context passed to the PM agent.
- **Acceptance criteria:**
  - [x] `deno task run` starts workflow; PM selects highest-priority open issue autonomously. Evidence: `cli.ts:36-76` (CLI argument parsing + workflow entry point), `.flowai-workflow/agents/agent-pm/SKILL.md` (PM triage logic via `gh issue list`)
  - [x] `deno task run --prompt "..."` passes additional context string to PM agent. Evidence: `cli.ts:40-42` (`--prompt` arg parsed into `cliArgs.prompt`)
  - [x] PM writes `issue: <N>` in `01-spec.md` YAML frontmatter after issue selection. Evidence: `.flowai-workflow/agents/agent-pm/SKILL.md` (Output Format section mandates YAML frontmatter with `issue: N`)
  - [x] Common engine flags (`--resume`, `--dry-run`, `-v`, `-q`, `--config`) work with the single entry point. Evidence: `cli.ts:36-76` (`--resume` :43-45, `--dry-run` :47-49, `-v` :50-53, `-q` :58-61, `--config` :37-39)



### 3.2 FR-S2: Stage 1 — Project Manager (Specification)

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



### 3.3 FR-S3: Stage 2 — Architect (Design-Solution Plan)

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



### 3.4 FR-S4: Plan Critique & Revision (absorbed into Tech Lead, FR-S15)

- **Description:** Plan critique and revision functionality is now absorbed into the Tech Lead agent (FR-S5). The Tech Lead critiques the Architect's plan, selects a variant, and produces the task breakdown — all in one stage. Separate reviewer agent eliminated (FR-S15).
- **Previous input/output:** `02-plan.md` → `03-revised-plan.md` (no longer produced as separate artifact).
- **Acceptance criteria:**
  - Critique is embedded in Tech Lead's `03-decision.md` body (at least one issue per variant).
  - No separate reviewer node in `workflow.yaml`.



### 3.5 FR-S5: Stage 3 — Tech Lead (Decision + Branch + PR)

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



### 3.6 FR-S6: SDS Update (absorbed into Tech Lead, FR-S15)

- **Description:** SDS update functionality is now absorbed into the Tech Lead agent (FR-S5). The Tech Lead updates `documents/design-sdlc.md` as part of its decision-making stage. Separate sds-update agent eliminated (FR-S15).
- **Previous input/output:** `03-decision.md` → updated `documents/design-sdlc.md` (now done by Tech Lead).
- **Acceptance criteria:**
  - Tech Lead updates `documents/design-sdlc.md` with selected variant's design details.
  - No separate sds-update node in `workflow.yaml`.



### 3.7 FR-S7: Stage 6-7 — Developer + QA (Iterative Implementation Loop)

- **Description:** The Developer and QA agents work as an iterative pair. Developer implements, QA verifies. If QA finds issues, Developer fixes them. The loop continues until QA passes or the iteration limit is reached.
- **Orchestration:** The loop is managed by the engine's `loop` node type (`loop.ts`). It invokes the Developer agent, then QA agent. Based on the QA verdict, it either exits the loop (on `PASS`) or re-invokes the Developer with the QA report (on `FAIL`). Legacy: `stage-6-developer.sh` calls `stage-7-qa.sh` as sub-step.
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
  - **Loop config structure:** inline-only body nodes, intra/external
    input refs, `{{loop.iteration}}` scoping — locked by engine
    FR-E10 (`dag_test.ts`, `config_test.ts`, `loop_test.ts`,
    `template_test.ts`).
  - **Loop constraints:**
    - Maximum iterations: configurable (default 3).
    - If limit reached without `PASS`: workflow stops and reports failure on the issue. Meta-Agent is triggered (see FR-S8).
- **Quality metrics:**
  - `deno task check` passes on every Developer commit (enforced by stage script, see engine SRS FR-E1).
  - QA report covers 100% of acceptance criteria from `01-spec.md`.
  - Each QA issue has: description, affected file, severity (blocking/non-blocking).
  - `qa.md` prompt MUST include a concrete YAML frontmatter example to ensure LLM compliance.



### 3.8 FR-S8: Stage 8 — Presenter (Change Summary) — ABSORBED

- **Status:** Absorbed into Tech Lead (FR-S5) and Tech Lead Review (FR-S15).
  Tech Lead creates draft PR with summary; Tech Lead Review performs final
  review + merge. No separate Presenter agent.
- **Previous description:** Presenter agent created human-readable change
  summary for PR description. Functionality now covered by:
  - Tech Lead: draft PR creation with implementation plan summary.
  - Developer: PR comments with implementation progress (FR-S7).
  - Tech Lead Review: final review, CI gate, merge decision.



### 3.9 FR-S9: Meta-Agent (Prompt Optimization)

- **Description:** A dedicated agent that runs after every workflow execution (both success and failure). It analyzes the logs of the current run, identifies errors, friction points, and inefficiencies, and produces actionable prompt improvement suggestions.
- **Trigger conditions:**
  - **On workflow success:** runs as the final stage after Presenter (Stage 9).
  - **On workflow failure:** runs automatically when any stage fails after exhausting its continuation limit.
- **Trigger mechanism:** Engine executes meta-agent node as a post-workflow node. In `workflow.yaml`, the meta-agent node is configured with `run_on: always` (engine SRS FR-E11) to run regardless of upstream success/failure. Failed node ID identified via `state.json` (nodes with `status: "failed"`). Engine does NOT write a separate `failed-node.txt` — that violates engine SRS FR-E14.
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
  - [ ] `.flowai-workflow/agents/agent-meta-agent/SKILL.md` Input section references `state.json` for failed-node context; no `failed-node.txt` reference (engine SRS FR-E14 compliance).
- **Quality metrics:**
  - Every fix references specific log data as evidence.
  - Fixes are minimal, targeted, and testable in next run.


