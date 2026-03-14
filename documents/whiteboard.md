# Restructure SRS/SDS into Separate Engine + SDLC Files

## Goal

Split monolithic requirements.md and design.md into separate files per scope
(engine vs SDLC pipeline). Improves navigability, reduces cognitive load,
enables independent evolution of each scope's docs.

## Overview

### Current State

- `documents/requirements.md` — single monolithic SRS (~1106 lines, 43 FRs)
- `documents/design.md` — single monolithic SDS (~793 lines)
- Both mix engine and pipeline concerns without separation
- GitHub issues already labeled `scope: engine` / `scope: sdlc`
- `documents/AGENTS.md` references single-file Part A/Part B structure

### Constraints

- Preserve ALL content verbatim (acceptance criteria, evidence links, checkboxes)
- FR renumbering: `FR-E<N>` (engine), `FR-S<N>` (SDLC), old `FR-<N>` as alias
- Update `documents/AGENTS.md` to reflect new file paths
- Update `CLAUDE.md` if it references old file paths

## Definition of Done

- [x] `requirements.md` split into `requirements-engine.md` + `requirements-sdlc.md`
- [x] `design.md` split into `design-engine.md` + `design-sdlc.md`
- [x] Old `requirements.md` and `design.md` removed
- [x] Cross-reference table (old FR-N → new ID) in `requirements-engine.md` appendix
- [x] `documents/AGENTS.md` updated: new file paths, new SRS/SDS format templates
- [x] `CLAUDE.md` updated with new scope file paths
- [x] All agent SKILL.md files updated with new doc paths
- [x] `pipeline.yaml` and legacy scripts updated with new doc paths
- [x] `deno task check` passes (490 tests, 0 failed)

## Solution

### Step 1: Classify FRs (already done in previous whiteboard)

**Engine FRs (21):**

- FR-8 → FR-E1: Continuation Mechanism
- FR-10 → FR-E2: Agent Log Storage
- FR-13 → FR-E3: Artifact Versioning
- FR-15 → FR-E4: Configuration
- FR-17 → FR-E5: Project Directory Structure
- FR-18 → FR-E6: Verbose Output (`-v`)
- FR-20 → FR-E7: Pipeline Config Drift Detection
- FR-21 → FR-E8: Human-in-the-Loop
- FR-23 → FR-E9: Run Artifacts Folder Structure
- FR-24 → FR-E10: Loop Body Node Nesting
- FR-25 → FR-E11: Conditional Post-Pipeline Node Execution (`run_on`)
- FR-27 → FR-E12: Per-Node Model Configuration
- FR-28 → FR-E13: Accurate Dry-Run Output
- FR-29 → FR-E14: Engine-Pipeline Separation Invariant
- FR-30 → FR-E15: Node Result Summary
- FR-31 → FR-E16: Prompt Path Validation at Config Load
- FR-32 → FR-E17: Aggregate Cost Data in state.json
- FR-33 → FR-E18: Stream Log Timestamps
- FR-34 → FR-E19: Generic Pipeline Failure Hook
- FR-39 → FR-E20: Repeated File Read Warning
- FR-41 → FR-E21: Semi-Verbose Output Mode (`-s`)

**SDLC Pipeline FRs (22):**

- FR-1 → FR-S1: Pipeline Trigger
- FR-2 → FR-S2: PM (Specification)
- FR-3 → FR-S3: Architect (Design-Solution Plan)
- FR-4 → FR-S4: Plan Critique (absorbed)
- FR-5 → FR-S5: Tech Lead (Decision + Branch + PR)
- FR-6 → FR-S6: SDS Update (absorbed)
- FR-7 → FR-S7: Developer + QA Loop
- FR-9 → FR-S8: Presenter (absorbed)
- FR-11 → FR-S9: Meta-Agent
- FR-12 → FR-S10: Runtime Infrastructure
- FR-14 → FR-S11: Inter-Stage Data Flow & Commit Strategy
- FR-16 → FR-S12: Secrets
- FR-19 → FR-S13: Agents as Skills
- FR-22 → FR-S14: Project Documentation (README)
- FR-26 → FR-S15: Align Pipeline Git Workflow
- FR-35 → FR-S16: Dashboard Result Summary Display
- FR-36 → FR-S17: Agentskills.io-Compliant Skill Layout
- FR-37 → FR-S18: Rename Executor to Developer
- FR-38 → FR-S19: Timeline Visualization
- FR-40 → FR-S20: Dashboard Stream Log Links
- FR-42 → FR-S21: Agent Output Summary Section
- FR-43 → FR-S22: Agent First-Person Voice

### Step 2: SDS Component Classification

**Engine (`design-engine.md`):**

- Engine modules: types.ts, template.ts, config.ts, dag.ts, validate.ts,
  state.ts, agent.ts, loop.ts, hitl.ts, human.ts, output.ts, engine.ts,
  cli.ts, mod.ts
- Phase Registry (§3.7)
- Data entities: ValidationRule, LoopResult, LoopNodeConfig, NodeState,
  RunState, NodeConfig, Pipeline Config format
- Inter-Node Data Flow (§4.1 — engine mechanism part)
- Logic: Continuation Loop, Verbose Output Flow, Loop Node Log Saving,
  Node Result Summary, Post-Pipeline Node Collection, HITL via AskUserQuestion
- Non-Functional: Scale, Fault tolerance, Logs
- Architecture diagram: §2.2 (Configurable Node Engine)

**SDLC Pipeline (`design-sdlc.md`):**

- Docker Image (§3.1)
- Stage Scripts — deprecated (§3.2)
- Shared Library lib.sh (§3.3)
- Agent Skills (§3.4)
- HITL Pipeline Scripts (§3.8)
- Pipeline Trigger (§3.9)
- Dashboard Generator (§3.10)
- Commit Strategy (§4.2)
- Pipeline DAG diagram (§2.3)
- Architecture diagram: §2.1 (Legacy Shell — deprecated)
- SRS Evidence Status (§8)

### Step 3: Create files

Target file structure:

```
documents/
  requirements-engine.md   # SRS Engine scope
  requirements-sdlc.md     # SRS SDLC Pipeline scope
  design-engine.md         # SDS Engine scope
  design-sdlc.md           # SDS SDLC Pipeline scope
  AGENTS.md                # Updated refs
  whiteboard.md
  meta.md
```

Each SRS file structure (no Part A/B prefixes needed):

```markdown
# SRS: Engine (or SDLC Pipeline)

## 1 Intro
- **Desc:**
- **Def/Abbr:**

## 2 General
- **Context:**
- **Assumptions/Constraints:**

## 3 Functional Reqs
### 3.1 FR-E1 (ex FR-8): Title
- **Desc:**
- **Acceptance:**

## 4 Non-Functional
## 5 Interfaces

## Appendix: FR Cross-Reference (only in requirements-engine.md)
```

Each SDS file structure:

```markdown
# SDS: Engine (or SDLC Pipeline)

## 1 Intro
- **Purpose:**
- **Rel to SRS:**

## 2 Arch
- **Diagram:**
- **Subsystems:**

## 3 Components
### 3.1 Component
- **Purpose:**
- **Interfaces:**
- **Deps:**

## 4 Data
## 5 Logic
## 6 Non-Functional
## 7 Constraints
```

### Step 4: Update AGENTS.md and CLAUDE.md

- `documents/AGENTS.md`: Update Hierarchy section, SRS/SDS format templates
- `CLAUDE.md`: Update any references to old file paths

### Step 5: Remove old files

- Delete `documents/requirements.md`
- Delete `documents/design.md`

### Step 6: Validate

- `deno task check`
