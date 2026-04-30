# SRS: SDLC Workflow — Index

Functional requirements for the example SDLC workflow running on top of the
engine. Split across section files in [requirements-sdlc/](requirements-sdlc/)
to fit within the `Read` tool's 10k-token limit (working budget ~8k tokens
per file). FR-IDs are stable — never renumber them on move.

## Sections

- [00-meta.md](requirements-sdlc/00-meta.md) — Resolved decisions, intro,
  general description, NFR, interfaces, acceptance criteria, proposals,
  workflow stage map, file structure appendix.
- [01-workflow-stages.md](requirements-sdlc/01-workflow-stages.md) —
  Pipeline trigger, PM / Architect / Tech Lead / Developer+QA loop / Meta
  agent stages (FR-S1..S9).
- [02-workflow-integration.md](requirements-sdlc/02-workflow-integration.md)
  — Inter-stage data flow and commit strategy, standard GitHub workflow
  alignment, agent first-person voice in GH interactions.
- [03-runtime-and-init.md](requirements-sdlc/03-runtime-and-init.md) —
  Runtime infrastructure, secrets, agents-as-skills, README, docs accuracy,
  AGENTS.md agent list, project init CLI (`flowai-workflow init`).
- [04-artifacts-and-memory.md](requirements-sdlc/04-artifacts-and-memory.md)
  — Agentskills layout, phase-organized artifact dirs, asset consolidation,
  per-agent reflection memory, file numbering standard, HITL artifact ref.
- [05-dashboard-and-observability.md](requirements-sdlc/05-dashboard-and-observability.md)
  — Dashboard result summary, timeline, stream-log links, output summary
  section, diagnostic enhancements, after-script failure observability.
- [06-quality-and-validation.md](requirements-sdlc/06-quality-and-validation.md)
  — Workflow config validation, QA check suite, verify-node verdict
  validation, `file()` injection, composite artifact migration, confidence
  scoring, multi-focus parallel review.
- [07-housekeeping-and-tooling.md](requirements-sdlc/07-housekeeping-and-tooling.md)
  — Executor → Developer rename, SDLC utility CLI help, stale path cleanup,
  symlink cleanup, redundant read-rules bootstrap, format change sync, superseded
  pre_run, Architect codebase exploration.

## FR-S ID → Section File

- FR-S1  (Workflow Trigger)                → 01-workflow-stages
- FR-S2  (Stage 1 — PM)                    → 01-workflow-stages
- FR-S3  (Stage 2 — Architect)             → 01-workflow-stages
- FR-S4  (Plan Critique — absorbed)        → 01-workflow-stages
- FR-S5  (Stage 3 — Tech Lead)             → 01-workflow-stages
- FR-S6  (SDS Update — absorbed)           → 01-workflow-stages
- FR-S7  (Developer+QA Loop)               → 01-workflow-stages
- FR-S8  (Presenter — absorbed)            → 01-workflow-stages
- FR-S9  (Meta-Agent)                      → 01-workflow-stages
- FR-S10 (Runtime Infrastructure)          → 03-runtime-and-init
- FR-S11 (Inter-Stage Data Flow)           → 02-workflow-integration
- FR-S12 (Secrets)                         → 03-runtime-and-init
- FR-S13 (Agents as Skills)                → 03-runtime-and-init
- FR-S14 (Project Documentation)           → 03-runtime-and-init
- FR-S15 (Standard GitHub Workflow)        → 02-workflow-integration
- FR-S16 (Dashboard Result Summary)        → 05-dashboard-and-observability
- FR-S17 (Agentskills Layout)              → 04-artifacts-and-memory
- FR-S18 (Executor → Developer Rename)     → 07-housekeeping-and-tooling
- FR-S19 (Timeline Visualization)          → 05-dashboard-and-observability
- FR-S20 (Dashboard Stream Log Links)      → 05-dashboard-and-observability
- FR-S21 (Agent Output Summary)            → 05-dashboard-and-observability
- FR-S22 (First-Person Voice on GH)        → 02-workflow-integration
- FR-S23 (SDLC Docs Accuracy)              → 03-runtime-and-init
- FR-S24 (Workflow Config Validation)      → 06-quality-and-validation
- FR-S25 (Phase-Organized Dirs)            → 04-artifacts-and-memory
- FR-S26 (Workflow Asset Consolidation)    → 04-artifacts-and-memory
- FR-S27 (SDLC Utility CLI Help)           → 07-housekeeping-and-tooling
- FR-S28 (Per-Agent Reflection Memory)     → 04-artifacts-and-memory
- FR-S29 (AGENTS.md Agent List)            → 03-runtime-and-init
- FR-S30 (Stale Path Cleanup SDLC)         → 07-housekeeping-and-tooling
- FR-S31 (QA Check Suite Extension)        → 06-quality-and-validation
- FR-S32 (File Numbering Standard)         → 04-artifacts-and-memory
- FR-S33 (Stale Symlinks Cleanup)          → 07-housekeeping-and-tooling
- FR-S34 (Dashboard Diagnostics)           → 05-dashboard-and-observability
- FR-S35 (HITL Artifact Source Reference)  → 04-artifacts-and-memory
- FR-S36 (After-Script Observability)      → 05-dashboard-and-observability
- FR-S37 (Verify Node Verdict Validation)  → 06-quality-and-validation
- FR-S38 (`file()` Injection)              → 06-quality-and-validation
- FR-S39 (Redundant Read-Rules Bootstrap)  → 07-housekeeping-and-tooling
- FR-S40 (Format Change Doc Sync)          → 07-housekeeping-and-tooling
- FR-S41 (pre_run — superseded)            → 07-housekeeping-and-tooling
- FR-S42 (Composite Artifact Migration)    → 06-quality-and-validation
- FR-S43 (Architect Codebase Exploration)  → 07-housekeeping-and-tooling
- FR-S44 (Confidence-Scored QA Review)     → 06-quality-and-validation
- FR-S45 (Multi-Focus Parallel Review)     → 06-quality-and-validation
- FR-S46 (Project Init CLI)                → 03-runtime-and-init
- FR-S47 (Workflow Folder Contract)        → 04-artifacts-and-memory
