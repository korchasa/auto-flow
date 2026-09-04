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
- Before `git rm <pattern>`, sanity-check with
  `git check-ignore <pattern>` (or compare against `.gitignore`).
  Gitignored files are not tracked, so `git rm` fails with a `pathspec`
  error; use plain `rm` (and stage replacements with `git add`) instead.

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

- Deno (scripting, utilities, validation, task runner, workflow engine).
  Run via `deno task <name>` exclusively — bare `deno test`,
  `deno lint`, `deno fmt` are hook-blocked
  (see `.claude/hooks/guard-deno-direct.ts`). For ad-hoc subset
  checking on one file, filter with `deno task check 2>&1 | grep <pattern>`.
  **Reviving a removed dependency:** restore its `deno.lock` entry from the
  last commit that had it (`git checkout HEAD -- deno.lock`) instead of
  re-resolving — `deno.lock` caps resolution at a minimum dependency date,
  so a dep version published after that date fails to resolve (`Could not
  find version … newer than the specified minimum dependency date`) until
  the lock is restored/updated.
- Shell/Bash (legacy stage orchestration scripts)
- Python 3 (standalone dev scripts, stdlib only, no virtualenv — e.g.
  `scripts/tasks-overview.py`). **Outside `deno task check`:** its walk
  whitelists `.ts/.tsx/.js/.jsx/.sh` (`scripts/check.ts`), so a Python
  script gets no formatter, linter or test gate. Verify one by running it.
- Docker (devcontainer runtime environment)
- Claude Code CLI (`claude`) (AI agent runtime)
- `gh` CLI (GitHub API interaction: PRs, issue comments)
- Git (version control, branch management, diff-based safety checks)
- **Distribution:** Claude Code / Codex plugin via the public
  marketplace repo `korchasa/flowai-workflow-plugins` (FR-E70). The
  engine repo is the source of truth; CI (`.github/workflows/sync-plugins.yml`,
  FR-E72) rebuilds and pushes the plugin payload on every `v*` tag.
  Local payload inspection: `deno task sync-plugins -- --dry-run`.
  Local dogfood install: `deno task sync-plugins-local` — rebuilds the
  payload and re-points the `flowai-workflow-local` marketplace in
  Claude Code + Codex at user scope (preserves per-plugin
  `enabled = false`; soft-skips missing CLIs). Opt-in auto-run after
  `deno task check` via `AUTO_INSTALL_PLUGINS=true` (literal `true`
  only). Both retired predecessors are gone: `deno task
  sync-claude-plugin` and `deno task sync-plugins -- --install-local`.
  **Local dogfood MCP = working-tree source, no `flowai-workflow`
  binary.** `sync-plugins-local` rewrites the emitted payload's
  `.mcp.json` (Claude + Codex) so the server command is `deno run -A
  --no-check --config <repo>/deno.json <repo>/src/cli.ts mcp` (Claude
  keeps `cwd: ${CLAUDE_PROJECT_DIR}`), via
  `sync-plugins-local.ts#directSourceMcpServer`. Engine stays fully
  dynamic — every MCP launch reads live `src/`, no rebuild/reinstall on
  code edits. The SHIPPED `plugin-src/.../.mcp.json` is untouched
  (FR-E78, `command: flowai-workflow`); the divergence lives only in the
  local `flowai-workflow-local` payload, mirroring the
  local-vs-published marketplace-name split.

## Architecture

- **Core:** Domain-agnostic DAG executor engine (Deno/TypeScript modules
  under `src/`, grouped by domain — see Repo Layout). Reads YAML workflow
  configs. Entry: `deno task run [--prompt "..."]`
- **Node types:** `agent` (Claude CLI), `command` (shell command as a DAG
  node, FR-E88), `merge` (combine outputs), `loop` (iterative body with an
  exit condition — artifact-field triple or `until` shell predicate, FR-E87),
  `human` (terminal prompt), `hitl` (asks a human through the workflow's HITL
  transport, FR-E93). Any node may carry a `when:` gate (FR-E89); `agent` and
  `command` nodes may open a branch with `fork:` and close a group with
  `join:` (FR-E95), and may ask for a worktree of their own with
  `isolation: worktree` (FR-E91)
- **Inter-agent communication:** Structured artifacts in
  `<runs-dir>/<run-id>/<node-id>/`, linked via `{{input.<node-id>}}` templates
- **Execution:** a node starts when its own inputs have finished, not when its
  DAG level has (FR-E97); levels survive only as the picture `--dry-run` and
  drift detection read. `defaults.max_parallel` caps how many nodes run at once
  and defaults to 1. Concurrency is opt-in because all nodes of a run share ONE
  worktree, so two nodes editing the same file clobber each other unless they
  carry `isolation: worktree` or belong to a fork branch that declares
  `allowed_paths` (FR-E91). Leak attribution is handled — while more than one
  node runs they share ONE rolling FR-E50 guardrail bracket instead of a
  per-node one, because the snapshots are repository-wide and would otherwise
  blame whichever node happened to be inside the bracket. The FR-E37
  `allowed_paths` check answers the same problem the same way: a node's
  violations are computed against its own scope, plus the run directory the
  engine itself writes into, plus the scopes of every other node that has been
  inside the current bracket.
- **Outcome wave:** a node carrying `run_on` is scheduled by that same
  scheduler, in a second pass that starts once the graph's verdict is known,
  and is gated by the same `gateNode` — so `when:` works on it (FR-E99). The
  verdict is a value: `{{run.outcome}}` and `{{run.attempt}}`. `always`,
  `success` and `failure` run at most once per run, so `--resume` never
  repeats them; `run_on: every_attempt` is the opt-in to running again on
  each invocation.
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
- **Plugin payload cross-repo sync (FR-E70/E72/E74):** The engine ships
  to end users as a Claude Code / Codex plugin. The plugin source tree
  lives in this repo at `plugin-src/`: shared runtime files under
  `plugin-src/shared/`, Claude wiring under `plugin-src/claude/`, and
  Codex wiring under `plugin-src/codex/` (marketplace catalog at
  `.agents/plugins/marketplace.json`). On every `v*` tag, CI runs
  `scripts/sync-plugins-repo.ts` (FR-E72) which uses
  `scripts/build-plugin-payload.ts` (FR-E70) to assemble the full
  payload under separate `claude/` and `codex/` roots (bundled
  `.flowai-workflow/<name>/` workflows, host-specific manifests and
  MCP config with version pinned to engine `deno.json#version`) and
  pushes it into
  `korchasa/flowai-workflow-plugins` with a matching `vX.Y.Z` tag.
  Idempotent — a byte-equal payload is a no-op. Hand-edits to the
  downstream repo are overwritten by the next sync.
  **Engine binary precondition (FR-E78, supersedes FR-E74).** The
  plugin's `.mcp.json` invokes `flowai-workflow mcp` directly. Neither
  the launcher (`bin/launch.ts`) nor the engine TS tree ships in the
  payload anymore — the operator installs `flowai-workflow` once on
  PATH (release binary with `.sha256` sidecar, or `deno install -A
  jsr:@korchasa/flowai-workflow`). Workflow resolution happens inside
  `cli.ts mcp` via `resolveActiveWorkflow`: `$FLOWAI_WORKFLOW` →
  `<cwd>/.flowai-workflow/<single-or-default>` → no-workflow mode
  (handshake still completes; tool calls return a structured
  missing-workflow diagnostic). The engine reads no host-specific env
  — the plugin's `.mcp.json` pins `cwd` per host (`"cwd":
  "${CLAUDE_PROJECT_DIR}"` for Claude; Codex inherits the session
  cwd). The deprecation banner
  (`cli.ts:maybePrintDeprecationBanner`) fires only for standalone
  JSR / binary installs (`VERSION !== "dev"` and
  `FLOWAI_SUPPRESS_DEPRECATION` unset).
- **Plugin agents/skills layout.** The plugin's shared interactive
  surface lives under `plugin-src/shared/skills/` and
  `plugin-src/shared/agents/`; host wiring lives under
  `plugin-src/claude/` and `plugin-src/codex/`. Source of truth — never
  edit `dist/plugin-payload/` (gitignored, regenerated by
  `scripts/build-plugin-payload.ts`).
  - `skills/<name>/SKILL.md` — public, user-invokable entry skills:
    `run`, `init`, `scaffold`, `supervise`, `orchestrate`. These are
    thin dispatchers — they describe how the parent session launches
    a subagent and what to ask back; they do NOT contain operational
    logic, do NOT read run artifacts, do NOT poll the engine.
  - `agents/<name>.md` — context-isolated subagents with their own
    `tools`, `model`, `effort`, `maxTurns`: `orchestrator` (policy
    selection) and `supervisor` (one run). Operational logic lives
    here; the parent context never inlines it. **Claude/OpenCode only.**
  - **Codex variant (FR-E76).** The Codex plugin manifest has no `agents`
    pointer (only `skills`/`mcpServers`/`apps`), so the shared `agents/*.md`
    are inert there and `classifyPayloadFile` drops them for `host=codex`.
    The same operational logic ships to Codex as **skills** authored under
    `plugin-src/codex/plugins/flowai-workflow/skills/{orchestrator,supervisor}/SKILL.md`
    (Codex frontmatter: `name`/`description`/`effort`; no `tools`/`maxTurns`).
    These bodies INTENTIONALLY diverge from the Claude agents (worker-spawn
    framing vs `subagent_type`) — keep them in sync by concern, not verbatim.
    On Codex the `orchestrate`/`supervise` dispatchers spawn a native `worker`
    subagent (Codex `max_depth=1`; parent dispatches) and tell it, by skill
    name, to invoke `orchestrator`/`supervisor`. Verified live (codex-cli
    0.135.0): a Codex worker auto-discovers and loads a skill by name in its
    own isolated thread, so context isolation holds without an `agents`
    pointer.
  - **Dispatch graph for `/flowai-workflow:orchestrate`:** parent →
    `skills/orchestrate` → subagent `orchestrator` → returns
    `SUPERVISOR_DELEGATION` block → parent → subagent `supervisor`
    → returns `SUPERVISOR_REPORT` block (fields: `workflow`,
    `run_id`, `status`, `node`, `evidence`, `root_cause`,
    `fix_surface`, `resume_cmd`, `fixes`, `repeat`, `blocker`) →
    feed back into orchestrator → loop until stop. Both blocks are
    machine-parseable fenced contracts; missing fields break the
    loop. Some hosts (Claude Code as a subagent) cannot launch
    nested subagents, so dispatch always goes through the parent.
  - **Supervisor attach modes:** `fresh` (no run id, launch engine,
    capture run id), `attach-live` (run id given + run already
    executing — do NOT relaunch, just poll),
    `resume-after-fail` (run id + engine dead + non-terminal state
    — patch root cause outside `runs/<run-id>/`, then resume).
    **MCP-first (FR-E84/E85):** the `supervisor` agent drives the
    engine through MCP tools — `start_run {wait:false}` (fresh),
    `resume_node {wait:false}` (resume; rejects when the run is live),
    `get_state`/`tail_artifacts`/`list_runs` (poll), `cancel_run`
    (stop), `provide_human_input` (HITL). Its `tools:` frontmatter
    grants both install-dependent server prefixes (`mcp__flowai-workflow`
    and `mcp__plugin_flowai-workflow_flowai-workflow`). The legacy
    `nohup flowai-workflow run … &` daemon protocol (SIGPIPE-avoidance,
    log-scrape, `kill -0`) is retained ONLY as a Bash fallback for
    hosts where the MCP server is unreachable from the isolated
    subagent thread. The `orchestrator` agent is policy-only
    (forbidden from `runs/**`) and intentionally uses NO MCP tools.
    Long workflows exceed `supervisor.maxTurns` × poll cadence, so
    the supervisor exits via a turn-budget guard at ~2/3 of
    `maxTurns` with `status: running, repeat: true` and the
    orchestrator continuation override re-dispatches a fresh
    supervisor on the same `(workflow, run_id)` without advancing
    the maintenance counter.
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
  variant: `deno run -A --no-check src/cli.ts run .flowai-workflow/<variant>` —
  or add a per-variant task to `deno.json`.
  **Config validation:** use `--dry-run` (`--validate` does not exist).
  Unknown flags are now rejected with a clear error and no side effect —
  they used to be swallowed as workflow arguments, which started a real run
  and left a worktree behind. Workflow arguments must use the attached
  form: `--key=value` → `{{args.key}}`.
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
  All source lives under `src/`, grouped by domain (no flat repo-root
  layout, no `engine/` subfolder):
  - `src/cli.ts` — CLI entry (JSR `.` export). `src/mod.ts` — library
    entry (JSR `./engine` export). `src/types.ts`, `src/output.ts`,
    `src/process-registry.ts`, `src/version.ts` — shared roots.
  - `src/engine/` — DAG executor core (`engine.ts`, `agent.ts`, `dag.ts`,
    `loop.ts`, `human.ts`, node dispatch/lifecycle).
  - `src/config/` — config load + validation + templates
    (`config.ts`, `validate.ts`, `template.ts`).
  - `src/state/` — run state, lock, log, journal (`state.ts`, `lock.ts`,
    `run-journal.ts`).
  - `src/isolation/` — git worktree, guardrail, scope/memory checks.
  - `src/hitl/` — human-in-the-loop handling + HITL MCP server.
  - `src/mcp/` — engine MCP server + CLI commands.
  - `src/init/` — verbatim-copy scaffolder for `flowai-workflow init`.
  - `src/testing/` — handler-driven fake runtime adapter (FR-E86) injected
    via `EngineOptions.runtimeAdapter` to run whole workflows without an
    agent. Test-only: excluded from the JSR tarball.
  - The ACP runtime layer is **not** in `src/` — it is the external
    `@korchasa/ai-ide-cli` JSR dependency (import-map alias
    `@korchasa/ai-ide-cli`, pinned `^0.8.12` in `deno.json#imports`).
    External to this tree, NOT external to your ownership — see
    "Runtime-layer ownership" below.
- `scripts/` — dev tooling (check, compile, dashboard, release-notes,
  loop runners). Excluded from the JSR tarball.
- `documents/` — SRS/SDS and task notes. Excluded from the tarball.
- `.flowai-workflow/` — dogfood SDLC workflow config. Bundled in the JSR
  tarball (excluding per-run artefacts: `runs/`, `memory/agent-*.md`,
  `.template.json`) so `flowai-workflow init` can copy a workflow
  verbatim into client projects. No separate `init/templates/` tree —
  `init/` is just the verbatim-copy scaffolder.

The ACP runtime layer is the external `@korchasa/ai-ide-cli` JSR package
(pinned `^0.8.12`), developed in the sibling repo
`/Users/korchasa/www/flowai/ai-ide-cli` and consumed here purely via JSR.
The package is multi-transport (CLI default, ACP opt-in); the engine drives
it ACP-only by passing `transport: "acp"` at every `adapter.invoke()` /
`runtimeRun()` call boundary (`src/engine/agent.ts`, `src/hitl/hitl.ts`) and
reading capabilities through `adapter.capabilitiesFor("acp")`. ACP is thus
the engine's sole runtime transport without any engine-level `transport`
config knob. There is no in-tree runtime source: runtime behaviour changes
land in the sibling repo, get published to JSR, and only then arrive here
via a pin bump.

### Runtime-layer ownership

`@korchasa/ai-ide-cli` is YOUR responsibility, not a third-party
dependency you merely consume. A runtime-layer defect or gap is never
"out of scope" and never something to hand back to the user — treat the
sibling repo as a second working tree of the same job. Concretely:

- Diagnose runtime symptoms down into the sibling repo's source, not
  only up to the engine boundary.
- Fix there under that repo's own AGENTS.md rules (its own TDD flow and
  `deno task check`), publish a new JSR version, bump the pin here, and
  re-run `deno task check` in this repo. The change is done only when
  BOTH repos are green and the pin points at the published version.
- Own the whole chain in one session when the fix spans both repos.
  Don't stop at "filed upstream".
- FR numbering there stays `FR-L<N>`; requirements/design for the
  runtime live in the sibling repo's `documents/`, not here.

**Update-check procedure** (for "check ACP updates"-class requests):
read the latest published version from
`https://jsr.io/@korchasa/ai-ide-cli/meta.json`, diff the `exports`
lists of the pinned and latest `<ver>_meta.json`, read the sibling
repo's release history for what each version changed, then bump
`deno.json#imports`, refresh the lock with `deno install`, and run
`deno task check`.

**A freshly published version is not resolvable immediately.** JSR serves
`https://jsr.io/@korchasa/ai-ide-cli/meta.json` (the version index Deno
reads) from a CDN cache that lags publication by tens of minutes, while
`<ver>_meta.json`, the version's module URLs, and
`https://jsr.io/api/scopes/korchasa/packages/ai-ide-cli/versions` already
show the new release. Confirm publication through those three, then WAIT
— `deno install --reload` does not help, because the stale answer comes
from the CDN, not the local cache. Appending a cache-busting query
(`meta.json?cb=<ts>`) proves the index is fine upstream but does NOT make
Deno resolve. **A failed `deno install` rewrites `deno.lock` and drops
unrelated specifiers** — restore it with `git checkout HEAD -- deno.lock`
before retrying, and do not leave the pin raised while it cannot resolve
(`deno task check` goes red repo-wide).

**Workaround while the index is stale: hand-write the lock entry.** Deno
skips `meta.json` altogether once `deno.lock` already resolves the
specifier, so the bump can land before the CDN heals. Patch three places
by hand and do NOT run `deno install` (it re-resolves and fails):
`specifiers` (`jsr:@korchasa/ai-ide-cli@~<ver>` → `<ver>`), the `jsr`
entry key plus its `integrity` (= sha256 of the version metadata:
`curl -s https://jsr.io/@korchasa/ai-ide-cli/<ver>_meta.json | shasum -a 256`),
and `workspace.dependencies`. Carry over the previous version's
`dependencies` array when the new version imports the same externals
(grep `<ver>_meta.json` for `jsr:` / `npm:` specifiers). `deno task check`
and `deno publish --dry-run` then pass against the new version, but
`deno install -g` IGNORES the lock — even with `--lock --frozen` — and
re-resolves, so CI's plugin-install-acceptance jobs still fail from a
stale edge node. Hold the push until the index serves the version.

**Lock pins the resolution; the caret alone never upgrades.**
`deno.lock` normalises a `^0.8.x` specifier to the equivalent `~0.8.x`
form (identical range for `0.x`) and freezes the resolved version, so a
newer published release is picked up only after `deno install` rewrites
the lock. A `~0.8.x` key in `deno.lock` is therefore NOT evidence of a
stale specifier.

**A minor bump can break consumer types even when `exports` are
unchanged.** `RuntimeCapabilities` gains REQUIRED boolean flags over
time (`0.8.10` added `commandsFastChannel`), so every full capability
literal in engine tests fails `deno check` until the new flag is added.
Compare the interface in
`https://jsr.io/@korchasa/ai-ide-cli/<ver>/runtime/capability-types.ts`
between versions instead of trusting the `exports` diff. Test fixtures
that build a full literal are the blast radius; `src/testing/fake-runtime.ts`
is immune because it spreads a real adapter's capabilities.

**Source of API truth = the PUBLISHED package, not the local sibling
checkout.** When changing the pin or repointing imports, verify the
imported symbols against the published version
(`https://jsr.io/@korchasa/ai-ide-cli/<ver>/...` source +
`https://jsr.io/@korchasa/ai-ide-cli/<ver>_meta.json` `exports`), NOT
`../ai-ide-cli` on disk — the sibling working copy routinely carries
unpublished, uncommitted divergence. Reading the local copy as ground
truth produces imports that fail `deno check` against JSR. A module
present in `<ver>_meta.json#moduleGraph2` is NOT importable either;
only keys of `exports` are (`runtime/error-types` with its
`ERROR_CATEGORY_*` consts exists in `0.8.12`'s graph but is absent
from `exports`, so the engine compares category string literals
instead). This is a verification rule, not a scope rule — you still
edit and publish that repo.

Publish gotchas honored in `deno.json#publish`:

- **`publish.include` cannot reference files outside the package
  directory.** `../README.md` / `../LICENSE` get rejected with
  `error[invalid-path]`.
- **`.versionrc.json` is mandatory when CI invokes
  `npm:commit-and-tag-version`.** The tool defaults to `package.json`
  for version reads/writes;
  Deno projects have none. Omitting `.versionrc.json` makes it synthesize
  versions from commit history alone, produce `CHANGELOG.md`-only "release"
  commits without bumping `deno.json`, and leave the repo in a
  semantic-mismatch state. `.versionrc.json` at repo root MUST declare
  `packageFiles: [{ filename: "deno.json", type: "json" }]` and
  `bumpFiles: [{ filename: "deno.json", type: "json" }]`. When cloning the
  CI skeleton to a new repo, copy both files together.
- **Never let `commit-and-tag-version` pick the bump level.** While the
  version is `0.x` it applies pre-1.0 semantics of its own — a `feat`
  bumps only PATCH, a breaking change bumps MINOR — and neither
  `preMajor: false` in `.versionrc.json` nor the `preset` object form
  overrides it (both verified 31.08.2026 against 13.1.2). That is how
  FR-E99, a feature, shipped as 0.9.2. CI computes the level with
  `scripts/release-level.ts` over `<last-tag>..HEAD` and passes it as
  `--release-as`; the rules live in `scripts/release-level_test.ts` and
  the CI wiring is locked by `scripts/ci_yaml_test.ts`. A merge commit
  carries no conventional-commit type, so the range must list every
  commit it brought in — first-parent history would release nothing.
  To correct a version number by hand, dispatch `ci.yml` with the
  `release_as` input instead of hand-editing `deno.json`.
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
- **`publish.exclude` glob `dir/**` does NOT match `dir/.dotchild/...`.**
  To exclude a directory whose tracked descendants include dotfile
  subdirectories (e.g. `plugin-src/claude/.claude-plugin/marketplace.json`,
  FR-E70), use the bare directory name (`plugin-src`) instead of
  `plugin-src/**`. Gitignored content is already excluded upstream by
  JSR's `git ls-files`-driven inclusion, so the caveat bites only for
  TRACKED dotfile descendants. Always verify with `deno publish
  --dry-run` after touching `publish.exclude`.
- **JSR slow-types rules (`no-slow-types`, `missing-jsdoc`,
  `private-type-ref`) fire ONLY on `deno publish --dry-run`** — not on
  `deno check` or `deno lint`. Always run `deno task check` before commit
  to catch these locally.
- **`deno doc --lint <entry>` visits only reachable symbols.** Public
  exports bypassed through other barrels are not validated by a single
  entry — use `deno publish --dry-run` for full public-API coverage.

**Bulk-rewrite scripts (repo-wide search-and-replace) MUST hard-skip:**

- `CHANGELOG.md` — immutable release log (regenerated by
  `commit-and-tag-version`; rewriting historical entries breaks the link to
  git tags).
- `.claude/worktrees/**` — gitignored stale Claude worktrees that may
  be active in another session.
- `.flowai-workflow/*/runs/**`, `.flowai-workflow/*/memory/agent-*.md`
  — per-run artefacts and memory snapshots (gitignored, irrelevant
  for source-of-truth edits).
- Anything matched by `git check-ignore` — respect `.gitignore`
  semantics; a script that walks from `.` ignores them by default
  unless its walker is naive.

The skip list lives here; scripts that need a different scope MUST
declare it explicitly with one-line rationale at the top of the
script. Always dry-run (print intended diffs) before applying, and
follow with `deno task check`.

## Scope Separation

Two scopes with strict boundaries:

- **Engine** (`scope: engine`) — domain-agnostic DAG executor (`src/`
  modules: `src/cli.ts`, `src/engine/`, `src/config/`, `src/state/`,
  `src/isolation/`, `src/hitl/`, `src/mcp/`). Node types, validation,
  continuation, resume, HITL, CLI, templates. The ACP runtime is the
  external `@korchasa/ai-ide-cli` dependency, not engine source.
  SRS: `documents/requirements-engine.md`. SDS: `documents/design-engine.md`.
  GitHub label: `scope: engine`.
- **SDLC Workflow** (`scope: sdlc`) — example workflow using the engine.
  Agents, prompts, GitHub workflow, dashboard, devcontainer.
  SRS: `documents/requirements-sdlc.md`. SDS: `documents/design-sdlc.md`.
  GitHub label: `scope: sdlc`.

The ACP runtime layer is the external `@korchasa/ai-ide-cli` JSR package,
maintained in the sibling repo `/Users/korchasa/www/flowai/ai-ide-cli`.
Track runtime-layer issues there and engine issues here, but the two
repos share ONE owner: you. A scope boundary decides where code and
tickets live, not whether you are allowed to fix it — see
"Runtime-layer ownership" under Repo Layout.

FR numbering: `FR-E<N>` (engine), `FR-S<N>` (SDLC). Legacy library FRs
(`FR-L<N>`) from the former `ai-ide-cli` repo remain as historical
references in commit/task history. Existing `FR-<N>` kept as aliases
during migration.

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

Architectural decisions are recorded as permanent task files under
[documents/tasks/](documents/tasks/), named `<YYYY>/<MM>/<slug>.md`.
The list below is a one-line index — open the linked decision-task
for full context, alternatives, and consequences.

- **Engine is domain-agnostic:** Generic DAG executor. MUST NOT contain git,
  GitHub, branch, PR, or any domain-specific logic. All domain workflows are
  implemented exclusively via agent nodes wired in workflow YAML configs.
  See [isolation-provider](documents/tasks/2026/05/isolation-provider.md) (isolation
  provider plugin) and [hitl-detection-boundary](documents/tasks/2026/05/hitl-detection-boundary.md)
  (HITL detection in the ACP layer, external `@korchasa/ai-ide-cli`) for the
  boundary fixes in flight.
- **Engine is workflow-independent:** MUST NOT depend on any specific workflow
  config. One engine, many workflows. Engine code must not reference concrete
  node names, artifact filenames, or workflow structure.
- Agents are stateless — all context from file artifacts and system prompts.
- YAML workflow config defines node graph; no hardcoded stage order.
- Artifacts stored per-run for isolation. Per-run worktree co-located
  under `<workflowDir>/runs/<run-id>/worktree/` —
  [per-run-worktree-co-location](documents/tasks/2026/05/per-run-worktree-co-location.md).
- Detached-HEAD worktrees pinned to a rescue branch before removal —
  [detached-head-rescue-branch](documents/tasks/2026/05/detached-head-rescue-branch.md).
- `TemplateContext` paths are workDir-relative; engine consumers wrap via
  `workPath` —
  [cwd-relative-template-paths](documents/tasks/2026/05/cwd-relative-template-paths.md).
- Run lock is per-workflow-folder, rooted at `<workflowDir>/runs/.lock` —
  [per-workflow-run-lock](documents/tasks/2026/05/per-workflow-run-lock.md).
- `PhaseRegistry` is per-`Engine.run()`, never module-level —
  [phase-registry-per-run](documents/tasks/2026/05/phase-registry-per-run.md).
- Engine never installs OS signal handlers; bin entry points only —
  [signal-handler-boundary](documents/tasks/2026/05/signal-handler-boundary.md).
- Budget enforcement is coupled to the CLI runtime today; planned
  move into the external `@korchasa/ai-ide-cli` ACP layer —
  [budget-cli-runtime-coupling](documents/tasks/2026/05/budget-cli-runtime-coupling.md).
- JSR publish surface: `.versionrc.json`, `publish.exclude`,
  `--dry-run` verification —
  [jsr-publish-caveats](documents/tasks/2026/05/jsr-publish-caveats.md).
- SDLC workflow specifics (diff safety checks, etc.)
  are workflow-level concerns, not engine-level.

## Documentation Hierarchy
1. **`AGENTS.md`**: Project vision, constraints, mandatory rules. READ-ONLY reference.
2. **SRS** — "What" & "Why". Source of truth for requirements. Index + section files pattern — read the index first, then only the section(s) you need.
   - Engine: `documents/requirements-engine.md` + `documents/requirements-engine/*.md`
     (the ACP runtime layer is the external `@korchasa/ai-ide-cli` dependency).
   - SDLC: `documents/requirements-sdlc.md` + `documents/requirements-sdlc/*.md`
3. **SDS** — "How". Architecture and implementation. Same index + sections pattern. Depends on SRS.
   - Engine: `documents/design-engine.md` + `documents/design-engine/*.md`
     (the ACP runtime layer is the external `@korchasa/ai-ide-cli` dependency).
   - SDLC: `documents/design-sdlc.md` + `documents/design-sdlc/*.md`
4. **Tasks** (`documents/tasks/<YYYY-MM-DD>-<slug>.md`): Temporary plans/notes per task.
5. **`README.md`**: Public-facing overview. Installation, usage, quick start. Derived from AGENTS.md + SRS + SDS.

## Planning Rules

- **Environment Side-Effects**: When changes touch infra, databases, or external services, the plan must include migration, sync, or deploy steps — otherwise the change works locally but breaks in production.
- **Verification Steps**: Every plan must include specific verification commands (tests, validation tools, connectivity checks) — a plan without verification is just a wish.
- **Functionality Preservation**: Before editing any file for refactoring, run existing tests and confirm they pass — this is a prerequisite, not a suggestion. Without a green baseline you cannot detect regressions. Run tests again after all edits. Add new tests if coverage is missing.
- **Data-First**: When integrating with external APIs or processes, inspect the actual protocol and data formats before planning — assumptions about data shape are the #1 source of integration bugs.
- **Architectural Validation**: For complex logic changes, visualize the event sequence (sequence diagram or pseudocode) — it catches race conditions and missing edges that prose descriptions miss.
- **Variant Analysis**: When the path is non-obvious, propose variants with Pros/Cons/Risks per variant and trade-offs across them. Quality over quantity — one well-reasoned variant is fine if the path is clear.
- **Reframe Before Extending**: When a new requirement won't fit an existing type/API/argument shape, write the requirement as a problem statement BEFORE proposing to widen the existing abstraction. Ask: "is this the same concern as the existing field, or a new concern wearing the same shape?" Often the answer is "new concern" — and the right fix is a new typed field, not a wider existing one. Stretching one map/string/tuple to cover two concerns leaks abstraction (e.g. attempting to make `ExtraArgsMap`'s `Record<string,string|null>` carry repeated MCP-config flags rather than recognising that per-invocation MCP registration is its own concern; resolved upstream by a new `mcpServers` typed field — see hitl-via-engine-mcp).
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

## Commit Hygiene

### Mixed-file `git add -p` audit

Before piping pre-canned answers (`printf 'n\ny\n' | git add -p <file>`)
on a file modified by multiple concerns (your session-introduced hunk +
pre-existing, untracked, parallel work), audit hunk count and ownership
first — otherwise the canned input silently stages someone else's hunk
in your group.

1. `git diff <file> | grep -c '^@@'` — confirm hunk count matches the
   length of your intended `y`/`n` sequence.
2. `git diff <file>` — eyeball each hunk header; tag which are yours
   (introduced this session) vs. pre-existing (visible in the
   session-start `git status` snapshot).
3. Only then pipe answers. The sequence must have exactly one entry per
   hunk and must classify each one explicitly.

If you guess wrong, `git reset HEAD <file>` and retry from step 1.
NEVER `git commit --amend` to "fix" a wrong-hunk stage — that hides the
bug instead of correcting it.

## Diagnosing Failures

The goal is to identify the root cause, not to suppress the symptom. A quick workaround that hides the root cause is worse than an unresolved issue with a correct diagnosis.

1. Read the relevant code and error output before making any changes.
2. Apply "5 WHY" analysis to find the root cause.
3. Root cause is fixable → apply the fix, retry.
4. Second fix attempt failed → STOP. Output "STOP-ANALYSIS REPORT" (state, expected, 5-why chain, root cause, hypotheses). Wait for user help.

Before drawing a conclusion from a single signal:

- **Hierarchy of hypotheses for "X doesn't work" reports on
  RPC/IPC subsystems (MCP, HITL, engine subprocess)**. Validate
  cheapest layers first: (1) is the target process alive?
  (`ps`/`pgrep`/`pgrep -P <host-pid>`); (2) was it ever spawned by
  the host CLI? — absent child means the spawn step failed, not
  the protocol; (3) is the transport endpoint reachable? (port
  open, FIFO present, lock file present and readable); (4) does
  the handshake complete? — read the live log under
  `~/Library/Caches/claude-cli-nodejs/<project>/mcp-logs-*/` or
  the equivalent host-CLI log. Only after (1)–(4) pass is it
  worth investigating schema, SDK internals, or protocol-level
  filtering. `claude mcp list` runs a fresh probe with a clean
  spawn and does NOT reflect the long-lived connection inside the
  active session — never trust it for "is the connection in
  *this* session working".
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
- **A background job notifies you; polling it does not.** A command started
  in the background re-invokes you when it exits, so every poll in between
  re-sends the whole conversation to be told "still running". Start it, do
  other work, and read the result once. Verified 2026-09-05: `deno task
  check` was polled six times while it ran — six full round-trips, no
  information.
- **A passed check stays passed.** Do not re-run `deno task check` on a tree
  you have not changed since it passed. That includes a tree you changed for
  a probe and restored: `diff -q <file> <backup>` reporting no difference is
  the evidence the check would reproduce, and it costs a second instead of
  two minutes.
- **Name a file by listing it, never from memory.** A test module's name does
  not follow from the module it covers — `src/state/run-journal.ts` is
  covered by `journal-chain_test.ts`, and `run-journal_test.ts` does not
  exist. `deno test` aborts the entire invocation on one missing path
  (`error: Import '…' failed, not found`), so a single guessed name in a
  multi-module command loses every module in it. Run `ls <dir>/*_test.ts`
  first.

> **Before you start:** read `documents/requirements-engine.md` (or `requirements-sdlc.md`) and `documents/design-engine.md` (or `design-sdlc.md`) if you haven't in this session. These are thin index files — read the index, then open only the section file(s) from `documents/requirements-engine/`, `requirements-sdlc/`, `design-engine/`, or `design-sdlc/` that your task touches. Index files contain FR-ID → section-file maps.
