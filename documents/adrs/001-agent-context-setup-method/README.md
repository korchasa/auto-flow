# ADR-001: Use `--system-prompt-file` for agent context setup

- **Status:** Accepted
- **Date:** 2026-03-17
- **Scope:** engine + sdlc

## Context

Engine invokes `claude -p` for each agent node. Agent instructions (SKILL.md)
must be injected into the Claude CLI session. Three methods were evaluated.

### Method A: `--append-system-prompt-file SKILL.md` (current)

SKILL.md appended to Claude Code's base system prompt (~6-8K tokens).

- Base prompt contains Sec 1-12: identity, tool usage, git protocol,
  permission rules, environment info.
- ~750 tokens useful for pipeline (Sec 5: parallel tools, Sec 7: concise
  output, Sec 12: context management).
- ~5-7K tokens dead weight or harmful:
  - "Ask user before proceeding" — no user in pipeline.
  - Git commit/PR protocol — conflicts with agent-specific git workflows.
  - Permission rules — disabled by `--dangerously-skip-permissions`.
  - Identity "helps users with software engineering tasks" — false for
    autonomous pipeline agents.

### Method B: `--system-prompt-file SKILL.md` (replace)

SKILL.md replaces base prompt entirely. Only SDK preamble remains
("You are a Claude agent, built on Anthropic's Claude Agent SDK").

- Eliminates dead context and conflicts.
- Loses useful Sec 5/7/12 content — must be duplicated in shared-rules.
- Execution parameters (`tools`, `permissionMode`, `model`) stay in
  pipeline.yaml where they belong — same agent can have different
  parameters in different pipeline nodes/phases.

### Method C: `--agent agent-file.md` (agent file)

Markdown file with YAML frontmatter. Body becomes system prompt (same as
replace). Frontmatter provides `model`, `tools`, `permissionMode`.

- Same context benefits as replace (no dead base prompt).
- **Problem: couples agent identity with execution parameters.** Frontmatter
  bakes `tools`/`permissionMode` into the agent file. But these are
  pipeline concerns, not agent identity:
  - Same Developer agent may need `tools: [Read,Grep]` in review phase
    and full toolset in implementation phase.
  - Same QA agent may run with `permissionMode: plan` in dry-run and
    `bypassPermissions` in full pipeline.
  - `model` may vary per pipeline node (sonnet for PM, opus for Architect)
    — already handled by pipeline.yaml `model` field.
- Agent files must live in `.claude/agents/` — filesystem coupling.
- `tools:` enforcement nullified by `--dangerously-skip-permissions`.

### Benchmark findings (2026-03-17)

Three methods tested with haiku on a multi-step analysis task (Glob → 3×Read
→ analyze → Write). Single run per method.

- **Behavioral difference: none observed.** All three produced correct
  artifacts, identical tool sequences (Glob+3×Read+Write, 13 turns).
- **`--agent` and `--system-prompt` both replace base system prompt** —
  confirmed via prompt introspection. Both leave only the SDK preamble.
- **`tools:` frontmatter did NOT restrict tools** when
  `--dangerously-skip-permissions` was active.

### Base system prompt analysis

Extracted from `@anthropic-ai/claude-code@2.1.76`:

- `--append-system-prompt` preserves all 12 sections (~6-8K tokens).
- `--system-prompt` and `--agent` both replace with SDK preamble only.
- Useful content that must be replicated in shared-rules:
  - Parallel tool calls (Sec 5).
  - Prefer Read/Glob/Grep over Bash (Sec 5).
  - Context compression awareness (Sec 12).

## Decision

Use `--system-prompt-file` for injecting agent instructions.

## Rationale

1. **Eliminates ~5-7K tokens of dead/harmful context** from base system
   prompt. No "ask user" conflicts, no git protocol conflicts, no dead
   permission rules.

2. **Clean separation of concerns.** SKILL.md = agent identity (who the
   agent is, what rules it follows). Pipeline.yaml = execution parameters
   (which tools, which model, which permissions, which phase). The same
   agent can be reused in different pipeline contexts with different
   parameters.

3. **No filesystem coupling.** `--system-prompt-file` takes any path.
   No need to manage `.claude/agents/` directory or symlink files.

4. **Simpler engine change.** Replace `--append-system-prompt-file` with
   `--system-prompt-file` in `buildClaudeArgs()`. One flag swap.

5. **`--agent` rejected** because it couples identity with execution
   parameters. `tools`/`permissionMode`/`model` in frontmatter are
   per-node concerns that may vary across pipeline phases for the same
   agent.

## Consequences

### C1. Engine flag swap (scope: engine)

- `buildClaudeArgs()` in `claude-process.ts`: replace
  `--append-system-prompt-file` with `--system-prompt-file`. Minimal diff.
- `promptFile`/`promptContent` field semantics change from "append" to
  "replace". Update `InvokeOptions` docs.
- `--resume` compatibility: verify that `--system-prompt-file` works with
  `--resume` (system prompt should be retained in session on resume,
  same as current `--append-system-prompt-file` behavior).

### C2. Unified task_template with `file()` (scope: sdlc)

With `--system-prompt-file` replacing the base prompt, shared-rules and
SKILL.md injection must be guaranteed. Current state: each agent SKILL.md
has a manual "read shared-rules.md" instruction — agents can skip it,
wasting a turn or ignoring rules entirely.

**Solution:** use existing `file()` template function in `task_template` to
inline both shared-rules and SKILL.md into the user message (`-p`).

```yaml
task_template: |
  {{file(".auto-flow/agents/shared-rules.md")}}
  ---
  {{file(".auto-flow/agents/agent-pm/SKILL.md")}}
  ---
  <existing task content>
```

- Remove `prompt` field from all 6 agent nodes in `pipeline.yaml`.
- Remove "BEFORE YOU DO ANYTHING — read shared-rules" block from all SKILL.md.
- Cross-refs to shared-rules sections (`per shared-rules.md § ...`) stay valid
  since content is now in context.
- Inline size: shared-rules (~76 lines) + SKILL.md (103-206 lines) + task
  (5-10 lines) = 184-292 lines per agent. No shell arg length issue (stdin).
- Rollback: if quality degrades from moving SKILL.md to user message — restore
  `prompt` field for SKILL.md, keep `file()` only for shared-rules.
- No engine code changes required. Uses existing `file()` in `engine/template.ts`.

Full spec: `documents/adrs/001-agent-context-setup-method/spec-unified-task-template.md`

### C3. Shared-rules content additions (scope: sdlc)

Add useful base prompt content lost after replacing system prompt:

- Parallel tool calls instruction (from base Sec 5).
- Prefer Read/Glob/Grep over Bash (from base Sec 5).
- Context compression awareness (from base Sec 12).

### C4. Prompt deduplication — duplicated rules automation (scope: engine + sdlc)

Analysis of 6 agent SKILL.md files (~1700 total lines) revealed ~600 lines
(35%) are duplicated rules across agents. 13 rule groups identified.
Automation eliminates prompt bloat and enforces rules at engine/config level
instead of advisory prompt text.

#### Tier 1 — Engine tool filtering (R1-R3): ~120 lines saved

- **R1: No Skill tool** (6/6 agents, ~90 lines). Engine strips `Skill` from
  available tools. Zero prompt text needed.
- **R2: No Agent tool** (4/6 agents, ~20 lines). Pipeline.yaml
  `disallowed_tools: [Agent]` per node. Engine removes before session.
- **R3: No ToolSearch** (3/6 agents, ~12 lines). Engine strips `ToolSearch`.

Implementation: pipeline.yaml `disallowed_tools` per node. Engine filters
tools before CLI invocation. Maps to `--disallowedTools` CLI flag.

#### Tier 2 — Shared prompt fragments (R4-R6, R8, R13): ~200 lines saved

- **R4: No Grep after Read** (5/6, ~75 lines). After Read(file), content is in
  context — do not Grep same file.
- **R5: One Read per file** (5/6, ~40 lines). No re-reads, no offset/limit
  re-reads.
- **R6: No offset/limit on Read** (4/6, ~20 lines). Always read full file.
- **R8: First-person voice** (6/6, ~60 lines). "I" in all narrative.
- **R13: `git add -f` for runs/** (2/6, ~8 lines).

Implementation: add `{{include "rules/fragment.md"}}` template support in
engine. Create 4-5 shared rule files in `.auto-flow/agents/rules/`. Each
SKILL.md replaces 10-20 lines with one include.

#### Tier 3 — Pipeline config + injection (R7, R9, R11): ~110 lines saved

- **R7: Scope-aware doc reads** (5/6, ~50 lines). Engine resolves scope from
  spec frontmatter, injects only relevant doc paths via `{{scope_docs}}`.
- **R9: Comment identification prefix** (6/6, ~24 lines). Pipeline.yaml
  `comment_prefix: "[PM · specify]"`. Engine injects into prompt.
- **R11: Reflection memory protocol** (6/6, ~36 lines). Pipeline.yaml
  `memory.path` + `memory.history`. Engine auto-injects paths + protocol ref.

#### Tier 4 — Engine enforcement hooks (R10, R12): ~100 lines saved

- **R10: Bash whitelist** (5/6, ~40 lines). Pipeline.yaml `bash_whitelist`.
  Engine pre-execution hook validates Bash commands.
- **R12: Allowed file modifications** (6/6, ~60 lines). Pipeline.yaml
  `allowed_files`. Engine post-Write/Edit hook blocks non-allowed paths.

Strongest guarantee (prompt rules = advisory; hooks = mandatory). Highest
implementation effort.

13 rule groups identified across 6 SKILL.md files (~1700 total lines, ~600
duplicated = 35%). See tiers below for automation plan.

### C5. CLI feature candidates for pipeline.yaml (scope: engine)

With `--system-prompt-file` as the injection method, additional CLI flags
become candidates for per-node pipeline.yaml config:

- **`--allowedTools` / `--disallowedTools`** — tool restrictions per node.
  Least-privilege. Maps to Tier 1 deduplication (C4).
- **`--effort <low|medium|high|max>`** — thinking depth per node. PM/QA = high,
  simple formatting = low. Token/time savings.
- **`--max-budget-usd`** — per-invocation spend cap. Guard against runaway
  agents. Needs budget-exhaustion handling in continuation logic.
- **`--permission-mode`** — replace blanket `--dangerously-skip-permissions`
  with granular modes. Verify `-p` compatibility.
- **`--worktree`** — isolated git worktree per agent. Unblocks real parallel
  execution (`max_parallel > 1`). Large effort.
- **`--fallback-model`** — auto-fallback on overload. Needs observability
  (detect + log fallback in stream-json).

All candidates need PoC validation in `-p --output-format stream-json` mode
before implementation. Create FR/issues only for validated candidates.

Full analysis: `documents/adrs/001-agent-context-setup-method/claude-features.md`

### Risks

- **Loss of base prompt Sec 5/7/12** — mitigated by C3 (shared-rules additions).
  Must verify completeness.
- **`--resume` behavior** with `--system-prompt-file` untested. If system
  prompt is not retained on resume, continuation logic breaks.
- **Single run benchmark** — behavioral equivalence not statistically
  confirmed. Monitor agent quality after migration.
- **SKILL.md in user message vs system prompt** (C2) — may affect instruction
  following. Rollback path defined.
- **Template expansion size** (C2) — 184-292 lines per `-p` call. No technical
  limit (stdin), but monitor context budget impact.
- **Tier 4 enforcement hooks** (C4) — highest effort, may delay other work.
  Implement after Tiers 1-3 prove value.

## Alternatives considered

- **`--append-system-prompt-file`** (status quo): rejected due to
  ~5-7K tokens of dead/conflicting base prompt content.
- **`--agent`**: rejected due to coupling agent identity with execution
  parameters. See Method C analysis above.

## Implementation Priority

1. **C1** (engine flag swap) — prerequisite for all others. Minimal diff.
2. **C3** (shared-rules additions) — immediate, no engine changes.
3. **C2** (unified task_template) — eliminates manual shared-rules reads.
4. **C4 Tier 1** (tool filtering) — quick win, ~120 lines saved.
5. **C4 Tier 2** (shared fragments) — requires engine `{{include}}` support.
6. **C5** (CLI features) — PoC validation first, then per-feature FRs.
7. **C4 Tiers 3-4** (config injection + hooks) — medium-to-high effort.

## References

- Benchmark data: `documents/adrs/001-agent-context-setup-method/benchmark/`
- Base prompt analysis: `documents/adrs/001-agent-context-setup-method/benchmark/base-system-prompt.md`
- Claude CLI flags: `documents/adrs/001-agent-context-setup-method/claude-prompt-params.md`
- Claude features analysis: `documents/adrs/001-agent-context-setup-method/claude-features.md`
- Unified task_template spec: `documents/adrs/001-agent-context-setup-method/spec-unified-task-template.md`
- Duplicated rules analysis: section C4 above
