<!-- section file — index: [documents/requirements-sdlc.md](../requirements-sdlc.md) -->

# SRS SDLC — Housekeeping, Tooling, and Cleanup


### 3.18 FR-S18: Rename Executor Agent to Developer

- **Description:** Rename the `executor` agent to `developer` across all project files. The executor agent's actual role — writing code, committing, pushing, posting PR comments — matches the industry term "developer", not the generic "executor". All other workflow agents use role-based names; this rename completes the alignment.
- **Scope:** Pure rename — no behavioral changes. Affected artifacts: agent skill directory, workflow config node IDs, all SKILL.md cross-references, legacy shell scripts, engine test fixtures, and documentation.
- **Acceptance criteria:**
  - [x] `.flowai-workflow/agents/agent-executor/` directory renamed to `.flowai-workflow/agents/agent-developer/`. `SKILL.md` frontmatter `name` field updated to `agent-developer`. Evidence: commit `f0085df sdlc(impl): rename Executor agent role to Developer (FR-S18)`
  - [x] `.flowai-workflow/workflow.yaml`: loop body node id `executor` → `developer`; all `{{input.executor}}` → `{{input.developer}}` template references updated. Evidence: commit `f0085df`
  - [x] All agent `SKILL.md` files: `{{input.executor}}` → `{{input.developer}}` in cross-agent references. Evidence: commit `f0085df`
  - [x] Legacy scripts renamed: `stage-6-executor.sh` → `stage-6-developer.sh`; internal refs and `AGENT_PROMPT` path updated. `stage-7-qa.sh` executor output references updated. Evidence: commit `f0085df`
  - [x] Engine test fixtures: node IDs using `executor` as example updated to `developer`. Evidence: commit `f0085df`
  - [x] Documentation updated: `documents/requirements-sdlc.md`, `documents/design-sdlc.md`, `AGENTS.md` (if applicable), `README.md`, `documents/meta.md`. Evidence: commit `f0085df`; QA PASS run `20260314T000902` (436 tests)
  - [x] `deno task check` passes after all changes. Evidence: QA PASS run `20260314T000902` — 436 tests pass



### 3.27 FR-S27: CLI Help for SDLC Utility Scripts

- **Description:** SDLC utility scripts that accept CLI arguments must respond to `--help` / `-h` with a usage synopsis and exit 0. Unknown flags must produce an error message referencing `--help` and exit non-zero. Output format follows the pattern in `cli.ts`. Applies to: `scripts/self-runner.ts`, `scripts/generate-dashboard.ts`.
- **Motivation:** Users must read source code to discover available options for SDLC utility scripts. No help text forces unnecessary source inspection and increases risk of misuse.
- **Acceptance criteria:**
  - [x] `scripts/self-runner.ts`: `--help` / `-h` prints usage and exits 0.
  - [x] `scripts/generate-dashboard.ts`: `--help` / `-h` prints usage and
    exits 0.
  - [x] Both scripts: unknown flags produce error message referencing
    `--help` and exit non-zero.
  - [x] Output format follows `cli.ts` pattern.
  - [x] `deno task check` passes.



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



### 3.33 FR-S33: Remove Stale Agent Symlinks from .claude/skills/

- **Description:** Remove 6 legacy `agent-*` symlinks from `.claude/skills/` (pointing to `.flowai-workflow/agents/agent-*/`), remove obsolete symlink validation from `scripts/check.ts`, and update documentation. Symlinks were legacy from pre-FR-S26 layout; since FR-S17, agent prompts are discovered directly from `.flowai-workflow/agents/agent-<name>/SKILL.md`. Keeping symlinks caused Claude Code to expose workflow-only agents as interactive skills — undesirable.
- **Supersedes:** `.claude/skills/ agent-*/` symlink pattern (from FR-S17 migration; now fully removed).
- **Acceptance criteria:**
  - [x] 6 `agent-*` symlinks deleted from `.claude/skills/` (`agent-pm`, `agent-architect`, `agent-tech-lead`, `agent-tech-lead-review`, `agent-developer`, `agent-qa`). Evidence: `git diff main...HEAD --name-only` shows `deleted file mode 120000` for all 6; `ls .claude/skills/` confirms no `agent-*` entries.
  - [x] `scripts/check.ts` symlink validation block removed. Evidence: `scripts/check.ts` `workflowIntegrity()` (lines 89–102) retains only `loadConfig()` delegation; no symlink loop remains.
  - [x] `documents/design-sdlc.md` updated: §2.2 Agent Runtime symlink clause removed, §3.4 Purpose/Interfaces/Migration updated with FR-S33 reference. Evidence: `documents/design-sdlc.md §2.2`, `§3.4`.
  - [x] `documents/requirements-sdlc.md` updated: this section (3.33) added; Section 4 NFR Reproducibility updated; Appendix B symlink lines removed; Appendix C FR-S33 row added.
  - [x] `deno task check` passes. Evidence: `deno task check` PASS (493 tests, run `20260319T192055`).



### 3.39 FR-S39: Remove Redundant Read-Rules Bootstrap from Agent Prompts

- **Description:** Shared rules are inlined into each of the 6 agent prompt
  files (`.flowai-workflow/github-inbox/agents/agent-<name>.md`) per FR-S38;
  there is no separate `shared-rules.md`. The "BEFORE YOU DO ANYTHING" block
  that instructed agents to read a shared rules file is therefore redundant —
  the rules are already part of the loaded system prompt. FR-S39 removed this
  bootstrap block from every agent prompt file, eliminating one wasted turn
  and unnecessary token cost per workflow run.
- **Rationale (no shared-rules.md):** The bootstrap block originally pointed
  at a `shared-rules.md` file that was never adopted; rules were inlined
  per-agent instead (see FR-S38 rationale). Documentation referencing a
  separate file was therefore stale even at the time of removal.
- **Dep:** FR-S38 (per-agent inlining of shared rules).
- **Acceptance criteria:**
  - [x] "BEFORE YOU DO ANYTHING" heading + read-rules instruction removed from
    all 6 agent prompt files (`agent-pm`, `agent-architect`, `agent-tech-lead`,
    `agent-developer`, `agent-qa`, `agent-tech-lead-review`). Evidence:
    `grep -rn "BEFORE YOU DO ANYTHING" .flowai-workflow/github-inbox/agents/`
    returns zero matches.
  - [x] No agent prompt file references `shared-rules.md` (any cross-reference
    such as "per shared-rules.md §..." removed or rewritten in-place).
    Evidence: `grep -rn "shared-rules" .flowai-workflow/github-inbox/` returns
    zero matches.
  - [x] YAML frontmatter unchanged in each agent prompt file.
  - [x] `deno task check` passes.



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
  - [x] `Agent` tool explicitly allowed in `## Codebase Exploration`,
    overriding the agent prompt's default tool prohibition. Evidence:
    `.flowai-workflow/agents/agent-architect/SKILL.md`.
  - [x] Architect Responsibility #3 updated to incorporate exploration findings
    as `file:line` references. Evidence: `.flowai-workflow/agents/agent-architect/SKILL.md`.


