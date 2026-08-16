# Competitive Landscape (flowai R&D)

Research reference: tools that orchestrate **CLI coding agents** under an
author-controlled control flow. Verified 2026-08-16.

## Peer Definition

A near competitor satisfies all three:

1. **Agents are subprocesses/sessions of a coding-agent CLI**, not
   in-process SDK objects.
2. **Control flow is authored**, not left to a model's tool choice.
3. **Run state is externalised** (artifacts, journal, resume).

Excluded by rule 1: LangGraph, CrewAI, Microsoft Agent Framework,
Agno/AgentOS, Letta (in-process agents). Excluded by rule 2: plain
subagent delegation (`Task` tool), Roo/Kilo orchestrator modes (model
picks the next step). Excluded by rule 3: Temporal, Hatchet, DBOS,
Restate (durable execution, no agent primitive). n8n/Dify/Flowise call
model APIs, not agent CLIs — adjacent, not peer.

## Peer Set

| Project | Control surface | Agent runtime | License |
|:--|:--|:--|:--|
| **flowai-workflow** | YAML DAG | `claude`, `opencode` via ACP | Private |
| Claude Code Workflow tool | JS script (`agent`/`parallel`/`pipeline`/`phase`) | Claude Code subagents | Proprietary [^1] |
| `pi-agents` workflow tool | JSON graph, 9 node kinds | pi subprocesses | MIT [^2][^3] |
| `pi-taskflow` | JSON / TS DSL → FlowIR, 12 phase kinds | pi subagents | MIT [^4] |
| `pi-workflows` | TS `defineWorkflow()` graph, 6 node kinds | pi conversation | MIT [^5] |
| goose recipes + subrecipes | YAML recipe tree | goose sessions, any provider | Apache-2.0 [^6][^7] |

## Feature Matrix

| Axis | flowai-workflow | CC Workflow | pi-agents | pi-taskflow | pi-workflows | goose |
|:--|:--|:--|:--|:--|:--|:--|
| **Authoring** | YAML, declarative | JS, imperative | JSON graph | JSON/TS → IR | TS graph | YAML recipe |
| **Execution** | toposort → levels | script order | graph walk | phase DAG | node+edge walk | parent → subrecipes |
| **Node kinds** | 4: agent, merge, loop, human | primitives, not nodes | 9 | 12 (work/control/selection) | 6 | recipe, subrecipe |
| **Transitions** | engine rules, YAML-fixed | JS control flow | edges on node JSON | declared deps/conditions | edges | parent prompt |
| **Runtime lock** | 2 runtimes; `cursor` rejected (FR-E77) | Claude Code only | pi only | pi only | pi only | goose only |
| **Model per node** | `model` + `effort` (FR-E12, FR-E42) | per `agent()` | frontmatter | per phase | per node | per recipe |
| **Output gating** | 6 rule types: `file_exists`, `file_not_empty`, `contains_section`, `custom_script`, `frontmatter_field`, `artifact` (composite: sections + required frontmatter `fields`, FR-E38) | JSON Schema on `agent()` | node JSON contract | gate phase + verify | decision node (fixed options) | `retry.checks` (shell) |
| **On gate failure** | continuation — same session re-prompted with error context (FR-E1), `max_continuations` default 3 | none built in; author re-calls | edge to remediation node | retry/gate policy | edge branch | full attempt restart, `on_failure` cleanup |
| **Resume** | `--resume <run-id>`, journal replay (FR-E69), completed nodes skipped | `resumeFromRunId`, longest unchanged prefix cached | run history | persistence for resume | durable queue; close = park, not cancel | session resume; no graph-level resume |
| **Isolation** | per-run git worktree (FR-E57) + main-tree leak guardrail (FR-E50) + rescue branch (FR-E51) | opt-in per-agent worktree | subprocess context | workspace isolation | per-node context | subrecipe session isolation (no shared history/memory) |
| **Parallelism** | opt-in `max_parallel`, unsafe > 1 under FR-E50 | default, cap `min(16, cpus-2)` | budgeted `max_parallelism` | parallel + map phases | graph-parallel | isolated worker processes |
| **Dynamic fan-out** | none — graph static, 4 node kinds (`src/types.ts:183`) | `pipeline()` over runtime list | dynamic expansion | `map` phase | none | subrecipe list |
| **Static verification** | schema load + `--dry-run` + drift detection (FR-E7, FR-E13) | none (JS runs) | budget preflight | `taskflow_verify` / `taskflow_compile` before run | type-checked TS | schema validation |
| **HITL** | `human` node type + agent-initiated HITL on both runtimes (FR-E8, FR-E75) | none | checkpoint node | approval phase | checkpoint node, `/workflow answer <json>` | none first-class |
| **External control API** | embedded MCP server, 9 tools (FR-E73/E84/E85) | host task tools only | none | none | `/workflow` slash commands + `piw` viewer | CLI + scheduler |
| **Cost accounting** | aggregate cost/duration per run (FR-E17, FR-E22), budget cap (FR-E47) | token budget in script (`budget.remaining()`) | budgets | budgets | none | per-session |
| **Portability unit** | workflow folder — `git mv` and it runs elsewhere | `.claude/workflows/*.js` | agent md + graph JSON | flow file | `.pi/workflows/` | recipe file + subrecipes |
| **Loop primitive** | `loop` node, frontmatter exit condition, max iterations (FR-E10, FR-E35, FR-E36) | JS `while` | iteration budget | `loop` phase | edges back | none |

## Where flowai-workflow Is Ahead

- **Engine as a controllable service.** The MCP server exposes
  `get_workflow`, `get_state`, `list_runs`, `tail_artifacts`,
  `start_run`, `resume_node`, `cancel_run`, `apply_workflow_patch`.
  A supervising agent can read a stuck run's artifacts, patch
  `workflow.yaml` by JSON Pointer, and resume it — without owning the
  process. No peer exposes graph mutation to an external agent;
  pi-workflows offers a viewer and `/workflow answer`, CC offers task
  tools over its own runs only. Evidence: FR-E73, FR-E84, FR-E85.
- **Continuation instead of restart.** A failed rule re-prompts the
  same agent session with the error, preserving context. goose reruns
  the whole attempt (`retry.checks` + `on_failure` cleanup); CC and pi
  leave remediation to the author. Cheapest recovery in the peer set.
  Evidence: FR-E1, `src/config/validate.ts:89-103`.
- **Write-leak guardrail.** Each agent node is bracketed by a snapshot
  of the main working tree, so a node writing outside its worktree is
  caught rather than silently merged. Peers isolate but do not audit
  the boundary. Evidence: FR-E50, FR-E51.
- **Runtime neutrality.** The only peer that drives more than one
  vendor's CLI (`claude`, `opencode` over ACP). Every pi-based peer is
  pi-only; CC Workflow is Claude-only; goose is goose-only (broad
  *model* choice, single *agent* implementation).
- **Declarative artifact contract.** Node outputs are Markdown files
  in `runs/<run-id>/<node-id>/`, wired by `{{input.<node-id>}}`.
  Inspectable and diffable without the engine; CC/pi pass values
  in-process.

## Where Peers Are Ahead

- **Parallelism.** `max_parallel > 1` is unsafe while all nodes of a
  run share one worktree (FR-E50), so the practical default is
  sequential. CC runs agents concurrently by default with an opt-in
  per-agent worktree; goose runs subrecipes in isolated worker
  processes; pi-taskflow has `parallel` and `map` phases. This is the
  largest functional gap.
- **Dynamic fan-out.** The graph is fixed at config load — no "one
  node per discovered item". CC's `pipeline()` takes a runtime list,
  pi-taskflow has `map`, pi-agents expands the graph dynamically.
  Common shape (review N files, migrate N call sites) is unexpressible
  without pre-writing N nodes.
- **Pre-run verification.** pi-taskflow verifies and compiles the
  graph to a canonical IR before execution; flowai-workflow validates
  schema and simulates with `--dry-run`, which catches config errors
  but not unreachable branches or contract mismatches between nodes.
- **Structured output.** Gating asserts file shape (existence,
  section, frontmatter field), not payload schema. CC forces a JSON
  Schema on the subagent and retries at the tool-call layer, so the
  orchestrator receives a validated object rather than a file to
  parse.
- **Composition.** No sub-workflow call. CC has `workflow()` for one
  nesting level; pi composes saved workflow nodes into the parent
  graph. flowai-workflow reuses only through `loop` body nesting.
- **Selection primitives.** pi-taskflow ships `tournament` and `race`
  phases (N attempts, pick the winner). Expressing a judge panel here
  means hand-wiring N agent nodes plus a merge.
- **Model breadth.** goose recipes bind any provider, including local
  models — the only peer that runs fully offline. flowai-workflow
  inherits whatever the two ACP runtimes support.

## Positioning

The defensible core is **run governance**: gating rules, continuation,
worktree guardrail, journal replay and an MCP control plane over live
runs. That combination targets unattended multi-hour runs a human
audits afterwards — the SDLC dogfood case.

The peers optimise a different axis. CC and pi optimise *fan-out
throughput* inside one vendor's harness; goose optimises *portability
across model providers*. Closing the parallelism and fan-out gaps
matters more than matching their node-kind counts.

## Candidate Follow-Ups

Not yet FRs — raise as issues with `scope: engine` before numbering:

- Per-node worktree (or copy-on-write scratch) so `max_parallel > 1`
  stops contradicting FR-E50.
- Data-driven fan-out node: expand one template node over a list
  produced by a predecessor artifact.
- Optional JSON-Schema rule type alongside the file rules, with
  the validated object exposed to `{{input.*}}`.
- Sub-workflow node invoking another workflow folder, budget and
  journal inherited.

## References

[^1]: Claude Code dynamic workflows — https://alexop.dev/posts/claude-code-workflows-deterministic-orchestration/, https://www.my2cents.ai/deep-dive/claude-code-workflows/
[^2]: `pi-agents` — https://www.npmjs.com/package/pi-agents
[^3]: Pi coding agent — https://mariozechner.at/posts/2025-11-30-pi-coding-agent/, https://github.com/badlogic/pi-mono (MIT)
[^4]: `pi-taskflow` — https://github.com/heggria/pi-taskflow
[^5]: `pi-workflows` — https://github.com/osolmaz/pi-workflows
[^6]: goose recipes — https://block.github.io/goose/docs/guides/recipes/, https://github.com/block/goose (Apache-2.0)
[^7]: goose subrecipes — https://block.github.io/goose/blog/2025/09/15/subrecipes-in-goose/
