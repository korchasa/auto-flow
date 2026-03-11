# Consolidate to Single Autonomous Pipeline

## Goal

Eliminate dual-pipeline (`pipeline.yaml` + `pipeline-task.yaml`), remove
`--issue <N>` and `--task` from CLI. PM agent autonomously triages GitHub Issues.
Agents write comments to issues via `gh` themselves — engine has zero GitHub
knowledge. Business value: zero-friction launch (`deno task run`), single config,
PM owns triage.

## Overview

### Context

- Two near-identical pipeline configs: 200 lines duplicated, 3 lines differ
- CLI requires `--issue <N>` or `--task <file>` — user pre-selects work
- `{{args.issue}}` used in: pipeline templates, HITL (`hitl.ts:129,165`),
  engine runLabel (`engine.ts:80`), 10+ test files
- Agents currently don't write to issues — engine/scripts handle all GitHub I/O
- HITL scripts (`hitl-ask.sh`, `hitl-check.sh`) receive `--issue` from engine

### Current State

- **CLI**: `--issue` and `--task` flags, mutually exclusive; no `--prompt`
- **Pipeline**: PM reads `issue #{{args.issue}}`; presenter posts on `{{args.issue}}`
- **Engine**: `hitl.ts` passes `args.issue` to HITL scripts; `engine.ts:80`
  uses `args.issue` for run label
- **Agents**: no `gh issue comment` in any agent prompt — zero GitHub writes

### Constraints

- Engine = project-agnostic (zero GitHub/issue logic in engine core)
- HITL scripts = GitHub-specific boundary (acceptable)
- PM must output issue number in `01-spec.md` for downstream agents to read
- HITL scripts extract issue number from PM artifact via `issue_source` config
- `deno task check` must pass
- `yq` required in runtime environment (Docker image)

## Definition of Done

- [x] `pipeline-task.yaml` deleted
- [x] `deno task run:task` removed from `deno.json`
- [x] `--task` and `--issue` flags removed from CLI
- [x] `--prompt <text>` flag added to CLI (optional, sets `args.prompt`)
- [x] PM prompt: autonomously triages issues via `gh`; selects highest-priority
      open issue; sets `in-progress` label; writes `issue: N` in `01-spec.md`
      frontmatter; appends `args.prompt` if present
- [x] All agent prompts: read issue number from `{{input.pm}}/01-spec.md`,
      post progress to issue via `gh issue comment`
- [x] Presenter reads issue from PM artifact, creates PR + posts summary
- [x] Meta-agent reads issue from PM artifact, posts findings
- [x] Engine: zero `args.issue` references; runLabel from `args.prompt` or "auto"
- [x] HITL config: new `issue_source` field (relative to run_dir); scripts
      receive `--run-dir` + `--issue-source`, extract issue via `yq`
- [x] All `{{args.task}}`, `{{args.task_id}}`, `{{args.issue}}` removed from
      pipeline templates and engine code
- [x] CLI tests, engine tests, HITL tests updated
- [x] SRS updated: single entry point `deno task run [--prompt "..."]`
- [x] AGENTS.md updated
- [x] `deno task check` passes

## Solution

### Step 1 — Delete `pipeline-task.yaml` + clean `deno.json`

- Delete `.sdlc/pipeline-task.yaml`
- Remove `"run:task"` task from `deno.json`

### Step 2 — CLI: remove `--task`, `--issue`, add `--prompt`

**`cli.ts`**:
- Remove `case "--task"` block
- Remove `case "--issue"` block
- Remove mutual-exclusion check
- Add `case "--prompt"`: `cliArgs.prompt = args[++i]`
- Update `printUsage()`
- `engine.ts:80` runLabel: `args.prompt?.slice(0,20) ?? "auto"`

**`cli_test.ts`**:
- Remove all `--task` and `--issue` tests
- Add `--prompt` test

### Step 3 — Pipeline: remove `{{args.issue}}` from templates

**`pipeline.yaml`** PM `task_template`:
```yaml
Triage open GitHub issues and select the highest-priority one to implement.
Additional context: {{args.prompt}}
Output:
  - {{node_dir}}/01-spec.md (YAML frontmatter with `issue: <N>`,
    then problem, affected requirements, SRS changes, scope)
  - Update documents/requirements.md with new/modified requirements
```

Presenter `task_template`:
```yaml
Read issue number from {{input.pm}}/01-spec.md frontmatter.
Create a PR targeting main and post a summary comment on that issue.
Output: {{node_dir}}/06-summary.md
```

### Step 4 — Agent prompts: add `gh issue comment` responsibility

Each agent SKILL.md gets instruction to post progress to the issue.
Pattern:
```
Read the issue number from the PM spec at `{{input.pm}}/01-spec.md`
(YAML frontmatter `issue:` field). Post progress to that issue via
`gh issue comment <N> --body "..."`.
```

PM is special — determines issue number, posts after selection.

### Step 5 — PM agent prompt (`agents/pm/SKILL.md`)

Major rewrite:
1. Run `gh issue list --state open --json number,title,labels`
   → select highest-priority unassigned issue
2. Set label: `gh issue edit <N> --add-label "in-progress"`
3. Read issue: `gh issue view <N> --json body,title,comments`
4. Write `01-spec.md` with YAML frontmatter: `issue: <N>`
5. Post comment: "Pipeline started — specification phase"
6. If no open issues → fail fast with clear error

### Step 6 — HITL: `issue_source` config + `--run-dir`

**`pipeline.yaml`** HITL config:
```yaml
hitl:
  ask_script: .sdlc/scripts/hitl-ask.sh
  check_script: .sdlc/scripts/hitl-check.sh
  issue_source: pm/01-spec.md    # relative to run_dir
  poll_interval: 60
  timeout: 7200
  bot_login: "github-actions[bot]"
```

**`types.ts`** — `HitlConfig`: add `issue_source: string`

**`hitl.ts`** — `buildScriptArgs()`:
- Remove `--issue` / `--repo` args
- Add `--run-dir ${runDir}` and `--issue-source ${config.issue_source}`

**`hitl-ask.sh` / `hitl-check.sh`**:
- Parse `--run-dir` and `--issue-source`
- Extract: `ISSUE=$(yq '.issue' "$RUN_DIR/$ISSUE_SOURCE")`
- Extract repo: `REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)`

### Step 7 — Engine: remove all `args.issue` references

- `engine.ts:80`: `args.prompt?.slice(0,20) ?? "auto"`
- `hitl.ts:129,165`: pass `run_dir` + `issue_source` (Step 6)
- Remove `args.issue` from all engine code

### Step 8 — Update tests

- `cli_test.ts`: remove task/issue tests, add prompt test
- `template_test.ts`: keep as generic template tests (args.foo, etc.)
- `engine_test.ts`: update default args (no issue)
- `hitl_test.ts`: update to `run_dir` + `issue_source`
- `human_test.ts`: update template fixtures
- `agent_test.ts`, `config_test.ts`, `state_test.ts`: minor updates

### Step 9 — Update docs

**SRS** (`documents/requirements.md`):
- Remove `run:task`, `run:text`, `run:file` entry points
- Single entry: `deno task run [--prompt "..."]`
- Update PM: autonomous triage, highest-priority selection
- Update agents: self-posting to issues via `gh`

**AGENTS.md**: `run:task` → `run`

**SDS** (`documents/design.md`):
- CLI interface: `--prompt` only
- HITL: `issue_source` config, `--run-dir` args
- Agent model: agents write to issues

### Step 10 — GREEN + CHECK

`deno task check` → all tests pass, zero warnings/errors.

### Execution order

1. Step 1 (delete files)
2. Step 2 (CLI)
3. Step 3 (pipeline.yaml)
4. Step 5 (PM prompt)
5. Step 4 (other agent prompts)
6. Step 6 + 7 (HITL + engine)
7. Step 8 (tests)
8. Step 9 (docs)
9. Step 10 (check)
