<!-- section file — index: [documents/design-sdlc.md](../design-sdlc.md) -->

# SDS SDLC — Project Init Scaffolder, Data, Logic, Non-Functional, Constraints, Evidence


### 3.12 Project Init Scaffolder (`flowai-init/`, FR-S46)

- **Purpose:** Scaffold a self-contained `.flowai-workflow/` directory in a
  target project. Pure deterministic file copy with placeholder substitution
  — no AI calls, no network. Invoked via `flowai-workflow init`. Dispatched
  from `engine/cli.ts` via dynamic import to preserve engine purity
  (FR-E14 / engine MUST NOT contain domain-specific code).
- **Package:** `@korchasa/flowai-workflow-init`. Separate workspace member
  under `flowai-init/` with its own `deno.json`, `scripts/check.ts`, and JSR
  publish config. Templates and scaffold logic ship together as one JSR
  artifact.
- **Module layout:**
  - `mod.ts` — public entry `runInit(argv, opts)`, flag parser
    (`parseInitArgs`), help text, and orchestration of all phases.
  - `types.ts` — `Answers`, `TemplateManifest`, `TemplateQuestion`,
    `CopyRule`, `TemplateRequirement`, `DetectKey` interfaces.
  - `scaffold.ts` — `substitutePlaceholders` (regex `/__[A-Z][A-Z0-9_]*__/g`,
    throws on unknown key), `copyTemplate` (tracked writes for unwind),
    `unwindScaffold` (reverse-order delete of tracked paths),
    `writeTemplateMetadata` (`.template.json`).
  - `autodetect.ts` — per-language handlers exposed as `detectFns` record:
    `project_name`, `default_branch`, `test_cmd`, `lint_cmd`. Handlers
    inspect `deno.json`, `package.json`, `go.mod`, `pyproject.toml`,
    `Cargo.toml` in priority order + read-only git plumbing
    (`git symbolic-ref`, `git remote get-url`). Never execute build tools.
  - `preflight.ts` — environment checks: `git rev-parse
    --is-inside-work-tree`, origin remote host validation via
    `parseGithubRemote` (supports HTTPS, SCP-SSH, URL-SSH forms),
    `.flowai-workflow/` absence, clean-tree check (skippable with
    `--allow-dirty`). All failures collected into a single summary.
    Rationale: binary-presence checks removed — git commands themselves
    surface missing-binary errors naturally; `claude` is a workflow-runtime
    dep not needed at `init` time, so pre-validating it just broke CI.
  - `manifest.ts` — YAML parser + structural validator for `template.yaml`
    with path-aware error messages (e.g. `questions[2].detect: unknown
    handler`).
  - `wizard.ts` — dual-mode resolution: non-interactive (`--answers
    <file.yaml>`) reads and validates answer YAML, interactive mode uses
    stdin prompts with autodetected defaults pre-filled. Pure helpers
    (`parseAnswersYaml`, `mergeAnswers`, `resolveFinalAnswers`) are
    factored out for unit-testing; `runWizard` is the only function that
    touches stdin.
- **Template layout (`flowai-init/templates/sdlc-claude/`):**
  - `template.yaml` — manifest (wizard questions, requirements, file copy
    rules).
  - `README.md` — placeholder list, usage notes, hard dependencies.
  - `files/.flowai-workflow/` — full self-contained workflow tree:
    - `workflow.yaml` — generic 6-agent SDLC DAG with `__PROJECT_NAME__`,
      `__DEFAULT_BRANCH__`, `__TEST_CMD__`, `__LINT_CMD__` placeholders.
      Agent prompts referenced via `{{file(".flowai-workflow/agents/
      agent-*.md")}}` (NOT `.claude/agents/`).
    - `agents/agent-{pm,architect,tech-lead,developer,qa,tech-lead-review}.md`
      — framework-independent role definitions with no `FR-E/FR-S`,
      `scope: engine|sdlc`, or flowai-workflow-specific references.
    - `memory/agent-*.md` + `agent-*-history.md` — empty stubs with a
      single header line; agents rewrite them via the reflection protocol
      on first run.
    - `memory/reflection-protocol.md` — generic two-layer memory protocol.
    - `scripts/hitl-ask.sh`, `hitl-check.sh` — GitHub HITL scripts (auto-
      detect repo via `gh`, no project-specific hardcoding).
    - `.gitignore` — single line `runs/`, scoped so git reads it at the
      `.flowai-workflow/` level without touching the project root
      `.gitignore` (self-containment invariant).
    - `tasks/.gitkeep` — placeholder for `.flowai-workflow/tasks/`.
- **Engine dispatch:** `engine/cli.ts` adds an early branch inside its
  `if (import.meta.main)` block: when `Deno.args[0] === "init"`, it
  dynamically `import("@korchasa/flowai-workflow-init")` and delegates
  with `{ engineVersion: VERSION }`. Dynamic import keeps the init code
  and bundled templates out of the engine module graph when a user runs
  any other subcommand.
- **Wizard flow:**
  1. Preflight — collect all failures up-front (single pass).
  2. Load manifest from `./templates/<name>/template.yaml` relative to the
     package's `import.meta.url` (works in local/JSR/compiled modes).
  3. Autodetect — aggregate handler results into `Partial<Answers>`.
  4. Resolve answers — merge detected + file + question defaults, validate
     required fields.
  5. Interactive mode only: prompt user per question with detected default,
     confirm before scaffold.
  6. Dry-run short-circuit prints file list and exits 0.
  7. Scaffold — walk `files.copy` rules, substitute placeholders, write
     files with tracked paths.
  8. Write `.template.json` metadata (template name/version, engine
     version, ISO 8601 timestamp, answers).
  9. Print success message with next-steps (`flowai-workflow --config
     .flowai-workflow/workflow.yaml`).
- **Error handling:**
  - Preflight failure → print bullet list + exit 1.
  - Wizard abort or missing required field → print error + exit 1.
  - Scaffold mid-flight failure → `unwindScaffold(createdPaths)` deletes
    only files the scaffolder touched (never walks directory trees),
    then exit 1.
  - Flag parse error → exit 3.
- **Exit codes:** 0 (success / help / dry-run), 1 (preflight / scaffold
  failure), 3 (invalid CLI argument).
- **Root check delegation:** `scripts/check.ts` delegates to
  `flowai-init/scripts/check.ts` via `deno task check` with `cwd=flowai-init`.
  Each workspace member owns its own fmt/lint/type-check/tests/doc-lint/
  publish-dry-run pipeline. (The pre-split `ai-ide-cli` member followed
  the same pattern before being extracted to a sibling repo.)
- **Deps:** `@std/yaml` (manifest parser), `@std/path`. Engine module
  dispatcher imports `@korchasa/flowai-workflow-init` via workspace package
  name (no static coupling — dynamic `await import()` lazy-loads only on
  `init` subcommand).

## 4. Data

### 4.1 Commit Strategy

- **Branch:** Feature branch created by tech-lead agent (`git checkout -b
  sdlc/issue-<N>`). If branch already exists, tech-lead rebases onto
  `origin/main` (`git rebase origin/main`) with manual conflict resolution
  (up to 2 attempts; abort on failure). Fallback for `--prompt` mode:
  `sdlc/{{run_id}}`.
- **Commit cadence (FR-S15):** Developer-owned commits. No dedicated committer
  agent nodes. Developer runs `git add`, `git commit`, `git push` after each
  task. Commit messages follow `sdlc(impl): <summary>` format.
- **PR creation:** Tech-lead creates draft PR (`gh pr create --draft`) before
  impl-loop. Developer pushes to same branch. QA posts PR review verdicts.
- **Post-workflow:** Tech-lead-review performs final review + CI gate + merge.
- **Engine invariant:** Engine does NOT auto-commit (FR-S11 preserved). All git
  operations happen inside agent prompts.
- **Failure behavior:** Failed nodes produce no commits. On_error: "fail" stops
  workflow; "continue" proceeds to next nodes. Each failed `NodeState` gets
  `error_category?: ErrorCategory` — domain-agnostic enum:
  `continuations_exhausted | timeout | cli_crash | hook_failure | hitl_timeout |
  aborted | unknown`. Set by engine at failure point; downstream agents map
  categories to domain actions.
- **Resume:** `--resume <run-id>` skips completed nodes per state.json.

## 5. Logic

- **Developer+QA Loop**: Developer implements -> QA verifies -> if FAIL:
  Developer reads QA report, fixes -> repeat (max 3). Body nodes defined
  inline via loop's `nodes` sub-object (not top-level). Execution order
  determined by topo-sort of body nodes' `inputs` declarations.
  **Verify node verdict validation (FR-S37):** `verify` node's `validate`
  block MUST include `frontmatter_field` rule for `verdict` field with
  `allowed: ["PASS", "FAIL"]`. Ensures QA agent cannot silently omit the
  verdict frontmatter — validation fails before loop reads `condition_field`.
  Combined with engine FR-E36 parse-time cross-check, guarantees
  `condition_field: verdict` is contractually declared in the condition node.
- **~~Pre-Run Auto-Stash (FR-S41)~~:** Superseded by engine FR-E24 (worktree
  isolation). Engine creates a git worktree per run — original working tree
  untouched. `pre_run` field removed; `reset-to-main.sh` no longer invoked.
- **Secret Detection**: `gitleaks detect --no-git` runs as part of
  `deno task check` (`scripts/check.ts`). `allowFailure=true` — skips if
  gitleaks binary not found. Engine-level `safetyCheckDiff()` removed.
- **Tech-Lead-Review Node**: Post-workflow agent (`run_on: always`). Performs
  final code review, checks CI gates, merges PR if all pass. Handles
  missing-PR case gracefully (no-op with clear message when workflow failed
  before tech-lead created PR). **After-hook observability (FR-S36):**
  `after:` field invokes `.flowai-workflow/scripts/run-dashboard.sh {{run_dir}}`
  (replaces `deno task dashboard ... || true`). Wrapper runs dashboard
  command, emits `[WARN] dashboard generation failed (exit $code)` to stderr
  on non-zero exit, always exits 0. Warning captured in `stream.log`, visible
  via inline log viewer (FR-S34). Node status remains "completed" — no false
  failure signal.
- **HITL via AskUserQuestion Interception** (FR-E8):
  Engine detects agent HITL requests by inspecting `permission_denials` in
  Claude CLI JSON output. Flow:
  1. Agent node completes → engine parses JSON `result` event.
  2. If `permission_denials[]` contains entry with
     `tool_name == "AskUserQuestion"`: extract `tool_input.questions` (structured
     question with `question`, `header`, `options[]`, `multiSelect`) and
     `session_id` from result.
  3. Engine calls `defaults.hitl.ask_script` (external workflow script) with
     question JSON + context args (repo, issue, run-id, node-id).
  4. Engine sets node state to `waiting` in `state.json`, saves `session_id`.
  5. Engine enters poll loop: `sleep(poll_interval)` → call
     `defaults.hitl.check_script` → if exit 0, read reply from stdout.
  6. Engine resumes agent: `claude --resume <session_id> -p "<reply>"
     --output-format json`. Agent sees full previous context + reply as new
     user message.
  7. On `timeout` exceeded: node marked `failed`.
  Workflow config:
  ```yaml
  defaults:
    on_failure_script: .flowai-workflow/scripts/rollback-uncommitted.sh
    hitl:
      ask_script: .flowai-workflow/scripts/hitl-ask.sh
      check_script: .flowai-workflow/scripts/hitl-check.sh
      artifact_source: "{{input.specification}}/01-spec.md"
      poll_interval: 60
      timeout: 7200
  ```
- **Rules:**
  - Artifacts overwritten on re-run (git history preserves previous).
  - QA iteration numbering restarts on re-run.

## 6. Non-Functional

- **Scale:** Single workflow per issue. Sequential stages (no parallel agents).
- **Fault:** Stage failure stops workflow, failure reported on issue.
- **Sec:** Secret detection via `gitleaks detect --no-git` in `deno task check`
  (`scripts/check.ts`). Engine-level scope checks removed. Agents run with
  local user's permissions.
- **Logs:** Full transcripts per stage in `.flowai-workflow/runs/<run-id>/logs/`. Note:
  logs path remains engine-controlled (`.flowai-workflow/runs/`); configurable `runs_dir`
  deferred to separate engine FR.

## 7. Constraints

- **Simplified:** Pipeline runs sequentially (no parallel stages in v1).
- **Deferred:** Multi-repo support. Parallel workflows for multiple issues.
  Issue size/complexity limits. Cost budget limits and alerts (per-node cost
  aggregation implemented in FR-E17; budget enforcement deferred).
- **Deferred prompt deduplication (ex ADR-001 C4):** Analysis of 6 SKILL.md
  files (~1700 lines) found ~600 lines (35%) duplicated across agents in 13
  rule groups. Automation tiers:
  - Tier 1 (~120 lines): `--disallowedTools` per node for tool restrictions
    (Bash, Agent, ToolSearch). `pipeline.yaml` `disallowed_tools` field.
  - Tier 2 (~200 lines): shared prompt fragments via `{{include "rules/..."}}`.
    Rules: no-grep-after-read, one-read-per-file, no-offset-limit,
    first-person-voice, git-add-force.
  - Tier 3 (~110 lines): pipeline config injection — scope-aware doc reads
    (`{{scope_docs}}`), comment prefix, reflection memory protocol.
  - Tier 4 (~100 lines): engine enforcement hooks — bash command whitelist,
    allowed file modification paths (partially covered by FR-E37).

## 8. SRS Evidence Status

All FR evidence for issue #15 is complete:

- **FR-S16 (Dashboard Result Summary Display):** Implemented. SRS section 3.34
  evidence recorded — `scripts/generate-dashboard.ts` (`renderCard`,
  `escHtml`). Tests in `scripts/generate-dashboard_test.ts`.
- **FR-S19 (Timeline Visualization):** Implemented. SRS section 3.37 evidence
  recorded — `scripts/generate-dashboard.ts` (`computeTimeline`,
  `renderTimeline`, `.timeline-bottleneck` CSS). Tests in
  `scripts/generate-dashboard_test.ts`. Evidence committed in `e493cbb`.
- **FR-E20 (Repeated File Read Warning):** Implemented. SRS section 3.38
  evidence recorded — `engine/agent.ts` (`FileReadTracker` class). Tests in
  `engine/agent_test.ts`. Evidence committed in `e493cbb`.
- **FR-S20 (Dashboard Stream Log Links):** Implemented. SRS section 3.39
  evidence recorded — `scripts/generate-dashboard.ts` (`streamLogHref`,
  `.log-link` CSS). Tests in `scripts/generate-dashboard_test.ts`.
- **FR-S21 (Agent Output Summary):** Already implemented. All 6 agent SKILL.md
  files document `## Summary` in output format. `workflow.yaml` enforces
  `contains_section: Summary` on 5 agent nodes (`specification`, `design`,
  `decision`, `verify`, `tech-lead-review`); Developer (`build`) enforced via
  `custom_script: deno task check`. Evidence:
  `.flowai-workflow/agents/agent-*/SKILL.md` (6 files), `.flowai-workflow/workflow.yaml`.
- **FR-S22 (Agent First-Person Voice — GitHub Interactions):** Voice sections
  strengthened with explicit GitHub interaction scope + third example pair per
  agent. Hardcoded `gh issue comment --body` templates in PM, Architect, Tech
  Lead SKILL.md files updated to first-person. Evidence:
  `.flowai-workflow/agents/agent-*/SKILL.md` (6 files, `## Voice` sections).

FR-S1 evidence (issue #100):

- **FR-S1 (Pipeline Trigger):** All 4 acceptance criteria marked `[x]` with
  evidence. `engine/cli.ts:36-76` (CLI entry point, flags),
  `.flowai-workflow/agents/agent-pm/SKILL.md` (issue frontmatter mandate).

Engine FR evidence (issue #99):

- **FR-E2, FR-E10, FR-E11, FR-E13, FR-E19:** Documentation-only — mark
  existing implementations with evidence in `documents/requirements-engine.md`.
  No code or design changes. Variant A (batch single-pass) selected. FR-E11
  completed (commits `ba99362`, `232dc53`). Remaining: FR-E2 (2 ACs), FR-E10
  (12 ACs), FR-E13 (6 ACs), FR-E19 (7 ACs) — 27 ACs total.

FR-S24 evidence (issue #96):

- **FR-S24 (Pipeline Config Validation):** Existing implementation satisfies
  all acceptance criteria. `scripts/check.ts:84-96` (`workflowIntegrity()`
  calls `loadConfig()`), `engine/config.ts:43-103` (schema validation),
  `engine/config.ts:105-249` (node validation — types, inputs, run_on).
  No new code required — Variant A (evidence-only) selected.
- **FR-S11 (Inter-Stage Data Flow):** SRS text updated by PM to reflect
  phase-aware artifact path `.flowai-workflow/runs/<run-id>/[<phase>/]<node-id>/`.
  SDS §2.2 already documents phase-aware layout. Engine FR-E9 implementation
  deferred (separate issue).
- **FR-S25 (Phase-Organized SDLC Artifact Directories):** FR-E9 phase registry
  implemented (`engine/state.ts:20-36`, `engine/engine.ts:129-130`). Artifact
  paths resolve to `.flowai-workflow/runs/<run-id>/<phase>/<node-id>/` for nodes with
  `phase:` field. SDLC workflow nodes have `phase:` fields in `workflow.yaml`
  (`plan`, `impl`, `report`). ACs #1-3 marked with evidence. ACs #4-5 pending
  verification (end-to-end run + `deno task check`). Selected Variant A
  (Verification-Only) — no code changes, evidence marking only. Dashboard
  phase-aware path computation deferred. FR-E5 and FR-E7 deferred.

FR-S40 documentation sync (issue #158):

- **FR-S40 (Pipeline Format Change Documentation Sync):** Documentation-only.
  SDS verified post-FR-S38: §2.2 `phases:` description accurate, §3.4
  `prompt:` correctly marked as removed with `{{file(...)}}` replacement
  documented, §3.4 Interfaces shows current `task_template` pattern. No stale
  `phases:` or `prompt:` references found in SDS. SRS, workflow-report, and
  spec-unified-task-template corrections handled by developer.

FR-S42 workflow validate migration (issue #174):

- **FR-S42 (Migrate Pipeline Validate Rules to Composite Artifact Type):**
  All 6 agent node validate blocks in `workflow.yaml` migrated from separate
  `file_exists` + `file_not_empty` + `contains_section` rules to single
  composite `type: artifact` rule per node. `build` node gains implicit
  `file_not_empty` check (no-op tightening — file with `## Summary` cannot
  be empty). `frontmatter_field` and `custom_script` rules unchanged.
  Variant C selected. Evidence: `.flowai-workflow/workflow.yaml` validate blocks.

Engine refactoring (issue #92):

- **engine.ts module size reduction:** Pure engine-scope refactoring — no SDLC
  workflow impact. Variant A selected: extract `engine/hitl-handler.ts` (HITL
  orchestration) and `engine/post-workflow.ts` (post-workflow executor) from
  `engine/engine.ts`. Target: ≤500 LOC (from 849). Engine public interfaces
  unchanged; SDLC workflow transparent to internal restructuring.

