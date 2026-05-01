# Core Project Rules

> **Note:** `CLAUDE.md` is a symlink to this file. Edits to either path
> retarget here. When citing edits to a user, prefer `AGENTS.md` as the
> canonical name.

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

- **Core:** Domain-agnostic DAG executor engine (root-level Deno/TypeScript
  modules). Reads YAML workflow configs. Entry: `deno task run [--prompt "..."]`
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
- **Worktree base ref:** runs are checked out from `origin/<base>` (default
  `origin/main`), not local `HEAD` ([worktree.ts](worktree.ts) `createWorktree`).
  Any local edit to a workflow's `workflow.yaml`, `agents/*.md`, or other
  tracked files takes effect *only after `git push`*. Symptom of forgetting:
  engine fails inside the new worktree on `loadConfig`
  (`No such file or directory: .../workflow.yaml`) or runs the *previous*
  version of an edited file. Uncommitted edits also trip the FR-E50 safety
  check before the worktree is even created.
- **Observability:** 3 verbosity levels (`-q`/default/`-v`); status lines with
  timestamps; final summary
- **Library-embedding readiness (FR-E59/E60/E61):** Engine is safe to embed in
  a host Deno process that runs sequential `Engine.run()` calls alongside
  other long-lived subsystems. Phase registry is per-run (no module-level
  leak between runs); `EngineOptions.processRegistry?` lets the host scope
  subprocess kills to its own `ProcessRegistry`; `installSignalHandlers()`
  is publicly exposed for autonomous bin entry points (`cli.ts`,
  `scripts/self-runner.ts`) ONLY — `Engine` itself never installs
  SIGINT/SIGTERM listeners, so the host keeps full control over signal
  routing. Parallel `Engine.run()` calls in one process are NOT supported;
  the host serializes them in its queue.
- **SDLC workflow (example):** dogfood ships four workflow folders under
  `.flowai-workflow/`:
  - `github-inbox/` (Claude Code runtime; primary)
  - `github-inbox-opencode/` (OpenCode + GLM-4.7)
  - `github-inbox-opencode-test/` (smoke-test variant)
  - `autonomous-sdlc/` (reference template, OpenCode + GLM-4.7; PM
    autonomously generates and scores tasks across business directions —
    no GitHub issues. Developer/QA merged into a single agent that owns
    quality end-to-end (TDD + chooses tests + self-verifies acceptance
    criteria). Tech Lead Review is the authoritative quality gate: it
    can Edit code directly, runs full `deno task check`, and merges the
    feature branch into local `main` via `git merge --no-ff` on PASS.
    Fully local pipeline — no PR, no push, no `gh`. Branch naming:
    `task-<slug>` from spec frontmatter. 5 agents, no Dev⇄QA loop.
    Imported from `kazar-fairy-taler` as a reusable template; retains
    LumaTale-specific `direction` taxonomy as an example)
  Each is self-contained: `workflow.yaml`, `agents/agent-*.md`, `memory/`,
  `scripts/`, `runs/<run-id>/{state.json, <node-id>/, worktree/}` (FR-E57:
  the per-run git worktree lives alongside the run's state and artifacts
  under one `runs/<run-id>/` umbrella; the legacy top-level `worktrees/`
  directory is gone). Select one by passing it as the mandatory
  positional argument: `flowai-workflow run <workflow>`.
  **`deno task run` is hardcoded to `github-inbox`.** To run a different
  variant: `deno run -A --no-check cli.ts run .flowai-workflow/<variant>` —
  or add a per-variant task to `deno.json`.
  **Config validation:** use `--dry-run` (not `--validate` — it doesn't
  exist; unknown flags are accepted silently and trigger worktree creation
  as a side effect that has to be cleaned up with `git worktree remove
  --force`).
  **`memory/agent-*.md` files are gitignored** at the repo root (they
  accumulate per run); only `memory/reflection-protocol.md` is tracked.
  **Memory invalidation:** When the engine path contract or artifact
  placement changes (e.g., FR-E52 fix that altered where validate.ts
  looks for files under worktree), agent reflection memory under
  `.flowai-workflow/<wf>/memory/agent-*.md` may carry stale workarounds
  the agents learned to compensate for the bug. Reset memory snapshots
  before next run while preserving append-only history (which documents
  what the bug looked like to past runs):
  `find .flowai-workflow/<wf>/memory -name 'agent-*.md' ! -name '*-history.md' -not -path '*/runs/*' -delete`.
  A bare `rm agent-*.md` would also wipe `agent-*-history.md` — do not
  use that shorthand.
  **Dogfood = template.** The same `.flowai-workflow/<name>/` folders the
  project runs are bundled in the JSR tarball AND embedded in every
  standalone binary (via `deno compile --include`, enumerated by
  [`scripts/compile.ts`](scripts/compile.ts) using
  `git ls-files .flowai-workflow/`). `flowai-workflow init` uses them
  as the source for client scaffolds — no separate `init/templates/`
  tree, no placeholder substitution, no wizard. Editing a workflow
  here updates both the project's own runs and the bytes installed by
  `flowai-workflow init` on the next publish/compile. To see what a
  given build ships, run `flowai-workflow init --list`.
  **Drift caveat:** agent
  prompts under `.flowai-workflow/<name>/agents/` are intentionally
  duplicated between workflow folders — when editing a shared agent,
  apply the same change to every copy or document the divergence here.
- **Docker image:** Single image with claude CLI, deno, git, gh

## Repo Layout

Single-package repository:

- Root `deno.json` defines the `@korchasa/flowai-workflow` JSR package.
  Source files (engine modules, CLI entry, init scaffolder, HITL) live
  at repo root — no `engine/` subfolder.
- `scripts/` — dev tooling (check, compile, dashboard, release-notes,
  loop runners). Excluded from the JSR tarball.
- `documents/` — SRS/SDS and task notes. Excluded from the tarball.
- `.flowai-workflow/` — dogfood SDLC workflow config. Bundled in the JSR
  tarball (excluding per-run artefacts: `runs/`, `memory/agent-*.md`,
  `.template.json`) so `flowai-workflow init` can copy a workflow
  verbatim into client projects. No separate `init/templates/` tree —
  `init/` is just the verbatim-copy scaffolder.

The Claude/OpenCode/Cursor CLI wrapper library
(`@korchasa/ai-ide-cli`) lives in the sibling repo
[`korchasa/ai-ide-cli`](https://github.com/korchasa/ai-ide-cli).
flowai-workflow depends on it one-way via JSR
(`jsr:@korchasa/ai-ide-cli@^0.5.6`, pinned in `deno.json`).

For local cross-repo iteration (edit library, see effect here without a
JSR republish), clone both repos side by side under one parent dir and
add a `links` entry to `deno.json` — Deno resolves the JSR specifier
from the sibling checkout instead of the registry:

```jsonc
{
  "name": "@korchasa/flowai-workflow",
  // ...
  "links": ["../ai-ide-cli"]  // local dev only — do not commit
}
```

`links` is intentionally NOT committed to keep CI and publish-dry-run
honest about the JSR-published version.

Publish gotchas honored in `deno.json#publish`:

- **`publish.include` cannot reference files outside the package
  directory.** `../README.md` / `../LICENSE` get rejected with
  `error[invalid-path]`.
- **`.versionrc.json` is mandatory when CI invokes `npm:standard-version`.**
  standard-version defaults to `package.json` for version reads/writes;
  Deno projects have none. Omitting `.versionrc.json` makes it synthesize
  versions from commit history alone, produce `CHANGELOG.md`-only "release"
  commits without bumping `deno.json`, and leave the repo in a
  semantic-mismatch state. `.versionrc.json` at repo root MUST declare
  `packageFiles: [{ filename: "deno.json", type: "json" }]` and
  `bumpFiles: [{ filename: "deno.json", type: "json" }]`. When cloning the
  CI skeleton to a new repo, copy both files together.
- Dev-only paths (`scripts/`, `documents/`, `.github/`, `.claude/`,
  `.devcontainer/`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`,
  `.versionrc.json`) are listed in `publish.exclude` so the JSR tarball
  ships only runtime source + `deno.json` + `README.md` +
  `.flowai-workflow/<name>/` (bundled workflows used by `init`).
- **Per-run dirt under `.flowai-workflow/<name>/`** (`runs/**`,
  `memory/agent-*.md`, `.template.json`) MUST stay in `publish.exclude`
  even if you re-organise. Shipping run state would leak local debug
  output into every client install and bloat the tarball; a stale
  `.template.json` would mislead any future `flowai-workflow update`
  diff. Verify after touching `publish.exclude` with
  `deno publish --dry-run` — the file list should mention only the
  workflow's tracked `.gitignore`, `workflow.yaml`, `agents/`, `scripts/`,
  and `memory/reflection-protocol.md`.
- **JSR slow-types rules (`no-slow-types`, `missing-jsdoc`,
  `private-type-ref`) fire ONLY on `deno publish --dry-run`** — not on
  `deno check` or `deno lint`. Always run `deno task check` before commit
  to catch these locally.
- **`deno doc --lint <entry>` visits only reachable symbols.** Public
  exports bypassed through other barrels are not validated by a single
  entry — use `deno publish --dry-run` for full public-API coverage.

## Scope Separation

Two scopes with strict boundaries:

- **Engine** (`scope: engine`) — domain-agnostic DAG executor (root-level
  `*.ts` modules: `cli.ts`, `engine.ts`, `agent.ts`, `dag.ts`, `config.ts`,
  `validate.ts`, `hitl.ts`, `loop.ts`, `state.ts`, `template.ts`, etc.).
  Node types, validation, continuation, resume, HITL, CLI, templates.
  SRS: `documents/requirements-engine.md`. SDS: `documents/design-engine.md`.
  GitHub label: `scope: engine`.
- **SDLC Workflow** (`scope: sdlc`) — example workflow using the engine.
  Agents, prompts, GitHub workflow, dashboard, devcontainer.
  SRS: `documents/requirements-sdlc.md`. SDS: `documents/design-sdlc.md`.
  GitHub label: `scope: sdlc`.

The CLI wrapper library (`@korchasa/ai-ide-cli`) is maintained in the
sibling repo [`korchasa/ai-ide-cli`](https://github.com/korchasa/ai-ide-cli)
— file issues there for library changes, not here.

FR numbering: `FR-E<N>` (engine), `FR-S<N>` (SDLC). Library FRs live in
the sibling repo as `FR-L<N>`. Existing `FR-<N>` kept as aliases during
migration.

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

Architectural decisions are recorded as ADRs under
[documents/adrs/](documents/adrs/) (Nygard format, append-only). The
list below is a one-line index — open the linked ADR for full
context, alternatives, and consequences.

- **Engine is domain-agnostic:** Generic DAG executor. MUST NOT contain git,
  GitHub, branch, PR, or any domain-specific logic. All domain workflows are
  implemented exclusively via agent nodes wired in workflow YAML configs.
  See [ADR-0001](documents/adrs/0001-isolation-provider.md) (isolation
  provider plugin) and [ADR-0002](documents/adrs/0002-hitl-detection-boundary.md)
  (HITL detection in `@korchasa/ai-ide-cli`) for the boundary fixes
  in flight.
- **Engine is workflow-independent:** MUST NOT depend on any specific workflow
  config. One engine, many workflows. Engine code must not reference concrete
  node names, artifact filenames, or workflow structure.
- Agents are stateless — all context from file artifacts and system prompts.
- YAML workflow config defines node graph; no hardcoded stage order.
- Artifacts stored per-run for isolation. Per-run worktree co-located
  under `<workflowDir>/runs/<run-id>/worktree/` —
  [ADR-0003](documents/adrs/0003-per-run-worktree-co-location.md).
- Detached-HEAD worktrees pinned to a rescue branch before removal —
  [ADR-0004](documents/adrs/0004-detached-head-rescue-branch.md).
- `TemplateContext` paths are workDir-relative; engine consumers wrap via
  `workPath` —
  [ADR-0005](documents/adrs/0005-cwd-relative-template-paths.md).
- Run lock is per-workflow-folder, rooted at `<workflowDir>/runs/.lock` —
  [ADR-0006](documents/adrs/0006-per-workflow-run-lock.md).
- `PhaseRegistry` is per-`Engine.run()`, never module-level —
  [ADR-0007](documents/adrs/0007-phase-registry-per-run.md).
- Engine never installs OS signal handlers; bin entry points only —
  [ADR-0008](documents/adrs/0008-signal-handler-boundary.md).
- Budget enforcement is coupled to the CLI runtime today; planned
  move into `@korchasa/ai-ide-cli` —
  [ADR-0009](documents/adrs/0009-budget-cli-runtime-coupling.md).
- JSR publish surface: `.versionrc.json`, `publish.exclude`,
  `--dry-run` verification —
  [ADR-0010](documents/adrs/0010-jsr-publish-caveats.md).
- SDLC workflow specifics (diff safety checks, etc.)
  are workflow-level concerns, not engine-level.

## Documentation Hierarchy
1. **`AGENTS.md`**: Project vision, constraints, mandatory rules. READ-ONLY reference.
2. **SRS** — "What" & "Why". Source of truth for requirements. Index + section files pattern — read the index first, then only the section(s) you need.
   - Engine: `documents/requirements-engine.md` + `documents/requirements-engine/*.md`
   - SDLC: `documents/requirements-sdlc.md` + `documents/requirements-sdlc/*.md`
   - AI IDE CLI: lives in the sibling repo `korchasa/ai-ide-cli`.
3. **SDS** — "How". Architecture and implementation. Same index + sections pattern. Depends on SRS.
   - Engine: `documents/design-engine.md` + `documents/design-engine/*.md`
   - SDLC: `documents/design-sdlc.md` + `documents/design-sdlc/*.md`
   - AI IDE CLI: sibling repo.
4. **Tasks** (`documents/tasks/<YYYY-MM-DD>-<slug>.md`): Temporary plans/notes per task.
5. **`README.md`**: Public-facing overview. Installation, usage, quick start. Derived from AGENTS.md + SRS + SDS.

## Planning Rules

- **Environment Side-Effects**: When changes touch infra, databases, or external services, the plan must include migration, sync, or deploy steps — otherwise the change works locally but breaks in production.
- **Verification Steps**: Every plan must include specific verification commands (tests, validation tools, connectivity checks) — a plan without verification is just a wish.
- **Functionality Preservation**: Before editing any file for refactoring, run existing tests and confirm they pass — this is a prerequisite, not a suggestion. Without a green baseline you cannot detect regressions. Run tests again after all edits. Add new tests if coverage is missing.
- **Data-First**: When integrating with external APIs or processes, inspect the actual protocol and data formats before planning — assumptions about data shape are the #1 source of integration bugs.
- **Architectural Validation**: For complex logic changes, visualize the event sequence (sequence diagram or pseudocode) — it catches race conditions and missing edges that prose descriptions miss.
- **Variant Analysis**: When the path is non-obvious, propose variants with Pros/Cons/Risks per variant and trade-offs across them. Quality over quantity — one well-reasoned variant is fine if the path is clear.
- **User Decision Gate**: Do NOT detail implementation plan until user explicitly selects a variant.
- **Plan Persistence**: After variant selection, save the detailed plan to `documents/tasks/<YYYY-MM-DD>-<slug>.md` using GODS format — chat-only plans are lost between sessions.
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

Before drawing a conclusion from a single signal:

- **Re-run a transient check before labeling failures "pre-existing" or
  "out of scope"**. Deno's typecheck cache occasionally serves stale errors;
  a single failing run is one data point, not ground truth. The retry costs
  ~15 s; mislabeling forces the user to investigate ghost errors.
- **Verify the suspect line is on the failing call path before announcing
  a fix location**. Trace the call graph from the entry point (CLI command,
  exported function, adapter method actually invoked) to the line you
  suspect. A literal symptom match (e.g. an error string or unknown flag
  name appearing verbatim in some source file) is not evidence — the same
  string can sit on a dead, conditional, or sibling code path that the
  failing run never reaches.

When the root cause is outside your control (missing API keys/URLs, missing generator scripts, unavailable external services, wrong environment configuration) → STOP immediately and ask the user for the correct values. Do not guess, do not invent replacements, do not create workarounds.

## Code Documentation

- **Module level**: each module gets an `AGENTS.md` describing its responsibility and key decisions.
- **Code level**: JSDoc/GoDoc for classes, methods, and functions. Focus on *why* and *how*, not *what*. Skip trivial comments — they add noise without value.

## Read Efficiency

- **ONE READ PER FILE. ZERO re-reads.** After Read(file), its FULL content is
  in context. Do NOT re-read — not even partially, not even after Write/Edit.
- **No offset/limit.** NEVER pass offset or limit to Read(). Always read full
  file.
- **File size budget.** All project files fit within Read's 10k-token limit
  (working budget ~8k tokens / ~30 KB per file). If a file grows past the
  limit, split it by functional area and expose a thin index at the original
  path — see `documents/requirements-engine.md` as the reference pattern
  (index file at the original path, section files in a sibling directory).
  Enforced by `scripts/check.ts::docsTokenBudget()`.
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

> **Before you start:** read `documents/requirements-engine.md` (or `requirements-sdlc.md`) and `documents/design-engine.md` (or `design-sdlc.md`) if you haven't in this session. These are thin index files — read the index, then open only the section file(s) from `documents/requirements-engine/`, `requirements-sdlc/`, `design-engine/`, or `design-sdlc/` that your task touches. Index files contain FR-ID → section-file maps.
