<!-- section file — index: [documents/requirements-sdlc.md](../requirements-sdlc.md) -->

# SRS SDLC — Quality and Validation


### 3.24 FR-S24: Workflow Config Validation

- **Description:** SDLC workflow config (`.flowai-workflow/workflow.yaml`) must be validated for schema correctness as part of `deno task check`. Detects drift between workflow config and engine schema requirements before runtime failures occur.
- **Rationale:** Unvalidated config changes cause hard-to-diagnose runtime failures. Static validation catches invalid node types, missing required fields, and bad `inputs` references at development time. Maps to SDLC-scope aspect of engine FR-E7 (config drift detection).
- **Acceptance criteria:**
  - [x] `scripts/check.ts` validates `.flowai-workflow/workflow.yaml` schema: node types, required fields, `inputs` references, `run_on` values. Evidence: `scripts/check.ts:84-96` (`workflowIntegrity()` calls `loadConfig()`), `engine/config.ts:43-103` (schema validation), `engine/config.ts:105-249` (node validation — types, inputs, `run_on`).
  - [x] `deno task check` exits non-zero with descriptive error on invalid config. Evidence: `scripts/check.ts:84-96` (`workflowIntegrity()` catches `loadConfig()` exceptions and reports descriptive error messages).
  - [x] `deno task check` passes on valid config with no false positives. Evidence: `deno task check` passes on current `.flowai-workflow/workflow.yaml` with no errors.



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
  - [x] QA agent `SKILL.md` lists `scripts/check.ts` in `Allowed File
    Modifications`.
  - [x] QA agent `SKILL.md` documents "Extend check suite" responsibility
    with all constraints above.
  - [x] QA agent can implement and wire a new check function in
    `scripts/check.ts`.
  - [ ] New checks follow existing code style and `run()`/scan pattern.
  - [ ] `deno task check` passes after QA agent adds a new check.



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


