# Ideas for flowai-workflow

Backlog of cross-pollination ideas, primarily inspired by
[breaking-brake/cc-wf-studio](https://github.com/breaking-brake/cc-wf-studio)
(visual editor → Markdown-compiled DAG executed by Claude Code).

Each entry: rationale + concrete integration shape + rough effort.

---

## 1. Visual editor for workflow.yaml (React Flow)

- **Why**: YAML graphs are hard to read; debugging needs eyeballing topology.
- **What**: React-Flow canvas that round-trips `workflow.yaml ↔ graph`. Even a
  read-only render (open file → see DAG) accelerates onboarding and review.
- **Surface**: standalone web app or VS Code extension over our embedded MCP.
- **Effort**: weeks. Largest item here; treat as separate subproject.

## 2. Auto-rendered Mermaid flowchart from the DAG

- **Why**: durable artifact for README, PR descriptions, run diagnostics.
- **What**: `flowai-workflow render <workflow>` CLI + a phase that writes
  `runs/<run-id>/flowchart.md` right after `loadConfig`.
- **Reference**: their `generateMermaidFlowchart` (~220 lines, pure Markdown
  emit; handles subgraphs/branches/labels on edges).
- **Effort**: 1–2 days.

## 3. Embedded MCP server over the engine

- **Why**: makes the engine controllable by any agent (Claude/Codex/Cursor).
  Aligns with FR-E59/E60/E61 host-embedding direction.
- **Tools to expose**: `get_workflow`, `get_state`, `list_runs`,
  `tail_artifacts`, `resume_node`, `cancel_run`, `apply_workflow_patch`,
  `provide_human_input` (FR-E75: local HITL answer channel).
- **Effort**: 2–4 days; reuses existing `Engine.run()` + `state.json`.
- **Priority**: HIGH — best benefit-to-cost ratio.

## 4. JSON Schema for workflow.yaml + TOON variant for LLMs

- **Why**: IDE autocomplete; LLM-assisted authoring with grounded structure;
  fewer broken configs from PM/Architect agents.
- **What**: ship `contracts/workflow.schema.json` (JSON Schema) for editors,
  plus a TOON-formatted derivation for system prompts of agents that generate
  configs.
- **Effort**: 1–2 days (schema), +1 day (TOON).

## 5. Migration layer for stored configs (`migrateWorkflow`)

- **Why**: schema drift between versions silently breaks old runs and
  workflow.yaml files. Agent reflection memory (FR-E52 incident) proved we
  need explicit migrations.
- **What**: `migrateWorkflow(parsed)` chain run on every `loadConfig` and
  every `resume`; bumps `schemaVersion` field; logs applied migrations.
- **Effort**: 1 day for skeleton + per-bump migration as needed.
- **Priority**: HIGH.

## 6. Split `agentDefinition` (role) from `prompt` (task)

- **Why**: today `agent-*.md` mixes “who the agent is” with “what to do this
  turn”. Reusable definitions get tangled with node-specific instructions.
- **What**: mirror their `SubAgentData` split — `agentDefinition` lives in
  the canonical .md body; per-node `prompt` is overlaid by the engine.
- **Effort**: 2–3 days; touches every agent file in `.flowai-workflow/*/`.

## 7. Sub-workflow / SubAgentFlow node type

- **Why**: flat DAGs force duplication; composition needs scripting today.
- **What**: new `subworkflow` node type; engine expands it into the parent
  DAG at load time. Stays within existing `agent/merge/loop/human` taxonomy.
- **Effort**: 3–5 days (expansion, validation, artifact namespacing).

## 8. Typed HITL: `AskUserQuestion` with options / multi-select / AI-suggested

- **Why**: current `human` node is free-form text; no DAG-level branching by
  user choice.
- **What**: `AskUserQuestionData = { questionText, options[], multiSelect?,
  useAiSuggestions? }` with output ports indexed by option id. Generates
  Claude `AskUserQuestionTool` invocation in prompt.
- **Effort**: 2–3 days.

## 9. Validation of generated artifacts before agent invocation

- **Why**: today engine sends prompts as-is; a broken `agent-*.md` (missing
  frontmatter, bad UTF-8) only shows up as a confusing CLI failure.
- **What**: port their `validateClaudeFileFormat` — UTF-8 check, YAML
  frontmatter required keys (`name`, `description`, `model`), non-empty body.
- **Effort**: half day.

## 10. Persisted session ID for iterative runs

- **Why**: re-running a workflow today cold-starts every agent. Their
  `conversationHistory.sessionId` continues the same Claude Code session
  across iterations → warmer prompt cache, preserved context.
- **What**: store per-node `sessionId` in `state.json`; on resume, pass
  `--resume <id>` (or equivalent) to the CLI wrapper.
- **Effort**: 2 days; depends on `@korchasa/ai-ide-cli` exposing the flag.

## 11. Multi-provider export through one generator with `provider` param

- **Why**: `github-inbox/` and `github-inbox-opencode/` duplicate agent
  prompts; drift is inevitable. Their `generateExecutionInstructions(workflow,
  {provider})` parametrises tool names per provider (`Bash` vs
  `#runInTerminal` vs `shell` vs `execute_command`).
- **What**: single source-of-truth prompt template + provider tokens; remove
  per-provider workflow folder duplication.
- **Effort**: 3–4 days; significant refactor of `.flowai-workflow/*/agents/`.

## 12. Spec-driven layout: `specs/<id>-<slug>/` for epics

- **Why**: chronological `documents/tasks/<YYYY>/<MM>/` is fine for small
  tasks; epics need a folder with `spec.md`, `data-model.md`, `contracts/`,
  `tasks.md` (cc-wf-studio convention).
- **What**: hybrid model — keep monthly buckets for small tasks; promote
  epics to `documents/epics/<slug>/`.
- **Effort**: half day (convention + skill update).

## 13. VS Code integration: “Run workflow” button + status panel

- **Why**: lower-friction local iteration; visible stdout in IDE panel.
- **What (min)**: `.vscode/tasks.json` + launch-config that runs
  `deno task run` for a chosen workflow.
- **What (max)**: thin VS Code extension speaking to the embedded MCP server
  (idea #3) for canvas + live run timeline.
- **Effort**: half day (min) / 1–2 weeks (max).

## 14. Active-node highlight as a telemetry channel

- **Why**: cheap live visualisation of an in-flight run; useful for
  `scripts/dashboard`.
- **What**: engine writes `currentNodeId` to `runs/<run-id>/state.json`
  (already partially there) and emits the same event via SSE/websocket for
  any subscriber (dashboard, VS Code extension, MCP client).
- **Effort**: 1 day for state field + emit; UI consumers separate.

---

## Priority shortlist (best benefit-to-cost)

1. **#3 MCP facade over the engine** — unlocks agent-driven control of runs.
2. **#2 Mermaid auto-render** — instant docs/diagnostics win.
3. **#5 Config migrations** — prevents silent breakage on schema bumps.

Largest product impact: **#1 (visual editor)** — but it is a separate
multi-week subproject and should be scoped as its own epic.
