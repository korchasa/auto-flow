# auto-flow

Fully autonomous software development pipeline: from GitHub Issue triage to merged PR — no human gates between stages.

A locally-run system where `deno task run` triggers a DAG-based chain of specialized AI agents (Claude Code CLI). PM agent autonomously selects the highest-priority open issue; each agent performs a distinct SDLC role (PM, Tech Lead, Reviewer, Architect, SDS Update, Executor, QA, Presenter, Meta-Agent).

## How It Works

The pipeline engine (`engine/`, Deno/TypeScript) reads a YAML config (`.sdlc/pipeline.yaml`) and builds a directed acyclic graph (DAG) of nodes. Nodes are sorted topologically into parallel levels and executed concurrently (configurable `max_parallel`).

Four node types:

- **agent** — invokes Claude Code CLI with a role-specific prompt
- **merge** — combines outputs from multiple predecessor nodes
- **loop** — iterative body with frontmatter-based exit condition (e.g., Executor+QA cycle)
- **human** — terminal prompt for manual input; also supports Human-in-the-Loop (HITL) via GitHub issue comments

Inter-agent communication uses structured Markdown artifacts in `.sdlc/runs/<run-id>/[<phase>/]<node-id>/`, linked via `{{input.<node-id>}}` template variables (e.g. `{{input.specification}}`, `{{input.decision}}`). On validation failure, the engine resumes the agent in the same session with error context (continuation mechanism).

## Pipeline Stages

| Node | Phase | Role | Output |
|------|-------|------|--------|
| `specification` | plan | Project Manager — Specification | `01-spec.md` |
| `design` | plan | Architect — Design-Solution Plan | `02-plan.md` |
| `decision` | plan | Tech Lead — Decision + Branch + PR | `04-decision.md` |
| `implementation` | impl | Executor+QA loop (max 3 iterations) | implementation + `05-qa-report.md` |
| `review` | report | Tech Lead Review — Final Review + Merge (run_on: always) | `08-review.md` |
| `optimize` | report | Meta-Agent — Prompt Optimization (run_on: always) | `07-changelog.md` |

## Architecture

- **Engine:** `engine/` — Deno/TypeScript DAG executor with YAML config, template interpolation, parallel levels, loop nodes, HITL support, resume capability
- **Agent prompts:** `agents/<name>/SKILL.md` — 7 agents with YAML frontmatter; dual-use as pipeline prompts and Claude Code skills
- **Artifact store:** `.sdlc/runs/<run-id>/<node-id>/` — per-run isolation, git-tracked
- **State:** `.sdlc/runs/<run-id>/state.json` — tracks node completion for resume
- **Validation:** Rule-based checks per node (file_exists, file_not_empty, contains_section, custom_script, frontmatter_field)
- **Commit strategy:** Engine does not auto-commit; executor agent owns `git add`, `git commit`, `git push` per task
- **Observability:** 3 verbosity levels (`-q` / default / `-v`); status lines with timestamps; final summary
- **Legacy:** Shell scripts in `.sdlc/scripts/` preserved for backward compatibility, superseded by engine

## Prerequisites

- [Deno](https://deno.land/) runtime
- Docker / devcontainer (runtime environment)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
- [`gh` CLI](https://cli.github.com/) for GitHub API interaction
- Git

## Quick Start

```bash
# Run the full pipeline (PM auto-selects highest-priority open issue)
deno task run

# Pass additional context to PM
deno task run --prompt "Focus on performance issues"

# Resume a failed/interrupted run
deno task run --resume <run-id>

# Dry run (validate config, show DAG, no execution)
deno task run --dry-run
```

## Configuration

Pipeline behavior is defined in `.sdlc/pipeline.yaml`. Key settings under `defaults:`:

- `max_continuations` — max agent re-invocations on validation failure (default: 3)
- `max_parallel` — concurrent node execution limit (default: 2)
- `timeout_seconds` — per-node timeout (default: 1800)
- `hitl` — Human-in-the-Loop config: `ask_script`, `check_script`, `poll_interval`, `timeout`

Node-level overrides are supported for all defaults.

## CLI Flags

```
deno task run [OPTIONS]

Options:
  --prompt <text>     Additional context passed to PM agent
  --resume <run-id>   Resume a previous run (skip completed nodes)
  --dry-run           Validate config and show DAG without executing
  --config <path>     Custom pipeline config (default: .sdlc/pipeline.yaml)
  --skip <nodes>      Comma-separated node IDs to skip
  --only <nodes>      Run only specified nodes
  --env KEY=VAL       Set environment variable for the run
  -v                  Verbose output (detailed agent diagnostics)
  -q                  Quiet output (minimal status)
```

## Agents as Skills

All 7 pipeline agents are also available as Claude Code slash commands via `.claude/skills/agent-<name>` symlinks pointing to `agents/<name>/`.

Available commands:

- `/agent-pm` — Project Manager (specification)
- `/agent-architect` — Architect (design-solution plan)
- `/agent-tech-lead` — Tech Lead (decision & branch & PR)
- `/agent-executor` — Executor (implementation)
- `/agent-qa` — QA (verification)
- `/agent-tech-lead-review` — Tech Lead Review (final review & merge)
- `/agent-meta-agent` — Meta-Agent (prompt optimization)

## Project Structure

```
agents/                    # Agent prompts (7 agents)
  pm/SKILL.md
  architect/SKILL.md
  tech-lead/SKILL.md
  executor/SKILL.md
  qa/SKILL.md
  tech-lead-review/SKILL.md
  meta-agent/SKILL.md
.sdlc/
  engine/                  # Pipeline engine (Deno/TypeScript)
  pipeline.yaml            # Pipeline DAG configuration
  runs/                    # Per-run artifacts and state
  scripts/                 # Legacy shell scripts + HITL scripts
.claude/
  skills/                  # Symlinks: agent-<name> -> ../../agents/<name>/
documents/
  requirements.md          # Software Requirements Specification (SRS)
  design.md                # Software Design Specification (SDS)
scripts/
  check.ts                 # Full verification: fmt, lint, test, gitleaks
```

## Development Commands

```bash
deno task run              # Run the full pipeline
deno task check            # Full verification: format, lint, test, gitleaks
deno task test             # Run all tests
deno task test:engine      # Run engine tests only
deno task fmt              # Format code
deno task run:validate     # Type-check engine modules
```

## Authentication

- **Claude Code CLI** — OAuth session (`claude login`) or `ANTHROPIC_API_KEY` env var
- **`GITHUB_TOKEN`** — required for PR creation and issue comments (set manually or via `gh auth login`)

## License

Private project.
