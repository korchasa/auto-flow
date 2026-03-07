# auto-flow

Fully autonomous software development pipeline: from GitHub Issue to merged PR — no human gates between stages.

A CI/CD-integrated system where a labeled GitHub Issue triggers a chain of specialized AI agents (Claude Code CLI), each performing a distinct SDLC role.

## How It Works

1. A GitHub Issue with the `agent-pipeline` label triggers the pipeline
2. Specialized agents execute sequentially, each producing structured artifacts
3. Agents communicate via Markdown files committed to the repository
4. A Pull Request is created automatically for human review — the only manual checkpoint

### Pipeline Stages

- **Stage 1 — Project Manager**: Reads the issue, produces a specification (`01-spec.md`), updates SRS
- **Stage 2 — Tech Lead**: Creates an implementation plan with 2-3 variants (`02-plan.md`)
- **Stage 3 — Reviewer**: Critiques and revises the plan (`03-revised-plan.md`)
- **Stage 4 — Architect**: Selects a variant, produces task breakdown (`04-decision.md`)
- **Stage 5 — Tech Lead (SDS)**: Updates the Software Design Specification
- **Stage 6-7 — Executor + QA**: Iterative implementation/verification loop (max 3 iterations)
- **Stage 8 — Presenter**: Creates PR with a human-readable summary (`06-summary.md`)
- **Stage 9 — Meta-Agent**: Analyzes logs, auto-applies prompt improvements

## Architecture

- **Pattern**: Multi-agent pipeline with sequential stages and iterative loops
- **Orchestration**: Shell scripts in `.sdlc/scripts/` invoke `claude` CLI with role-specific prompts
- **Inter-agent communication**: Structured Markdown artifacts in `.sdlc/pipeline/<issue-number>/`
- **Continuation mechanism**: `--resume` flag for re-invoking agents on validation failure
- **Safety checks**: Diff-based scope validation, secret detection via `gitleaks`

## Tech Stack

- **Deno** — scripting, utilities, validation, task runner
- **Shell/Bash** — stage orchestration scripts
- **Docker** — single runtime image for all stages
- **GitHub Actions** — CI/CD pipeline trigger and execution
- **Claude Code CLI** (`claude`) — AI agent runtime
- **`gh` CLI** — GitHub API interaction (PRs, issue comments)

## Project Structure

```
.sdlc/
  agents/          # Agent system prompts (versioned)
  scripts/         # Stage orchestration scripts + lib.sh
  pipeline/        # Per-issue artifacts and logs
documents/
  requirements.md  # Software Requirements Specification (SRS)
  design.md        # Software Design Specification (SDS)
scripts/           # Deno task scripts (check, test, dev, prod)
```

## Development

### Prerequisites

- [Deno](https://deno.land/) runtime
- Claude Code CLI (`@anthropic-ai/claude-code`)
- `gh` CLI for GitHub API interaction

### Commands

```bash
deno task check    # Full verification: format, lint, test, comment-scan
deno task test     # Run all tests
```

## Configuration

All pipeline configuration is via environment variables:

- `SDLC_MAX_CONTINUATIONS` — max continuations per stage (default: `3`)
- `SDLC_MAX_QA_ITERATIONS` — max Executor+QA loop iterations (default: `3`)
- `SDLC_STAGE_TIMEOUT_MINUTES` — default timeout per stage in minutes (default: `30`)

### Required Secrets (GitHub Actions)

- `ANTHROPIC_API_KEY` — API key for Claude Code CLI
- `GITHUB_TOKEN` — for PR creation and issue comments (auto-provided by GitHub Actions)

## License

Private project.
