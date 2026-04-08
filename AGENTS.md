# Core Project Rules
- Follow your assigned role strictly — it defines scope and boundaries for your actions.
- After finishing a session, review all project documents(readme.md, requirements.md, design.md, etc) to ensure they reflect the current state. Stale docs mislead future sessions.
- Verify every change by running appropriate tests or scripts — never assume correctness without evidence.
- Keep the project in a clean state: no errors, warnings, or issues in formatter and linter output. A broken baseline blocks all future work.
- Follow the TDD flow described below. Skipping it leads to untested code and regressions.
- Write all documentation in English, compressed style. Brevity preserves context window.
- If you see contradictions in the request or context, raise them explicitly, ask clarifying questions, and stop. Do not guess which interpretation is correct.
- Code should follow "fail fast, fail clearly" — surface errors immediately with clear messages rather than silently propagating bad state. Unless the user requests otherwise.
- When editing CI/CD pipelines, always validate locally first — broken CI is visible to the whole team and slow to debug remotely.
- When editing workflow config, always check locally first.
- Before running `deno task run`, commit or stash all local changes.
  Engine's safety check treats uncommitted diffs as out-of-scope modifications.
- Provide evidence for your claims — link to code, docs, or tool output. Unsupported assertions erode trust.
- Use standard tools (jq, yq, jc) to process and manage structured output — they are portable and well-understood.
- Do not add fallbacks, default behaviors, or error recovery silently — if the user didn't ask for it, it's an assumption. If you believe a fallback is genuinely needed, ask the user first.
- Do not use tables in chat output — use two-level lists instead. Tables render poorly in terminal and are harder to scan.
- Be precise in your wording. Use a scientific approach. Accompany highly
  specialized terms and abbreviations with short hints in parentheses.

---

## Project Information
- Project Name: flowai-workflow

## Project Vision

Universal DAG-based engine for orchestrating AI agents. Define agent workflows
as YAML configs — engine handles execution, inter-agent communication,
validation, loops, and resume. Domain-agnostic: no git/GitHub/SDLC logic in
engine; any workflow expressible as a DAG of agent/merge/loop/human nodes.

The engine is developed using its own SDLC workflow (dogfooding): a chain of
specialized AI agents (PM, Architect, Tech Lead, Developer, QA, Tech Lead
Review) that automates the full development lifecycle from GitHub Issue to
merged PR. This workflow serves as both the development method and a reference
example of engine usage.

## Project tooling Stack

- Deno (scripting, utilities, validation, task runner, workflow engine)
- Shell/Bash (legacy stage orchestration scripts)
- Docker (devcontainer runtime environment)
- Claude Code CLI (`claude`) (AI agent runtime)
- `gh` CLI (GitHub API interaction: PRs, issue comments)
- Git (version control, branch management, diff-based safety checks)

## Architecture

- **Core:** Domain-agnostic DAG executor engine (`engine/`, Deno/TypeScript).
  Reads YAML workflow configs. Entry: `deno task run [--prompt "..."]`
- **Node types:** `agent` (Claude CLI), `merge` (combine outputs), `loop`
  (iterative body with exit condition), `human` (terminal prompt)
- **Inter-agent communication:** Structured artifacts in
  `<runs-dir>/<run-id>/<node-id>/`, linked via `{{input.<node-id>}}` templates
- **Execution:** DAG topological sort into levels; nodes execute sequentially
  (parallel execution deferred)
- **Continuation:** Re-invoking agents within same session on validation failure
  (max N per node)
- **Resume:** Failed/interrupted runs resumable via `--resume <run-id>`;
  completed nodes skipped based on `state.json`
- **Observability:** 3 verbosity levels (`-q`/default/`-v`); status lines with
  timestamps; final summary
- **SDLC workflow (example):** `.flowai-workflow/workflow.yaml` — 6 agents automating
  full development lifecycle. Agents in `.claude/agents/agent-*.md` (native Claude Code
  subagents). Memory in `.flowai-workflow/memory/`
- **Docker image:** Single image with claude CLI, deno, git, gh

## Scope Separation

Two scopes with strict boundary:

- **Engine** (`scope: engine`) — domain-agnostic DAG executor (`engine/`).
  Node types, validation, continuation, resume, HITL, CLI, templates.
  SRS: `documents/requirements-engine.md`. SDS: `documents/design-engine.md`.
  GitHub label: `scope: engine`.
- **SDLC Workflow** (`scope: sdlc`) — example workflow using the engine.
  Agents, prompts, GitHub workflow, dashboard, devcontainer.
  SRS: `documents/requirements-sdlc.md`. SDS: `documents/design-sdlc.md`.
  GitHub label: `scope: sdlc`.

FR numbering: `FR-E<N>` (engine), `FR-S<N>` (SDLC). Existing `FR-<N>` kept
as aliases during migration.

## GitHub Issue Rules

- **Title prefix:** `engine:`, `sdlc:`, or `engine+sdlc:`. Mandatory.
- **Labels:** Every issue MUST have scope label(s):
  - Single scope: `scope: engine` or `scope: sdlc`.
  - Mixed: both `scope: engine` AND `scope: sdlc`.
- **FR reference:** If issue relates to an existing FR, include `FR-E<N>` or
  `FR-S<N>` in the title or body.
- **When to use `engine+sdlc:`:** Refactoring, documentation, or infra tasks
  that touch both scopes and cannot be meaningfully split (e.g., cross-cutting
  rename, shared tooling changes). Prefer separate issues when scopes are
  independent.

## Key Decisions

- **Engine is domain-agnostic:** Generic DAG executor. MUST NOT contain git,
  GitHub, branch, PR, or any domain-specific logic. All domain workflows are
  implemented exclusively via agent nodes wired in workflow YAML configs
- **Engine is workflow-independent:** MUST NOT depend on any specific workflow
  config. One engine, many workflows. Engine code must not reference concrete
  node names, artifact filenames, or workflow structure
- Agents are stateless — all context from file artifacts and system prompts
- YAML workflow config defines node graph; no hardcoded stage order
- Artifacts stored per-run for isolation
- SDLC workflow specifics (diff safety checks, etc.)
  are workflow-level concerns, not engine-level

## Documentation Hierarchy
1. **`AGENTS.md`**: Project vision, constraints, mandatory rules. READ-ONLY reference.
2. **SRS** (`documents/requirements-engine.md`, `documents/requirements-sdlc.md`): "What" & "Why". Source of truth for requirements.
3. **SDS** (`documents/design-engine.md`, `documents/design-sdlc.md`): "How". Architecture and implementation. Depends on SRS.
4. **Whiteboards** (`documents/whiteboards/<YYYY-MM-DD>-<slug>.md`): Temporary plans/notes per task.
5. **`README.md`**: Public-facing overview. Installation, usage, quick start. Derived from AGENTS.md + SRS + SDS.

## Planning Rules

- **Environment Side-Effects**: When changes touch infra, databases, or external services, the plan must include migration, sync, or deploy steps — otherwise the change works locally but breaks in production.
- **Verification Steps**: Every plan must include specific verification commands (tests, validation tools, connectivity checks) — a plan without verification is just a wish.
- **Functionality Preservation**: Before editing any file for refactoring, run existing tests and confirm they pass — this is a prerequisite, not a suggestion. Without a green baseline you cannot detect regressions. Run tests again after all edits. Add new tests if coverage is missing.
- **Data-First**: When integrating with external APIs or processes, inspect the actual protocol and data formats before planning — assumptions about data shape are the #1 source of integration bugs.
- **Architectural Validation**: For complex logic changes, visualize the event sequence (sequence diagram or pseudocode) — it catches race conditions and missing edges that prose descriptions miss.
- **Variant Analysis**: When the path is non-obvious, propose variants with Pros/Cons/Risks per variant and trade-offs across them. Quality over quantity — one well-reasoned variant is fine if the path is clear.
- **User Decision Gate**: Do NOT detail implementation plan until user explicitly selects a variant.
- **Plan Persistence**: After variant selection, save the detailed plan to `documents/whiteboards/<YYYY-MM-DD>-<slug>.md` using GODS format — chat-only plans are lost between sessions.
- **Proactive Resolution**: Before asking the user, exhaust available resources (codebase, docs, web) to find the answer autonomously — unnecessary questions slow the workflow and signal lack of initiative.

## TDD Flow

1. **RED**: Write a failing test (`test <id>`) for new or changed logic.
2. **GREEN**: Write minimal code to pass the test.
3. **REFACTOR**: Improve code and tests without changing behavior. Re-run `test <id>`.
4. **CHECK**: Run `fmt`, `lint`, and full test suite. You are NOT done after GREEN — skipping CHECK leaves formatting errors and regressions undetected. This step is mandatory.

### Test Rules

- Test logic and behavior only — do not test constants or templates, they change without breaking anything.
- Tests live in the same package. Testing private methods is acceptable when it improves coverage of complex internals.
- Write code only to fix failing tests or reported issues — no speculative implementations.
- No stubs or mocks for internal code. Use real implementations — stubs hide integration bugs.
- Run all tests before finishing, not just the ones you changed.
- When a test fails, fix the source code — not the test. Do not modify a failing test to make it pass, do not add error swallowing or skip logic.
- Do not create source files with guessed or fabricated data to satisfy imports — if the data source is missing, that is a blocker (see Diagnosing Failures).

## Diagnosing Failures

The goal is to identify the root cause, not to suppress the symptom. A quick workaround that hides the root cause is worse than an unresolved issue with a correct diagnosis.

1. Read the relevant code and error output before making any changes.
2. Apply "5 WHY" analysis to find the root cause.
3. Root cause is fixable → apply the fix, retry.
4. Second fix attempt failed → STOP. Output "STOP-ANALYSIS REPORT" (state, expected, 5-why chain, root cause, hypotheses). Wait for user help.

When the root cause is outside your control (missing API keys/URLs, missing generator scripts, unavailable external services, wrong environment configuration) → STOP immediately and ask the user for the correct values. Do not guess, do not invent replacements, do not create workarounds.

## Code Documentation

- **Module level**: each module gets an `AGENTS.md` describing its responsibility and key decisions.
- **Code level**: JSDoc/GoDoc for classes, methods, and functions. Focus on *why* and *how*, not *what*. Skip trivial comments — they add noise without value.

## Read Efficiency

- **ONE READ PER FILE. ZERO re-reads.** After Read(file), its FULL content is
  in context. Do NOT re-read — not even partially, not even after Write/Edit.
- **No offset/limit.** NEVER pass offset or limit to Read(). All project files
  are under 2000 lines. Always read full file.
- **ZERO Grep after Read.** After reading a file, extract ALL needed facts in
  your SAME text response. Do NOT Grep the same file — the content IS in your
  context. Use Grep ONLY for files you have NOT read.
- **Tool-results temp files:** If Bash output is redirected to a temp file,
  Read it ONCE. Extract facts. Never re-read or Grep it.
- **Parallel reads:** Issue ALL Read calls in ONE response when possible.
  Reading files one-per-turn wastes turns.

## Tool Call Efficiency

- **Parallel tool calls:** When multiple independent tool calls are needed,
  issue ALL of them in a SINGLE response. Do not serialize independent calls
  across turns.
- **Context compression:** The system auto-compresses prior messages near
  context limits. Write down important facts from tool results in your text
  response — original tool results may be cleared later.

> **Before you start:** read `documents/requirements-engine.md` (or `requirements-sdlc.md`) and `documents/design-engine.md` (or `design-sdlc.md`) if you haven't in this session. They contain project requirements and architecture that inform every task.
