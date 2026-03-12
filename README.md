# auto-flow

Fully autonomous software development pipeline: from GitHub Issue triage to merged PR — no human gates between stages.

A locally-run system where `deno task run` triggers a DAG-based chain of specialized AI agents (Claude Code CLI). PM agent autonomously selects the highest-priority open issue; each agent performs a distinct SDLC role (PM, Tech Lead, Reviewer, Architect, SDS Update, Executor, QA, Presenter, Meta-Agent).

## How It Works

The pipeline engine (`.sdlc/engine/`, Deno/TypeScript) reads a YAML config (`.sdlc/pipeline.yaml`) and builds a directed acyclic graph (DAG) of nodes. Nodes are sorted topologically into parallel levels and executed concurrently (configurable `max_parallel`).

Four node types:

- **agent** — invokes Claude Code CLI with a role-specific prompt
- **merge** — combines outputs from multiple predecessor nodes
- **loop** — iterative body with frontmatter-based exit condition (e.g., Executor+QA cycle)
- **human** — terminal prompt for manual input; also supports Human-in-the-Loop (HITL) via GitHub issue comments

Inter-agent communication uses structured Markdown artifacts in `.sdlc/runs/<run-id>/<node-id>/`, linked via `{{input.<node-id>}}` template variables. On validation failure, the engine resumes the agent in the same session with error context (continuation mechanism).

## Pipeline Stages

| Node | Role | Output |
|------|------|--------|
| `pm` | Project Manager — Specification | `01-spec.md` |
| `tech-lead` | Tech Lead — Implementation Plan | `02-plan.md` |
| `reviewer` | Tech Lead Reviewer — Critique & Revision | `03-revised-plan.md` |
| `architect` | Architect — Decision & Task Breakdown | `04-decision.md` |
| `sds-update` | Tech Lead — SDS Update | updated `documents/design.md` |
| `commit-plan` | Committer — plan phase | git commit |
| `impl-loop` | Executor+QA loop (max 3 iterations) | implementation + `05-qa-report.md` |
| `commit-impl` | Committer — impl phase | git commit |
| `presenter` | Presenter — Change Summary & PR | `06-summary.md` |
| `commit-present` | Committer — present phase | git commit |
| `meta-agent` | Meta-Agent — Prompt Analysis (runs always) | `07-meta-report.md` |

## Architecture

- **Engine:** `.sdlc/engine/` — Deno/TypeScript DAG executor with YAML config, template interpolation, parallel levels, loop nodes, HITL support, resume capability
- **Agent prompts:** `agents/<name>/SKILL.md` — 10 agents with YAML frontmatter; dual-use as pipeline prompts and Claude Code skills
- **Artifact store:** `.sdlc/runs/<run-id>/<node-id>/` — per-run isolation, git-tracked
- **State:** `.sdlc/runs/<run-id>/state.json` — tracks node completion for resume
- **Validation:** Rule-based checks per node (file_exists, file_not_empty, contains_section, custom_script, frontmatter_field)
- **Commit strategy:** Engine does not auto-commit; dedicated `committer` agent nodes handle commits at 3 pipeline points
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

All 10 pipeline agents are also available as Claude Code slash commands via `.claude/skills/agent-<name>` symlinks pointing to `agents/<name>/`.

Available commands:

- `/agent-pm` — Project Manager
- `/agent-tech-lead` — Tech Lead (implementation plan)
- `/agent-tech-lead-reviewer` — Tech Lead Reviewer (critique)
- `/agent-architect` — Architect (decision & task breakdown)
- `/agent-tech-lead-sds` — Tech Lead SDS (design spec update)
- `/agent-executor` — Executor (implementation)
- `/agent-qa` — QA (verification)
- `/agent-presenter` — Presenter (summary & PR)
- `/agent-meta-agent` — Meta-Agent (prompt analysis)
- `/agent-committer` — Committer (git commits)

## Project Structure

```
agents/                    # Agent prompts (10 agents)
  pm/SKILL.md
  tech-lead/SKILL.md
  tech-lead-reviewer/SKILL.md
  architect/SKILL.md
  tech-lead-sds/SKILL.md
  executor/SKILL.md
  qa/SKILL.md
  presenter/SKILL.md
  meta-agent/SKILL.md
  committer/SKILL.md
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
