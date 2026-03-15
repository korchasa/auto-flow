# YOU MUST

- STRICTLY FOLLOW YOUR ROLE.
- FIRST ACTION IN SESSION: READ ALL PROJECT DOCS. ONE-TIME PER SESSION.
- AFTER END OF SESSION, REVIEW ALL DOCUMENTS AND MAKE SURE THEY ARE ACCURATE AND
  UP TO DATE.
- ALWAYS CHECK THE CHANGES MADE BY RUNNING THE APPROPRIATE TESTS OR SCRIPTS.
- ALWAYS KEEP THE PROJECT IN WORKING CONDITION: WITHOUT ERRORS, WARNINGS, AND
  PROBLEMS IN THE FORMATER AND LINTER OUTPUT
- STRICTLY FOLLOW TDD RULES.
- WRITE ALL DOCUMENTATION IN ENGLISH IN COMPRESSED STYLE.
- IF YOU SEE CONTRADICTIONS IN THE REQUEST OR CONTEXT, SAY ABOUT THEM, ASK THE
  NECESSARY QUESTIONS AND STOP.
- DO NOT USE STUBS, "CRUTCHES", DECEPTIONS, OR OTHER PREMODS TO BYPASS CHECKS.
- THE CODE MUST FOLLOW THE "FAIL FAST, FAIL CLEARLY" STRATEGY UNLESS THE USER
  HAS REQUESTED OTHERWISE.
- IF A FIX ATTEMPT FAILS, APPLY "5 WHY" ANALYSIS TO FIND THE ROOT CAUSE BEFORE
  RETRYING.
- IF ROOT CAUSE IS UNFIXABLE OR OUTSIDE CONTROL: STOP. DO NOT USE WORKAROUNDS.
  ASK USER FOR HELP.
- IF ISSUE PERSISTS AFTER 2 ATTEMPTS: STOP. OUTPUT "STOP-ANALYSIS REPORT"
  (STATE, EXPECTED, 5-WHY CHAIN, ROOT CAUSE, HYPOTHESES). WAIT FOR USER HELP.
- WHEN EDITING PIPELINE CONFIG, ALWAYS CHECK LOCALLY FIRST.
- BEFORE RUNNING `deno task run`, COMMIT OR STASH ALL LOCAL CHANGES.
  Engine's safety check treats uncommitted diffs as out-of-scope modifications.
- BE PRECISE IN YOUR WORDING. USE A SCIENTIFIC APPROACH. ACCOMPANY HIGHLY
  SPECIALIZED TERMS AND ABBREVIATIONS WITH SHORT HINTS IN PARENTHESES
- PROVIDE EVIDENCE FOR YOUR CLAIMS
- USE STANDARD TOOLS (jq, yq, jc) TO PROCESS AND MANAGE OUTPUT.
- DO NOT USE TABLES IN CHAT OUTPUT. USE TWO-LEVEL LIST INSTEAD.

---

## Project Information

- Project Name: auto-flow

## Project Vision

Universal DAG-based engine for orchestrating AI agents. Define agent workflows
as YAML configs — engine handles execution, inter-agent communication,
validation, loops, and resume. Domain-agnostic: no git/GitHub/SDLC logic in
engine; any workflow expressible as a DAG of agent/merge/loop/human nodes.

The engine is developed using its own SDLC pipeline (dogfooding): a chain of
specialized AI agents (PM, Architect, Tech Lead, Developer, QA, Tech Lead
Review) that automates the full development lifecycle from GitHub Issue to
merged PR. This pipeline serves as both the development method and a reference
example of engine usage.

## Project tooling Stack

- Deno (scripting, utilities, validation, task runner, pipeline engine)
- Shell/Bash (legacy stage orchestration scripts)
- Docker (devcontainer runtime environment)
- Claude Code CLI (`claude`) (AI agent runtime)
- `gh` CLI (GitHub API interaction: PRs, issue comments)
- Git (version control, branch management, diff-based safety checks)

## Architecture

- **Core:** Domain-agnostic DAG executor engine (`engine/`, Deno/TypeScript).
  Reads YAML pipeline configs. Entry: `deno task run [--prompt "..."]`
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
- **SDLC pipeline (example):** `.auto-flow/pipeline.yaml` — 6 agents automating
  full development lifecycle. Agent prompts in `.auto-flow/agents/agent-*/SKILL.md`
- **Docker image:** Single image with claude CLI, deno, git, gh

## Scope Separation

Two scopes with strict boundary:

- **Engine** (`scope: engine`) — domain-agnostic DAG executor (`engine/`).
  Node types, validation, continuation, resume, HITL, CLI, templates.
  SRS: `documents/requirements-engine.md`. SDS: `documents/design-engine.md`.
  GitHub label: `scope: engine`.
- **SDLC Pipeline** (`scope: sdlc`) — example pipeline using the engine.
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
  implemented exclusively via agent nodes wired in pipeline YAML configs
- **Engine is pipeline-independent:** MUST NOT depend on any specific pipeline
  config. One engine, many pipelines. Engine code must not reference concrete
  node names, artifact filenames, or pipeline structure
- Agents are stateless — all context from file artifacts and system prompts
- YAML pipeline config defines node graph; no hardcoded stage order
- Artifacts stored per-run for isolation
- SDLC pipeline specifics (diff safety checks, Meta-Agent restrictions, etc.)
  are pipeline-level concerns, not engine-level

## Planning Rules

- **Environment Side-Effects**: Changes to infra/DB/external services -> plan
  MUST include migration/sync/deploy steps.
- **Verification Steps**: Plan MUST include specific verification commands
  (tests, validation tools, connectivity checks).
- **Functionality Preservation**: Refactoring/modifications -> run existing
  tests before/after; add new tests if coverage missing.
- **Data-First**: Integration with external APIs/processes -> inspect protocol &
  data formats BEFORE planning.
- **Architectural Validation**: Complex logic changes -> visualize event
  sequence (sequence diagram/pseudocode).
- **Variant Analysis**: Non-obvious path -> propose variants with Pros/Cons.
  Quality > quantity. 1 variant OK if path is clear.
- **User Decision Gate**: Do NOT detail implementation plan until user
  explicitly selects a variant.
- **Plan Persistence**: After variant selection, save the detailed plan to
  `documents/whiteboard.md` using GODS format. Chat-only plans are lost between
  sessions.
- **Proactive Resolution**: Before asking user, exhaust available resources
  (codebase, docs, web) to find the answer autonomously.

## CODE DOCS

- **Module**: `AGENTS.md` (responsibility/decisions).
- **Comments**: Class/Method/Func (JSDoc/GoDoc). Why/How > What. No trivial
  comments.

## TDD FLOW

1. **RED**: Write test (`test <id>`) for new/changed logic or behavior.
2. **GREEN**: Pass test (`test <id>`).
3. **REFACTOR**: Improve code/tests. No behavior change. (`test <id>`).
4. **CHECK**: `check` command. Fix all warnings and errors.

### Test Rules

- DO NOT test constants/templates. Test LOGIC/BEHAVIOR only.
- Tests in same pkg. Private methods OK.
- Code ONLY to fix tests/issues.
- NO STUBS. Real code.
- Run ALL tests before finish.
