# SRS: Engine — Index

Functional requirements for the domain-agnostic DAG executor engine. Split
across section files in [requirements-engine/](requirements-engine/) to fit
within the `Read` tool's 10k-token limit (working budget ~8k tokens per file).
FR-IDs are stable — never renumber them on move.

## Sections

- [00-meta.md](requirements-engine/00-meta.md) — Resolved decisions, intro,
  general description, NFR, interfaces, proposals (P1..P4).
- [01-execution-model.md](requirements-engine/01-execution-model.md) —
  Continuation, artifact versioning, project layout, run folder structure,
  separation invariant, graceful shutdown, phase mechanism, error precedence.
- [02-nodes-and-models.md](requirements-engine/02-nodes-and-models.md) —
  Loop body nesting, `run_on`, per-node model/effort/fallback, loop input
  forwarding and condition-field validation.
- [03-config-and-validation.md](requirements-engine/03-config-and-validation.md)
  — Configuration schema, drift detection, dry-run, prompt-path validation,
  `prepare_command`, scope-based modification detection, frontmatter fields.
- [04-runtime-and-hooks.md](requirements-engine/04-runtime-and-hooks.md) —
  Agent log storage, HITL, failure hook, worktree isolation, stale-path
  cleanup, `{{file()}}` template, permission mode.
- [05-cli-and-observability.md](requirements-engine/05-cli-and-observability.md)
  — Verbose/semi-verbose/final-summary output, cost aggregation, stream-log
  timestamps, repeated-read warning, node result summary, CLI help.
- [06-distribution-and-housekeeping.md](requirements-engine/06-distribution-and-housekeeping.md)
  — Housekeeping, test suite integrity, shared backoff, legacy test task
  removal, standalone binary, auto-update, IDE CLI wrapper split.

## FR-E ID → Section File

- FR-E1  (Continuation)              → 01-execution-model
- FR-E2  (Agent Log Storage)         → 04-runtime-and-hooks
- FR-E3  (Artifact Versioning)       → 01-execution-model
- FR-E4  (Configuration)             → 03-config-and-validation
- FR-E5  (Project Directory Struct)  → 01-execution-model
- FR-E6  (Verbose Output `-v`)       → 05-cli-and-observability
- FR-E7  (Config Drift Detection)    → 03-config-and-validation
- FR-E8  (Human-in-the-Loop)         → 04-runtime-and-hooks
- FR-E9  (Run Artifacts Folder)      → 01-execution-model
- FR-E10 (Loop Body Node Nesting)    → 02-nodes-and-models
- FR-E11 (`run_on`)                  → 02-nodes-and-models
- FR-E12 (Per-Node Model)            → 02-nodes-and-models
- FR-E13 (Accurate Dry-Run)          → 03-config-and-validation
- FR-E14 (Engine-Workflow Separation)→ 01-execution-model
- FR-E15 (Node Result Summary)       → 05-cli-and-observability
- FR-E16 (Prompt Path Validation)    → 03-config-and-validation
- FR-E17 (Aggregate Cost Data)       → 05-cli-and-observability
- FR-E18 (Stream Log Timestamps)     → 05-cli-and-observability
- FR-E19 (`on_failure_script` Hook)  → 04-runtime-and-hooks
- FR-E20 (Repeated File Read Warning)→ 05-cli-and-observability
- FR-E21 (Semi-Verbose `-s`)         → 05-cli-and-observability
- FR-E22 (Final Summary w/ Results)  → 05-cli-and-observability
- FR-E23 (CLI Help for `check`)      → 05-cli-and-observability
- FR-E24 (Worktree Isolation)        → 04-runtime-and-hooks
- FR-E25 (Graceful Shutdown)         → 01-execution-model
- FR-E26 (Codebase Housekeeping)     → 06-distribution-and-housekeeping
- FR-E27 (Test Suite Integrity)      → 06-distribution-and-housekeeping
- FR-E28 (Shared Backoff Utility)    → 06-distribution-and-housekeeping
- FR-E29 (Legacy Test Task Removal)  → 06-distribution-and-housekeeping
- FR-E30 (Prepare Command)           → 03-config-and-validation
- FR-E31 (Stale Path Cleanup)        → 04-runtime-and-hooks
- FR-E32 (`{{file()}}` Template)     → 04-runtime-and-hooks
- FR-E33 (Phase Single-Mechanism)    → 01-execution-model
- FR-E34 (Error Handling Precedence) → 01-execution-model
- FR-E35 (Loop Input Forwarding)     → 02-nodes-and-models
- FR-E36 (Loop Condition Field)      → 02-nodes-and-models
- FR-E37 (Scope-Based Detection)     → 03-config-and-validation
- FR-E38 (Artifact Rule Fields)      → 03-config-and-validation
- FR-E39 (Standalone Binary)         → 06-distribution-and-housekeeping
- FR-E40 (Permission Mode)           → 04-runtime-and-hooks
- FR-E41 (Auto-Update & Release CI)  → 06-distribution-and-housekeeping
- FR-E42 (Per-Node Effort Level)     → 02-nodes-and-models
- FR-E43 (Fallback Model)            → 02-nodes-and-models
- FR-E44 (IDE CLI Wrapper Split)     → 06-distribution-and-housekeeping
- FR-E45 (Subcommand Routing)        → 05-cli-and-observability
- FR-E46 (Interactive REPL)           → 05-cli-and-observability
- FR-E47 (Run Budget Enforcement)    → 05-cli-and-observability
- FR-E48 (Node Tool Filtering)       → 04-runtime-and-hooks
