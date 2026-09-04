---
date: "2026-08-16"
status: done
implements:
  - FR-E87
  - FR-E88
  - FR-E89
  - FR-E90
  - FR-E91
  - FR-E92
  - FR-E93
---
# Borrowed graph features + HITL node type

## Goal

Close the graph-expressiveness gap found in `documents/competitors.md`:
every mature peer has conditional transitions, dynamic fan-out,
sub-second loop predicates, command nodes and per-task isolation; we
have none. Plus promote HITL from a workflow-wide `defaults.hitl`
setting to a first-class node type.

## Overview

### Context

Comparison recorded in `documents/competitors.md` (commits c5fbc86,
8f5c969, b0a367b). Reference shapes: Bernstein (`until` shell
predicate, `command` node, per-task worktree), Microsoft Conductor
(`routes: [{to, when}]`, `for_each`), pi-taskflow (pre-run verify).

### Current State

- `NodeConfig` is one union-ish interface with 4 types: agent, merge,
  loop, human (`src/types.ts:181`).
- Loop exit is the fixed triple `condition_node` + `condition_field` +
  `exit_value` (`src/engine/loop.ts:228`).
- Edges come from `inputs:` only; the sole branch is `run_on`.
- Commands live outside the graph: `before`/`after`,
  `prepare_command`, `on_failure_script`, `custom_script` validation.
- One worktree per run (`defaults.worktree_disabled`), so
  `max_parallel > 1` contradicts the FR-E50 guardrail.
- `journal.jsonl` (FR-E69) reconstructs state; no hash chain.
- HITL is `defaults.hitl` + agent-initiated interception; `type: human`
  is terminal-only prompting.

### Constraints

- Engine stays domain-agnostic. No git/GitHub/SDLC logic.
- TDD per AGENTS.md: RED → GREEN → REFACTOR → CHECK.
- Every FR-tagged test name starts with `FR-E<N> `.
- `deno task check` green before each commit.
- Backwards compatible: existing workflows keep working unchanged.

## Definition of Done

- [x] FR-E87 `loop.until` — shell predicate exit, mutually exclusive
      with the condition triple.
- [x] FR-E88 `type: command` — first-class command node with deps,
      timeout, artifact capture.
- [x] FR-E89 `when:` — conditional edge predicate, skip semantics.
- [x] FR-E90 `for_each` — **superseded by FR-E95, not delivered.**
      `fork`/`join` replaced the block: it keeps the expansion, lets a
      branch span several nodes, and lets list items carry their own
      prompt and scope. The key no longer exists in the language — a
      config still using it fails at load with a message naming `fork`
      as its replacement (`src/config/config.ts:548`).
      Evidence: `documents/requirements-engine/08-graph-and-isolation.md:191`
      ("Superseded by FR-E95"), `documents/requirements-engine/10-fork-join.md:90`
      ("Supersedes: FR-E90"), `src/config/config_fork_test.ts:332`.
- [x] FR-E91 per-node worktree — opt-in isolation scope so parallelism
      stops contradicting FR-E50.
- [x] FR-E92 journal hash chain + `verify` command.
- [x] FR-E93 `type: hitl` — HITL as a node type.
- [x] SRS + SDS updated for each FR.
- [x] `deno task check` green.

## Solution

One FR at a time, each its own RED → GREEN → CHECK → commit cycle, in
the order above (cheapest and most isolated first). Later FRs depend on
earlier ones only through the config validator, which is extended
incrementally.
