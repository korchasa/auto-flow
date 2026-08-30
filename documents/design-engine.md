# SDS: Engine — Index

Design specification for the domain-agnostic DAG executor engine. Split
across section files in [design-engine/](design-engine/) to fit within the
`Read` tool's 10k-token limit (working budget ~8k tokens per file).

## Sections

- [00-intro.md](design-engine/00-intro.md) — §1 Intro, §2 Architecture
  (Configurable node engine overview, scope boundary).
- [01-engine-modules-core.md](design-engine/01-engine-modules-core.md) —
  §3.1 first half: `types.ts`, `template.ts`, `config.ts`, `dag.ts`,
  `validate.ts`, `state.ts`, IDE-CLI wrapper layer,
  `@korchasa/ai-ide-cli/runtime`, `agent.ts`.
- [02-engine-modules-flow.md](design-engine/02-engine-modules-flow.md) —
  §3.1 second half: `@korchasa/ai-ide-cli/opencode/process`, `loop.ts`,
  `hitl.ts`, `commands.ts`, `human.ts`, `scope-check.ts`, `output.ts`,
  `node-dispatch.ts`, `engine.ts`, `cli.ts`, `mod.ts`, interfaces, node
  flags, verbose output pattern, ACP invoke-option filter (FR-E98).
- [03-subsystems.md](design-engine/03-subsystems.md) — §3.2 Phase Registry,
  §3.3 Process Registry, §3.4 Binary Distribution, §3.5 Shared Backoff,
  Binary Compile Script, §3.6 Release CI Workflow, FR-E94 static workflow
  diagram generator.
- [04-data-and-logic.md](design-engine/04-data-and-logic.md) — §4 Data
  (entities, inter-node data flow, validation rules), §5 Logic (all
  algorithms, template resolution, error-handling precedence).
- [05-mcp-server.md](design-engine/05-mcp-server.md) — §5 Logic for the
  embedded MCP server (FR-E73): bootstrap, nine tool handlers (incl.
  FR-E84 `start_run`), transport selection, error mapping.
- [06-non-functional-and-constraints.md](design-engine/06-non-functional-and-constraints.md) — §6
  Non-Functional, §7 Constraints.
- [07-graph-and-isolation.md](design-engine/07-graph-and-isolation.md) —
  Design for the peer-comparison additions FR-E87..FR-E93: shell-predicate
  loop exit, command node, conditional edges, data-driven fan-out, per-node
  worktree, journal hash chain, HITL node type.
- [08-fork-join.md](design-engine/08-fork-join.md) — Design for FR-E95..FR-E97:
  explicit fork/join and branch membership, captured node answers and the
  branch manifest, readiness scheduling with the rolling group guardrail.
