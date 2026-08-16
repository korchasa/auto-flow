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
Agno/AgentOS, Letta (in-process agents); **Microsoft Conductor** (agents
are provider API calls — Copilot SDK, Claude API, Hermes, ACA — not
agent-CLI subprocesses). Excluded by rule 2: plain subagent delegation
(`Task` tool), Roo/Kilo orchestrator modes, **Claude Code Agent Teams**
(a lead model assigns work; no authored graph) [^13], Claude Squad, Vibe
Kanban, Emdash, Nimbalyst (UI/TUI dispatch, no workflow file) [^12].
Excluded by rule 3: Temporal, Hatchet, DBOS, Restate (durable
execution, no agent primitive). n8n/Dify/Flowise call model APIs, not
agent CLIs — adjacent, not peer.

**Format-relevant non-peers.** Conductor [^11] and Agent Framework
Declarative Workflows fail rule 1 but are the most developed *YAML
authoring surfaces* in this space; they are the reference for what a
mature declarative format contains (see Authoring Formats). `dagu` [^14]
is a general local-first YAML DAG runner that lists AI agents as one
step kind — adjacent, useful as a format precedent only.

## Peer Set

| Project | Control surface | Agent runtime | License |
|:--|:--|:--|:--|
| **flowai-workflow** | YAML DAG | `claude`, `opencode` via ACP | Private |
| Claude Code Workflow tool | JS script (`agent`/`parallel`/`pipeline`/`phase`) | Claude Code subagents | Proprietary [^1] |
| Bernstein | `bernstein.yaml` + `bernstein workflow` YAML DAG | 49–51 CLI adapters | Apache-2.0 [^8][^9] |
| `pi-agents` workflow tool | JSON node tree, 9 node kinds | pi subprocesses | MIT [^2][^3] |
| `pi-taskflow` | JSON / `.tf.ts` DSL → FlowIR, 12 phase kinds | pi subagents | MIT [^4] |
| `pi-workflows` | TS `defineWorkflow()` graph, 6 node kinds | pi conversation | MIT [^5] |
| goose recipes + subrecipes | YAML recipe tree | goose sessions, any provider | Apache-2.0 [^6][^7] |
| Baton | single `WORKFLOW.md` — YAML frontmatter + Jinja2 body | Claude Code, any CLI via `agent.command` | MIT [^10] |

## Authoring Formats

How each peer *writes down* a workflow. Ordered declarative → imperative.

- **flowai-workflow** — `<workflow>/workflow.yaml`. Static node map,
  `inputs:` edges, 4 node kinds. Transitions are engine rules, not
  authored: no `when:`, no branch. Escapes to imperative live in
  `{{bash()}}`, `before`/`after`, `prepare_command`,
  `custom_script`, HITL scripts. Templating: own `{{…}}` mini-language
  (`file`, `flow_file`, `bash`, `input.*`, `args.*`, `env.*`,
  `loop.iteration`).
- **Bernstein** — two surfaces. `bernstein.yaml` declares `goal`,
  `tasks[]` (title/role/priority/scope/complexity), `role_model_policy`
  (per-role `cli` + `model` + `effort`), storage, tuning, provider
  fallback `chain`, bridges. Separately `bernstein workflow` runs a
  "declarative YAML DAG of agent / command / loop nodes", validated
  up-front and dispatched through the same spawner. Same shape as ours,
  reached independently.
- **goose** — one recipe YAML: `title`, `description`,
  `instructions`/`prompt`, `parameters[]` (typed:
  string/number/boolean/date/file/select, `requirement`,
  `default`, `options`), `extensions[]`, `settings`, `sub_recipes[]`
  (`name`/`path`/`values`/`sequential_when_repeated`), `response.json_schema`,
  `retry` (`max_retries`, `checks[].type: shell`, `on_failure`,
  `timeout_seconds`). Jinja templating with `{% extends %}` /
  `{% block %}` inheritance and filters. No DAG, no conditions —
  composition is the subrecipe tree; subrecipes run parallel unless
  pinned sequential.
- **Baton** — a single `WORKFLOW.md`: YAML frontmatter (tracker
  filters, poll interval, concurrency, max turns, `agent.command`)
  plus a Jinja2 prompt body referencing `issue.number`, `issue.title`.
  No graph at all — the pipeline (poll → worktree → agent → PR) is
  fixed in code; the file only parameterises it. Closest analogue of
  our `github-inbox`, minus the DAG.
- **`pi-agents`** — JSON passed to a `workflow` tool. A *tree*, not an
  edge list: nodes nest recursively (a `sequence` holds `fork` nodes, a
  `loop` body is a `sequence`). 9 node kinds. Budgets bound the run
  (`max depth`, `max parallelism`, `max iterations`).
- **`pi-taskflow`** — JSON or `.tf.ts` DSL → validated → canonical
  **FlowIR + content hash**. Positioning is explicit: "not a workflow
  you script, but a DAG you declare: statically verified before it
  runs". 12 phase kinds in 4 groups: work (`agent`, `parallel`, `map`,
  `reduce`, `script`), control (`gate`, `approval`, `flow`, `loop`),
  selection (`tournament`, `race`), dynamic (`expand` — validates and
  executes a runtime-produced grafted fragment). Side effects are
  *declared* in the flow contract (`effects[]` with `kind`, `target`,
  `confidentiality`, `integrity`) and routed through a transaction
  authority — the agent proposes content, it is not the mutation
  authority. Closest peer to our design intent, one generation ahead.
- **`pi-workflows`** — `.pi/workflows/*.workflow.ts`,
  `defineWorkflow({name, presentationPrompt, startAt, nodes, edges})`.
  6 node kinds (agent/compute/notify/action/checkpoint/decision);
  `decisionEdge` gives compile-time case checking. TypeScript is the
  schema.
- **Claude Code Workflow tool** — a JS script, but hybrid: a mandatory
  `export const meta = {name, description, phases}` that MUST be a pure
  literal (no variables, calls, spreads), so name/description/phases are
  readable *without executing the script* — that is what the permission
  dialog and the progress tree consume. Body is imperative over
  `agent()`, `parallel()`, `pipeline()`, `phase()`, `workflow()`. The
  script runs in a hermetic isolate: no filesystem, no Node APIs, and
  `Date.now()`/`Math.random()`/`new Date()` throw because they would
  break replay.

**Adjacent but format-relevant — Microsoft Conductor** (MIT, opened
2026-05): the most complete declarative YAML in this space. Worth
reading before extending our schema. `workflow:` block with
`entry_point`, `limits` (`max_iterations`, `timeout_seconds`,
`budget_usd`, `budget_mode: audit|enforce`), `context_mode:
accumulate|snapshot|minimal`, `runtime` (provider, model, `checkpoint.every_agent`,
`mcp_servers`), typed `input:`/`output:`. 8 step types: `agent`,
`human_gate`, `questions`, `script`, `workflow` (sub-workflow with
`input_mapping` + `max_depth`), `wait`, `set` (pure Jinja2 compute, no
LLM), `terminate`. Per-node `output:` schema with `enum`/`pattern`/
`minimum`/`maxLength`/`nullable`, plus a rubric `validator`.
Transitions are authored: `routes: [{to, when}]`, first match wins,
`$end` as sink. `parallel:` groups with
`failure_mode: fail_fast|continue_on_error|all_or_nothing`;
`for_each:` groups with `source`, `as`, `max_concurrent`, `key_by` —
dynamic fan-out over a runtime array. `conductor validate` checks
syntax pre-run.

## Feature Matrix

| Axis | flowai-workflow | CC Workflow | pi-agents | pi-taskflow | pi-workflows | goose |
|:--|:--|:--|:--|:--|:--|:--|
| **Authoring** | YAML, declarative | JS, imperative | JSON graph | JSON/TS → IR | TS graph | YAML recipe |
| **Execution** | toposort → levels | script order | graph walk | phase DAG | node+edge walk | parent → subrecipes |
| **Node kinds** | 4: agent, merge, loop, human | primitives, not nodes | 9 | 12 (work/control/selection/dynamic) | 6 | recipe, subrecipe |
| **Transitions** | engine rules, YAML-fixed | JS control flow | recursive nesting (tree, not edge list) | declared deps/conditions | edges, `decisionEdge` | parent prompt |
| **Runtime lock** | 2 runtimes; `cursor` rejected (FR-E77) | Claude Code only | pi only | pi only | pi only | goose only |
| **Model per node** | `model` + `effort` (FR-E12, FR-E42) | per `agent()` | frontmatter | per phase | per node | per recipe |
| **Output gating** | 6 rule types: `file_exists`, `file_not_empty`, `contains_section`, `custom_script`, `frontmatter_field`, `artifact` (composite: sections + required frontmatter `fields`, FR-E38) | JSON Schema on `agent()` | node JSON contract | gate phase + declared output contract | decision node (fixed options) | `response.json_schema` + `retry.checks` (shell) |
| **On gate failure** | continuation — same session re-prompted with error context (FR-E1), `max_continuations` default 3 | schema mismatch retried at the tool-call layer; no artifact-level continuation — author re-calls | edge to remediation node | retry/gate policy | edge branch | full attempt restart, `on_failure` cleanup |
| **Resume** | `--resume <run-id>`, journal replay (FR-E69), completed nodes skipped | `resumeFromRunId`, longest unchanged prefix cached | run history | persistence for resume | durable queue; close = park, not cancel | session resume; no graph-level resume |
| **Isolation** | per-run git worktree (FR-E57) + main-tree leak guardrail (FR-E50) + rescue branch (FR-E51) | opt-in per-agent worktree | subprocess context | workspace isolation | per-node context | subrecipe session isolation (no shared history/memory) |
| **Parallelism** | opt-in `max_parallel`, unsafe > 1 under FR-E50 | default, cap `min(16, cpus-2)` | budgeted `max_parallelism` | parallel + map phases | graph-parallel | isolated worker processes |
| **Dynamic fan-out** | none — graph static, 4 node kinds (`src/types.ts:183`) | `pipeline()` over runtime list | dynamic expansion | `map` phase | none | subrecipe list |
| **Static verification** | schema load + `--dry-run` + drift detection (FR-E7, FR-E13) | `meta` literal (name/description/phases) readable without executing the script; body itself not analysable | budget preflight | `taskflow_verify` / `taskflow_compile` before run | type-checked TS | schema validation |
| **HITL** | `human` node type + agent-initiated HITL on both runtimes (FR-E8, FR-E75) | none | checkpoint node | approval phase | checkpoint node, `/workflow answer <json>` | none first-class |
| **External control API** | embedded MCP server, 9 tools incl. graph mutation (FR-E73/E84/E85) | host task tools only | none | 20 MCP tools (`plan`, `verify`, `trace`, `replay`, `why_stale`, `recompute`, `why_effect`, `analytics`) — read/analyse, graph mutation deliberately refused | `/workflow` slash commands + `piw` viewer | CLI + scheduler |
| **Cost accounting** | aggregate cost/duration per run (FR-E17, FR-E22), budget cap (FR-E47) | token budget in script (`budget.remaining()`) | budgets | budgets | none | per-session |
| **Portability unit** | workflow folder — `git mv` and it runs elsewhere | `.claude/workflows/*.js` | agent md + graph JSON | flow file | `.pi/workflows/` | recipe file + subrecipes |
| **Loop primitive** | `loop` node, frontmatter exit condition, max iterations (FR-E10, FR-E35, FR-E36) | JS `while` | iteration budget | `loop` phase | edges back | none |

**Bernstein on these axes** (kept out of the table for width). Node
kinds: agent / command / loop. Transitions: declarative YAML DAG,
validated up-front. Runtime lock: none — 49–51 wired adapters (Claude
Code, Codex, Gemini CLI, Copilot CLI, Cursor, Aider, Goose, OpenCode,
OpenHands, Amp, Ollama, …) plus a generic wrapper for any tool taking
`--prompt`. Isolation: one git worktree per task, default-on, so
parallelism is the default rather than an unsafe opt-in. Resume /
determinism: no model in the coordination loop, so runs replay
byte-identically; `replay list`, `replay latest --verify`, `lineage
verify <run_id>`; non-determinism surfaces as a hash mismatch at the
exact step. Audit: opt-in HMAC chain + Ed25519-signed run receipt
binding journal head and lineage head, verifiable offline by a
reviewer with just the file and a public key; `bench run --reliability
k` seals a `pass^k` floor. Verification gates: a "Janitor" checks
tests, lint, types, PII before merge. Deployment: cluster mode,
air-gap, file-based state. Status: beta, solo-maintained.

**Baton on these axes**: no graph — fixed poll → worktree → agent → PR
pipeline; concurrency via a dispatcher; a reconciler detects stale
runs; multi-turn retries. It is our `github-inbox` use case shipped as
a product with the DAG removed.

## Where flowai-workflow Is Ahead

- **Graph mutation from outside the process.** The MCP server exposes
  `get_workflow`, `get_state`, `list_runs`, `tail_artifacts`,
  `start_run`, `resume_node`, `cancel_run`, `apply_workflow_patch`.
  A supervising agent can read a stuck run's artifacts, patch
  `workflow.yaml` by JSON Pointer, and resume it — without owning the
  process. Narrower than first claimed: pi-taskflow ships a *larger*
  external surface (20 MCP tools) and refuses graph mutation by
  design, on the argument that an agent proposing content must not
  become the mutation authority. So the differentiator is the
  mutation itself, not the control plane — and it is a deliberate
  disagreement with the closest peer, worth re-deciding rather than
  claiming as a win. Evidence: FR-E73, FR-E84, FR-E85.
- **Continuation instead of restart.** A failed rule re-prompts the
  same agent session with the error, preserving context. goose reruns
  the whole attempt (`retry.checks` + `on_failure` cleanup); CC and pi
  leave remediation to the author. Cheapest recovery in the peer set.
  Evidence: FR-E1, `src/config/validate.ts:89-103`.
- **Write-leak guardrail.** Each agent node is bracketed by a snapshot
  of the main working tree, so a node writing outside its worktree is
  caught rather than silently merged. True against the pi peers, CC and
  goose. NOT true against Bernstein, which audits the boundary harder:
  Janitor pre-merge gates, an always-on lineage spine, and an offline
  reviewer-verifiable signed receipt. Evidence: FR-E50, FR-E51.
- **Declarative artifact contract.** Node outputs are Markdown files
  in `runs/<run-id>/<node-id>/`, wired by `{{input.<node-id>}}`.
  Inspectable and diffable without the engine; CC/pi pass values
  in-process.

## Where Peers Are Ahead

- **Parallelism.** `max_parallel > 1` is unsafe while all nodes of a
  run share one worktree (FR-E50), so the practical default is
  sequential. Bernstein makes one worktree *per task* the default and
  parallelism falls out of it; CC runs agents concurrently by default
  with an opt-in per-agent worktree; goose runs subrecipes in isolated
  worker processes; pi-taskflow has `parallel` and `map` phases;
  Conductor's `parallel:` groups hand each member an immutable context
  snapshot and carry a `failure_mode`. This is the largest functional
  gap, and every peer has solved it.
- **Conditional transitions.** We have none: edges come from `inputs:`
  and the only branch is `run_on: always|success|failure`. Conductor
  authors them directly — `routes: [{to, when}]` with a Jinja2
  predicate, first match wins, `$end` as sink — plus a `set` step for
  pure computation between agents and `terminate` for early exit. This
  is the cheapest gap to close and it is not on our list yet.
- **Dynamic fan-out.** The graph is fixed at config load — no "one
  node per discovered item". CC's `pipeline()` takes a runtime list,
  pi-taskflow has `map` plus `expand` for runtime-grafted fragments,
  pi-agents nests dynamically, Conductor's `for_each` takes `source`,
  `as`, `max_concurrent` and `key_by`. Common shape (review N files,
  migrate N call sites) is unexpressible without pre-writing N nodes.
- **Runtime breadth.** Two ACP runtimes against Bernstein's 49–51
  wired adapters plus a generic `--prompt` wrapper. Previously recorded
  here as *our* advantage; that was wrong. goose additionally binds any
  model provider including local ones, so it is the only peer that runs
  fully offline.
- **Pre-run verification.** pi-taskflow verifies and compiles the
  graph to a canonical IR with a content hash before execution and
  offers `taskflow_plan` for agent-call bounds; Conductor ships
  `conductor validate`. flowai-workflow validates schema and simulates
  with `--dry-run`, which catches config errors but not unreachable
  branches or contract mismatches between nodes.
- **Replay as a correctness proof.** Bernstein keeps no model in the
  coordination loop, so a rerun is byte-identical and divergence
  surfaces as a hash mismatch at a named step; CC caches the longest
  unchanged prefix of `agent()` calls. Our `journal.jsonl` (FR-E69)
  already records the facts needed for this, but replay is used for
  state reconstruction only, not verification.
- **Structured output.** Gating asserts file shape (existence,
  section, frontmatter field), not payload schema. CC forces a JSON
  Schema on the subagent and retries at the tool-call layer; goose has
  `response.json_schema`; Conductor declares a per-node `output:`
  schema with `enum`/`pattern`/bounds/`nullable` *and* a rubric
  `validator` with its own model and retry count. All of them hand the
  next step a validated object rather than a file to parse.
- **Composition.** No sub-workflow call. CC has `workflow()` for one
  nesting level; pi composes saved workflow nodes into the parent
  graph; Conductor has a `workflow` step type with `input_mapping` and
  `max_depth`, and merges child spend into the parent budget; goose
  nests subrecipes with value passing. flowai-workflow reuses only
  through `loop` body nesting.
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

Bernstein contests exactly that core and, on the audit axis, holds
more ground (signed offline-verifiable receipts, byte-identical
replay, air-gap deploy). What is left as genuinely ours: continuation
inside a live agent session, agent-initiated HITL across runtimes, and
an external control plane that permits graph mutation. The rest of the
peers optimise a different axis — CC and pi optimise *fan-out
throughput* inside one vendor's harness, goose optimises *portability
across model providers*.

**Format finding.** The declarative-YAML choice is not the weakness.
Bernstein reached the same shape independently ("declarative YAML DAG
of agent / command / loop nodes"), pi-taskflow markets declarativeness
as the feature ("not a workflow you script, but a DAG you declare"),
and Microsoft moved agent orchestration *out of code into* declarative
YAML. No peer wins on authoring language. Our YAML is simply
under-featured: it lacks conditional transitions, dynamic fan-out,
sub-workflows and payload schemas that every mature peer has. Closing
those matters more than switching format.

## Candidate Follow-Ups

Not yet FRs — raise as issues with `scope: engine` before numbering.
Ordered by cost/benefit; the first two are the standing gaps, the rest
come from this comparison:

- Per-node worktree (or copy-on-write scratch) so `max_parallel > 1`
  stops contradicting FR-E50. Every peer has this; Bernstein makes it
  the default.
- Data-driven fan-out node: expand one template node over a list
  produced by a predecessor artifact. Reference shapes: Conductor
  `for_each` (`source`/`as`/`max_concurrent`/`key_by`/`failure_mode`),
  pi-taskflow `map`.
- Conditional transitions: an authored `when:` predicate on an edge,
  first match wins, with an explicit end sink. Reference: Conductor
  `routes:`. Consider a no-LLM compute step (`set`) and an early-exit
  step (`terminate`) alongside it — both remove agent nodes that exist
  only to move a value.
- Optional JSON-Schema rule type alongside the file rules, with
  the validated object exposed to `{{input.*}}`.
- Sub-workflow node invoking another workflow folder, budget and
  journal inherited. Reference: Conductor `type: workflow` with
  `input_mapping` + `max_depth`.
- Decide explicitly whether `apply_workflow_patch` stays. pi-taskflow
  refuses external graph mutation on principle; we allow it. Either
  position is defensible, but it should be a recorded decision, not an
  accident.
- Replay as verification, not just reconstruction: recompute the
  journal head and name the first divergent step. Reference:
  `bernstein replay latest --verify`.

## References

[^1]: Claude Code dynamic workflows — https://alexop.dev/posts/claude-code-workflows-deterministic-orchestration/, https://www.my2cents.ai/deep-dive/claude-code-workflows/
[^2]: `pi-agents` — https://www.npmjs.com/package/pi-agents
[^3]: Pi coding agent — https://mariozechner.at/posts/2025-11-30-pi-coding-agent/, https://github.com/badlogic/pi-mono (MIT)
[^4]: `pi-taskflow` — https://github.com/heggria/pi-taskflow
[^5]: `pi-workflows` — https://github.com/osolmaz/pi-workflows
[^6]: goose recipes — https://goose-docs.ai/docs/guides/recipes/recipe-reference/, https://github.com/block/goose (Apache-2.0)
[^7]: goose subrecipes — https://block.github.io/goose/docs/guides/recipes/subrecipes/
[^8]: Bernstein — https://github.com/sipyourdrink-ltd/bernstein, https://bernstein.run/ (Apache-2.0)
[^9]: Bernstein config reference — https://bernstein.readthedocs.io/en/latest/operations/CONFIG/
[^10]: Baton — https://github.com/mraza007/baton (MIT)
[^11]: Microsoft Conductor — https://github.com/microsoft/conductor/blob/main/docs/workflow-syntax.md, https://opensource.microsoft.com/blog/2026/05/14/conductor-deterministic-orchestration-for-multi-agent-ai-workflows/ (MIT; adjacent — provider APIs, not agent CLIs)
[^12]: Open-source orchestrator survey (Emdash, Claude Squad, Vibe Kanban, Nimbalyst, Agent Kanban) — https://www.augmentcode.com/tools/open-source-agent-orchestrators
[^13]: Claude Code Agent Teams — https://code.claude.com/docs/en/agent-teams
[^14]: `dagu` — https://github.com/dagucloud/dagu
