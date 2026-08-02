<!-- section file — index: [documents/requirements-sdlc.md](../requirements-sdlc.md) -->

# SRS SDLC — Meta (Intro, NFR, Interfaces, Proposals, Appendices)


# SRS: SDLC Workflow

## 0. Resolved Design Decisions

- **Target project:** This repo (flowai-workflow). Project-agnostic reuse deferred.
- **Concurrent workflows:** One workflow per branch. Single local execution assumed. No concurrent locking.
- **Cost limits:** Not tracked. No budget constraints.
- **Agent prompts:** Written incrementally alongside implementation.
- **CLAUDE.md interaction:** Target project's CLAUDE.md and agent system prompts complement each other (additive, not conflicting).
- **Issue complexity:** No size/complexity limits for now. Deferred.
- **Testing strategy:** Integration tests in this repo (no separate test repo). Unit tests for `lib.sh`.
- **Meta-Agent:** Auto-applies prompt improvements (commits to feature branch). Reviewed at PR merge.
- **Rollback:** Manual operation (no automated rollback).
- **Retry logic:** 3 attempts with exponential backoff for external API calls (`claude`, `gh`) in `lib.sh`.

## 1. Introduction

- **Document purpose:** Define the specification for the automated multi-agent SDLC workflow — a chain of specialized AI agents orchestrated by the DAG engine, automating the full development lifecycle from GitHub issue triage to merged PR.
- **Scope:** A locally-run workflow where a GitHub Issue triggers a chain of specialized AI agents (via `deno task run [--prompt "..."]`), each performing a distinct role in the software development lifecycle — from issue triage to QA verification. PM agent autonomously selects and triages open GitHub issues. This document covers workflow-specific concerns: agent roles, prompts, GitHub workflow, devcontainer, dashboard. Engine-level concerns (DAG executor, node types, validation, continuation, resume, HITL, CLI) are in the engine SRS.
- **Audience:** Project maintainer (korchasa), contributors.
- **Definitions and abbreviations:**
  - **Agent:** An isolated Claude Code CLI invocation with a dedicated system prompt (role).
  - **Stage:** A single step in the workflow, executed by one agent.
  - **Handoff Artifact:** A structured Markdown file produced by one agent and consumed by the next.
  - **Agent Log:** A full transcript of an agent's session (input, reasoning, output, tool calls).
  - **Meta-Agent:** A separate agent that analyzes logs of other agents and refines their prompts.
  - **Continuation:** A mechanism for re-invoking an agent within the same session (via `--resume`) to fix issues detected by the stage script (see engine SRS).

## 2. General description

- **System context:** Operates as a local Deno engine process triggered by CLI command (`deno task run [--prompt "..."]`). The engine reads workflow DAG config (`.flowai-workflow/<workflow>/workflow.yaml`), executes nodes sequentially via `claude` CLI, validates outputs, and commits artifacts. PM agent autonomously triages open GitHub issues; `--prompt` passes optional additional context. Agents communicate through files in the repository.
- **Assumptions and constraints:**
  - A devcontainer provides the runtime environment with all required tools (see FR-S10).
  - Each agent is stateless between runs — all context comes from input artifacts and its system prompt.
  - The target project is this repository (flowai-workflow). Workflow design should be project-agnostic for future reuse in other repos.
- **Goal:** Automate the full development cycle for feature requests: from issue triage to a ready-to-merge PR — fully autonomous, no human gates between stages. PR merge is the only human checkpoint (post-workflow, not between stages).

## 3. Functional Requirements



## 4. Non-functional requirements

- **Isolation:** Each agent runs in its own Claude Code process with no shared state except file artifacts. Single local execution assumed (one workflow at a time). Concurrent execution is not supported.
- **Reproducibility:** Agent prompts are versioned in the repository under `.flowai-workflow/<workflow>/agents/`.
- **Observability:** Full logs stored per stage in `.flowai-workflow/<workflow>/runs/<run-id>/logs/`. Total workflow duration reported in the final PR description.
- **Fault tolerance:** If a stage fails (agent error, timeout, continuation limit exhausted), the workflow stops. Manual restart via `--resume <run-id>`.
- **Timeouts:** Each stage has a configurable timeout via `SDLC_STAGE_TIMEOUT_MINUTES` env var (default: 30 min). Engine enforces timeout per node. When a timeout fires, the stage is treated as failed.
- **Security:** Enforced at the engine/stage script level via diff-based checks (see engine SRS FR-E1). Agents run with the local user's permissions.

## 5. Interfaces

- **Trigger:** Single entry point `deno task run [--prompt "..."]`. PM agent autonomously selects and triages open GitHub issues. `--prompt` passes optional additional context to PM. Common engine flags: `--resume`, `--dry-run`, `-v`, `-q`, `--config`.
- **Agent runtime:** `claude` CLI invoked by the Deno engine. Agent context (shared rules + SKILL.md) injected via `{{file(...)}}` in `task_template`, delivered as user message (`-p`) per FR-S38. Key flags:
  - `-p "<task>"` — passes task prompt derived from `task_template`. Shared rules and SKILL.md inlined via `{{file(...)}}` template function (FR-S38). No `--append-system-prompt` used for workflow agents.
  - `--output-format stream-json` — streams JSON events line-by-line; `result` event contains `result`, `session_id`, `total_cost_usd`, `duration_ms`, `num_turns`, `is_error`.
  - `--resume <session-id>` — re-invokes agent in the same session for continuations (engine SRS FR-E1).
  - `-p "<prompt>"` — non-interactive mode, task description is passed as the prompt argument.
- **Workflow engine:** Deno/TypeScript engine (`src/`) reads DAG config from `.flowai-workflow/<workflow>/workflow.yaml`, resolves node dependencies, executes nodes in topological order, manages state in `.flowai-workflow/<workflow>/runs/<run-id>/state.json`.
- **Legacy stage scripts:** `.flowai-workflow/scripts/stage-<N>-<role>.sh` — handle invocation, validation, continuation, artifact commit. Superseded by engine but preserved.
- **Inter-stage communication:** Engine: artifacts in `.flowai-workflow/runs/<run-id>/[<phase>/]<node-id>/`, linked via templates. Legacy: `.flowai-workflow/workflow/<issue-number>/`. Filesystem is source of truth.
- **Branching & commits:** Feature branch `sdlc/issue-<N>` created by Tech Lead (fallback `sdlc/{{run_id}}` for `--prompt` mode). Developer owns commits (`git add`, `git commit`, `git push` per task). Commit format: `sdlc(impl): <summary>`. Failed stages produce no commits.

## 6. Acceptance criteria

The system is considered accepted if:

1. Running `deno task run` triggers the full workflow; PM autonomously selects the highest-priority open GitHub issue.
2. Each stage produces its expected artifact with all required sections.
3. The Continuation mechanism catches and fixes `deno task check` failures without human intervention.
4. The Developer+QA loop iterates until quality checks pass.
5. Tech Lead creates draft PR; Tech Lead Review performs final review and merge.
6. All agent logs are preserved and accessible.
7. Re-running the workflow on the same issue cleanly overwrites artifacts.

## 7. Proposals (Non-Binding)

Design ideas captured for discussion; not committed work. Promote to FR-S only after explicit decision and measured evidence that the idea solves a real pain.

### P1-S: PR-Diff Scope Boundary Verifier

- **Description:** Pre-merge verifier that parses a pull request's diff and classifies touched files by project scope (`engine` vs `sdlc` vs cross-cutting). When a PR labelled `scope: engine` touches SDLC-only files (or vice versa), the verifier emits a blocking finding that the Tech Lead Review node must address before merge.
- **Motivation:** Project has a strict scope separation rule — engine MUST remain domain-agnostic, SDLC workflows use the engine but never reach into it. Runtime per-node enforcement already exists via engine's `allowed_paths` + `scope_check` rule (FR-E37), but that catches violations only during agent execution. A PR-level check would catch cases where a human merges a pre-existing branch that violates scope, or where an agent legitimately produced a mixed-scope change that should have been labelled `engine+sdlc`.
- **Relation to existing mechanisms:** Overlaps with FR-E37 at runtime level. P1-S adds a complementary pre-merge gate that considers the full diff regardless of which agent produced each hunk.
- **Open questions:** How to classify new files with ambiguous path prefixes? How to handle root-level config files (deno.json, CLAUDE.md) that are legitimately cross-cutting? Should the verifier run as a `deno task check` step, a CI workflow, or inside the Tech Lead Review agent's turn?
- **Status:** Deferred. No measured scope-boundary violation has escaped runtime enforcement so far. Revisit when a concrete regression demonstrates the gap.
- **Source:** R&D walkthrough 2026-04-11, [documents/claude-code-best-practices-for-sdlc.md § Topic 5](claude-code-best-practices-for-sdlc.md).

### P2-S: GO/NO-GO Gate After PM Specification

- **Description:** Optional decision gate between the PM (specification) and Architect (design) stages. After the PM produces `01-spec.md`, an automated or human check decides whether the selected issue is worth proceeding to expensive Architect design. On a NO-GO verdict, the workflow terminates early with a clear reason; on GO, it proceeds normally. Gate outcome is written as a frontmatter field on the spec artifact so the engine's existing `condition_node` mechanism can branch.
- **Motivation:** Architect runs on the most expensive model (opus). If the PM selects a low-value or non-viable issue, Architect spend is wasted. The current PM stage performs issue health checks (no merged PRs, no `needs-triage` label) which filters some bad candidates, but there is no explicit viability gate separating "found a candidate" from "worth expensive design work".
- **Inspiration:** The RPI (Research → Plan → Implement) workflow in Claude Code best practices uses an explicit GO/NO-GO gate at the end of its Research phase. That gate rejects non-viable features before planning. SDLC has no equivalent — PM always produces a spec and Architect always runs.
- **Design options:**
  1. **Automated gate:** PM writes `verdict: PROCEED | SKIP` in spec frontmatter; engine uses `condition_node` to branch. Keeps workflow fully autonomous (FR-S1 invariant preserved).
  2. **Human gate:** Engine `human` node between PM and Architect prompts operator for approval. Breaks autonomous operation but maximises safety.
  3. **Hybrid:** Automated gate normally; escalate to human when PM confidence is low.
- **Open questions:** What measured symptom would justify implementing this? How often does PM currently produce specs that Architect would have rejected if asked? Is this a single-developer problem at all, or does it only appear at team scale?
- **Status:** Deferred pending evidence. Need to log cases where Architect (or downstream Tech Lead) regrets the PM's issue selection. Without such evidence, gate adds friction without measurable benefit.
- **Source:** R&D walkthrough 2026-04-11, [documents/claude-code-best-practices-for-sdlc.md § Topic 12](claude-code-best-practices-for-sdlc.md).

### P3-S: Batch Migration Workflow for Cross-Cutting Changes

- **Description:** A separate SDLC workflow config (e.g. `workflow-batch.yaml`) dedicated to cross-cutting migrations that touch many files with the same change pattern. Instead of one PR per issue (current model), the batch workflow fans out work to N parallel developer agents, each operating on a disjoint file subset in its own isolated worktree. After all parallel workers complete, results merge into a single branch and PR.
- **Motivation:** Current SDLC is optimised for the "one issue, one PR" model with a linear pipeline. Large migrations (rename an API across 50 files, apply the same security fix to N similar modules, bulk-update docs across all FRs) do not fit this model — they either run sequentially in one agent session (slow, context-bloat) or are done manually outside the workflow.
- **Pattern origin:** Claude Code's `/batch` command, which interviews the operator, splits the work into atomic units, creates a git worktree per unit, and runs a Claude subagent per worktree in parallel. This is fan-out over identical task pattern applied to disjoint data, not fan-out over different tasks.
- **Prerequisite:** Engine [P2 (Per-Node Worktree Isolation for Safe Parallel Execution)](../requirements-engine/00-meta.md#p2-per-node-worktree-isolation-for-safe-parallel-execution) must ship first. Without per-node worktree isolation, parallel developers writing to overlapping paths will race. `allowed_paths` enforcement mitigates but does not solve nested-tree merge semantics.
- **Potential shape (illustrative):**
  ```
  specification → split → parallel(dev-worker-1, dev-worker-2, ..., dev-worker-N) → merge → verify → review
  ```
  Where `split` is a new agent or engine node type that computes the task partition, and `dev-worker-*` are isomorphic nodes running the same prompt against different file subsets.
- **Open questions:** How does the split agent produce a safe partition? How are merge conflicts between worker outputs resolved — fail the whole batch, resolve via second agent, or escalate to human? What fraction of real SDLC migrations are large enough to justify the batch overhead? Does the workflow.yaml DSL need new syntax for parametric node instantiation, or can it be expressed with existing primitives?
- **Status:** Deferred until engine P2 ships and a concrete migration (first FR touching >20 files under a single pattern) demonstrates the need.
- **Source:** R&D walkthrough 2026-04-11, [documents/claude-code-best-practices-for-sdlc.md § Topic 18](claude-code-best-practices-for-sdlc.md).

## Appendix A: Workflow Stage Map

| Stage | Role             | Artifact                                | Key Validation                               |
| ----- | ---------------- | --------------------------------------- | -------------------------------------------- |
| 1     | Project Manager  | `01-spec.md` + updated SRS              | Has all 4 sections, no SDS details           |
| 2     | Architect        | `02-plan.md`                            | 2-3 variants with concrete file refs         |
| 3     | Tech Lead        | `03-decision.md` + SDS + branch + PR    | Variant selected, SDS updated, PR opened     |
| 4-5   | Developer + QA   | Code + commits + `05-qa-report.md`      | `deno task check` passes, PR reviews posted  |
| 6*    | Tech Lead Review | PR review + merge                       | CI green, code review passed                 |

\* Post-workflow node. Tech Lead Review runs as `run_on: always`.

## Appendix B: File Structure

```
.claude/skills/                          # Non-agent project skills (agent-* symlinks removed by FR-S33)
.flowai-workflow/                              # Workflow assets (FR-S26)
  agents/                               # Canonical agent prompts (agentskills.io-compliant, FR-S17)
    agent-pm/SKILL.md                    # PM: issue triage + spec
    agent-architect/SKILL.md             # Architect: design-solution plan with variants
    agent-tech-lead/SKILL.md             # Tech Lead: critique + decision + SDS + branch + PR
    agent-tech-lead-review/SKILL.md      # Final code review + CI gate + merge (post-workflow)
    agent-developer/SKILL.md             # Implementation + commits + push (FR-S18)
    agent-qa/SKILL.md                    # QA via PR reviews
  scripts/                              # HITL scripts (engine infrastructure)
    lib.sh                              # Shared functions (logging, continuation loop, git ops)
    hitl-ask.sh                         # HITL question delivery via Telegram Bot API
    hitl-check.sh                       # HITL reply polling via Telegram Bot API
  runs/                                 # Per-run artifacts (engine-controlled path)
    <run-id>/                           # Per-run artifacts
      <phase>/<node-id>/                # Phase-grouped node output
      logs/
        <node-id>.json                # CLI JSON output (metadata)
        <node-id>.jsonl               # Full session transcript
      state.json                      # Run state (node statuses, session IDs)
  workflow.yaml                         # DAG-based workflow configuration
src/                                   # Deno/TypeScript workflow engine
    cli.ts                             # Entry point: deno task run
    src/engine/engine.ts                   # DAG executor
    # ACP runtime = external @korchasa/ai-ide-cli dependency (JSR)
    ...
```

