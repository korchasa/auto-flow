# flowai-workflow

Universal DAG-based engine for orchestrating AI agents. Define agent workflows as YAML configs — the engine handles execution, inter-agent communication, validation, loops, resume, and runtime selection.

## Install

### Via Deno (recommended)

Requires [Deno](https://deno.com/) 2.x.

```bash
deno install -g -A -n flowai-workflow jsr:@korchasa/flowai-workflow
```

The CLI checks JSR for newer versions on startup (fail-open, non-blocking).
Pass `--skip-update-check` to suppress the check.

### Pre-built binary

Grab the binary for your platform from [GitHub Releases](https://github.com/korchasa/flowai-workflow/releases/latest).

## Engine Architecture

```mermaid
graph TD
    CLI["CLI<br/>deno task run"] --> ConfigLoader["Config Loader<br/>YAML → WorkflowConfig"]
    ConfigLoader --> DAG["DAG Builder<br/>toposort → levels"]
    DAG --> Executor["Level Executor<br/>sequential per level"]

    Executor --> Dispatch{Node Type?}
    Dispatch -->|agent| Agent["Agent Runner<br/>Claude / OpenCode"]
    Dispatch -->|loop| Loop["Loop Runner<br/>iterative body"]
    Dispatch -->|merge| Merge["Merge<br/>copy dirs"]
    Dispatch -->|human| Human["Human Input<br/>terminal / HITL"]

    Agent --> Validate["Validation<br/>file_exists, frontmatter,<br/>custom_script, ..."]
    Loop --> Validate
    Validate -->|fail| Continue["Continuation<br/>resume with error context"]
    Continue --> Agent
    Validate -->|pass| State["State Manager<br/>state.json"]
    State --> Next["Next Level / Post-workflow"]

    Executor --> PostWorkflow["Post-Workflow Nodes<br/>run_on: always|success|failure"]
    PostWorkflow --> Summary["Run Summary<br/>cost, duration, results"]
```

## Core Concepts

The engine (Deno/TypeScript modules at repo root) reads a YAML workflow config and builds a directed acyclic graph (DAG) of nodes. Nodes are topologically sorted into levels and executed sequentially.

Four node types:

- **agent** — invokes the configured runtime (`claude` by default, `opencode` also supported)
- **merge** — combines outputs from multiple predecessor nodes
- **loop** — iterative body with frontmatter-based exit condition
- **human** — terminal prompt for manual input; agent-initiated HITL is supported on both Claude and OpenCode runtimes

Inter-agent communication uses structured Markdown artifacts in `<runs-dir>/<run-id>/[<phase>/]<node-id>/`, linked via `{{input.<node-id>}}` template variables. On validation failure, the engine resumes the agent in the same session with error context (continuation mechanism).

## Features

- **YAML-driven DAG** — declarative workflow definition, no hardcoded stage order
- **Domain-agnostic** — engine contains no git/GitHub/SDLC logic; any workflow expressible as a DAG
- **Workflow-independent** — engine does not reference concrete node names or artifact filenames; one engine, many workflows
- **Multi-runtime agents** — runtime selectable per workflow or per node: `claude` (default) or `opencode`
- **Loop nodes** — iterative cycles with configurable exit conditions and max iterations
- **HITL support** — human interaction nodes for manual decisions or approvals; agent-initiated HITL works on Claude and OpenCode
- **Validation** — rule-based checks per node (file_exists, file_not_empty, contains_section, custom_script, frontmatter_field)
- **Resume** — failed/interrupted runs resumable via `--resume <run-id>`; completed nodes skipped
- **Observability** — 4 verbosity levels (`-q` / default / `-s` / `-v`); status lines with timestamps; final summary

## Quick Start: New Project

Scaffold a workflow into an existing project:

```bash
cd your-project
flowai-workflow init                       # interactive picker
flowai-workflow init --workflow autonomous-sdlc   # non-interactive
```

With no `--workflow` and a TTY, init prints the bundled workflows and
prompts you to pick one (Enter accepts the default `github-inbox`).
Pass `--workflow <name>` for CI / scripted use; non-TTY stdin (pipes,
no terminal) silently uses the default.

`init` is a verbatim copy: it streams the bundled
`<package>/.flowai-workflow/<workflow>/` tree (the same one the engine
project itself dogfoods) into your project's
`.flowai-workflow/<workflow>/`. No placeholder substitution, no
autodetection — what you see in the source repo is what lands on disk.

Project-specific configuration (test commands, branch names, repo
conventions, code-style rules) is the agents' job at first run. As the
last step of `init`, the CLI prints a ready-to-paste
**adaptation prompt** wrapped between
`--- ADAPTATION PROMPT (start) ---` / `(end)` markers. Hand that prompt
to the workflow:

```bash
flowai-workflow run .flowai-workflow/github-inbox --prompt "$(cat <<'EOF'
<paste the printed prompt body>
EOF
)"
```

The agents then inspect your `deno.json` / `package.json` /
`Cargo.toml` / `go.mod` / `pyproject.toml`, your `AGENTS.md` and CI
configs, detect language/test/lint/branch/repo conventions, patch
`workflow.yaml` and `agents/agent-*.md` in place, and stop without
committing — leaving the diff for you to review.

### Workflow folder

Every workflow lives in its own self-contained directory:

```
.flowai-workflow/<name>/
    workflow.yaml                  # required
    agents/agent-*.md              # required iff workflow.yaml references agent files
    memory/                        # optional; agent-*.md gitignored (runtime state)
    scripts/                       # optional
    runs/<run-id>/                 # generated, gitignored
        state.json                 # run state (persists across resume)
        <node-id>/...              # per-node artifact dirs
        worktree/                  # FR-E57: per-run git worktree
```

Multiple workflows in one project: keep them as siblings under
`.flowai-workflow/`; each is fully isolated. `git mv` a folder to share
it with another repo — it carries everything it needs.

### Init flags

```
flowai-workflow init [--workflow <name>] [--dry-run] [--allow-dirty]
```

- `--workflow <name>` — workflow folder under `<package>/.flowai-workflow/`
  (default: `github-inbox`). Omit for the interactive picker on a TTY;
  pipe stdin or pass explicitly in CI to skip the prompt.
- `-l`, `--list` — enumerate every workflow this build ships, exit 0.
  The set is identical for the JSR install, the standalone binary, and
  a local `deno run`; the binary embeds them via `deno compile
  --include` so installs without a network can still scaffold.
- `--dry-run` — print the files that would be written, exit 0.
- `--allow-dirty` — skip the clean-git-tree preflight check.

### Preflight

Init verifies before writing any file:

- `cwd` is inside a git worktree.
- The target `.flowai-workflow/<workflow>/` directory does not already
  exist.
- (Unless `--allow-dirty`) the working tree is clean.

Workflow-specific dependencies (`gh` CLI, `claude`/`opencode` runtime,
GitHub remote, etc.) are NOT pre-checked here — they surface at first
run. Each workflow's `agents/` describe what it needs.

Init writes **only** inside `.flowai-workflow/<workflow>/` — no
native-IDE subagent registry writes, no top-level `.gitignore` append,
no files outside the target directory. Run `flowai-workflow init
--dry-run` to preview the file list before committing.

## Quick Start

```bash
# Run a workflow
deno task run

# Pass additional context
deno task run --prompt "Focus on performance issues"

# Resume a failed/interrupted run
deno task run --resume <run-id>

# Dry run (validate config, show DAG, no execution)
deno task run --dry-run
```

## CLI Flags

```
flowai-workflow run <workflow> [OPTIONS]

Positional:
  <workflow>          Path to workflow folder containing workflow.yaml
                      (mandatory; no autodetect).

Options:
  --prompt <text>     Additional context passed to first agent
  --resume <run-id>   Resume a previous run (skip completed nodes)
  --dry-run           Validate config and show DAG without executing
  --skip <nodes>      Comma-separated node IDs to skip
  --only <nodes>      Run only specified nodes
  --env KEY=VAL       Set environment variable for the run
  -q                  Quiet output (minimal status)
  -s                  Show text output only (suppress tool calls)
  -v                  Verbose output (detailed agent diagnostics)
```

## Configuration

Workflow behavior is defined in a YAML config file. Key settings under `defaults:`:

- `runtime` — agent runtime: `claude` (default), `opencode`, or `cursor`
- `runtime_args` — extra CLI args forwarded to the selected runtime
- `max_continuations` — max agent re-invocations on validation failure (default: 3)
- `max_parallel` — concurrent node execution limit (default: 2)
- `timeout_seconds` — per-node timeout (default: 1800)
- `permission_mode` — permission mode override (Claude: full support; opencode/cursor: only `bypassPermissions`)
- `hitl` — Human-in-the-Loop config: `ask_script`, `check_script`, `poll_interval`, `timeout` (used by Claude directly and by OpenCode via injected local MCP)

Node-level overrides are supported for all defaults.

Minimal runtime example:

```yaml
defaults:
  runtime: opencode
  model: anthropic/claude-sonnet-4-5
  runtime_args: ["--variant", "high"]

nodes:
  build:
    type: agent
    label: Build
    prompt: "Implement the change and summarize the result."
```

## Example: SDLC Workflow

The engine is developed using its own SDLC workflow (dogfooding). This workflow automates the full software development lifecycle — from GitHub Issue triage to merged PR — via a chain of specialized AI agents.

```mermaid
graph TD
    subgraph plan ["plan"]
        spec["<b>specification</b><br/>PM — Spec"]
        design["<b>design</b><br/>Architect — Plan"]
        decision["<b>decision</b><br/>Tech Lead — Decision"]
        spec --> design --> decision
    end

    subgraph impl ["impl · loop max 3"]
        build["<b>build</b><br/>Developer"]
        verify["<b>verify</b><br/>QA"]
        build --> verify
        verify -- "verdict: FAIL" --> build
    end

    subgraph report ["report · run_on: always"]
        review["<b>tech-lead-review</b><br/>Review + CI + Merge"]
    end

    decision --> build
    verify -- "verdict: PASS" --> review
```

Workflow config: `.flowai-workflow/<workflow-name>/workflow.yaml`

| Node | Phase | Role | Output |
|------|-------|------|--------|
| `specification` | plan | Project Manager — Specification | `01-spec.md` |
| `design` | plan | Architect — Design-Solution Plan | `02-plan.md` |
| `decision` | plan | Tech Lead — Decision + Branch + PR | `03-decision.md` |
| `implementation` | impl | Developer+QA loop (max 3 iterations) | implementation + `05-qa-report.md` |
| `tech-lead-review` | report | Tech Lead Review — Final Review + Merge (run_on: always) | `06-review.md` |

All 6 workflow agents are framework-independent Markdown files at
`.flowai-workflow/<workflow-name>/agents/agent-<role>.md`:

- `agent-pm` — Project Manager (specification)
- `agent-architect` — Architect (design-solution plan)
- `agent-tech-lead` — Tech Lead (decision & branch & PR)
- `agent-developer` — Developer (implementation)
- `agent-qa` — QA (verification)
- `agent-tech-lead-review` — Tech Lead Review (final review & merge)

## Project Structure

```
cli.ts, engine.ts, agent.ts, ... # DAG executor engine modules (root)
init/                            # Project scaffolder (`flowai-workflow init`)
scripts/                         # Dev tooling (check, compile, dashboard, release-notes)
.flowai-workflow/                # One folder per workflow (FR-S47)
  github-inbox/                  # Workflow folder = portable unit
    workflow.yaml
    agents/agent-*.md            # Agent prompts (per-workflow copy)
    memory/                      # reflection-protocol.md tracked; agent-*.md gitignored
    runs/<run-id>/               # Per-run umbrella (gitignored). FR-E57: state,
                                 # node artifacts, and the run's git worktree
                                 # all live side-by-side here.
      state.json
      <node-id>/...
      worktree/                  # Isolated git worktree (FR-E57)
    scripts/                     # HITL & hook scripts
  github-inbox-opencode/         # Sibling workflow with different runtime
    …
documents/
  requirements-engine.md         # SRS — Engine scope
  requirements-sdlc.md           # SRS — SDLC Workflow scope
  design-engine.md               # SDS — Engine scope
  design-sdlc.md                 # SDS — SDLC Workflow scope
scripts/
  check.ts                       # Full verification: fmt, lint, test, gitleaks
```

## Installation

Download a pre-built binary from the [latest release](../../releases/latest) — no Deno required:

```bash
# Linux x86_64
gh release download --repo <owner>/flowai-workflow --pattern flowai-workflow-linux-x86_64
chmod +x flowai-workflow-linux-x86_64 && mv flowai-workflow-linux-x86_64 flowai-workflow

# macOS Apple Silicon
gh release download --repo <owner>/flowai-workflow --pattern flowai-workflow-darwin-arm64
chmod +x flowai-workflow-darwin-arm64 && mv flowai-workflow-darwin-arm64 flowai-workflow

# Verify
./flowai-workflow --version

# Run a workflow
./flowai-workflow run .flowai-workflow/<workflow-name>
```

Alternatively, run directly with Deno (see Prerequisites below).

## Prerequisites

- [Deno](https://deno.land/) runtime (required only if not using a pre-built binary)
- Docker / devcontainer (runtime environment)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`) for Claude runtime
- [OpenCode CLI](https://opencode.ai/) (`opencode`) for OpenCode runtime
- [`gh` CLI](https://cli.github.com/) for GitHub API interaction (SDLC workflow)
- Git

## Development Commands

```bash
deno task run              # Run the workflow
deno task check            # Full verification: format, lint, test, gitleaks
deno task test             # Run all tests
deno task test:engine      # Run engine tests only
deno task fmt              # Format code
deno task run:validate     # Type-check engine modules
```

## Authentication

- **Claude Code CLI** — OAuth session (`claude login`) or `ANTHROPIC_API_KEY` env var
- **OpenCode CLI** — configured providers/models in local OpenCode config
- **`GITHUB_TOKEN`** — required for PR creation and issue comments (set manually or via `gh auth login`)

## License

Private project.
