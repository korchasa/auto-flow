---
name: flowai-workflow-setup
description: >
  Set up flowai-workflow engine in a project: create workflow YAML config,
  agent definitions, directory structure, and run scripts. Use when the user
  wants to add flowai-workflow to a project, create a new workflow, configure
  DAG-based agent pipelines, or asks about workflow setup/configuration.
---

# Setup flowai-workflow in a Project

Guide for configuring the flowai-workflow DAG engine in any project.

## Prerequisites

- `flowai-workflow` binary installed (or Deno runtime for source mode)
- Claude Code CLI (`claude`) installed and authenticated
- Git repository (engine uses worktrees by default)

## Directory Structure

Create this layout in the target project:

```
.flowai-workflow/
  workflow.yaml          # Main workflow config (required)
  runs/                  # Run artifacts (auto-created, gitignore)
  scripts/               # Helper scripts (HITL, hooks, optional)
  memory/                # Agent memory files (optional)
  prompts/               # Reusable prompt fragments (optional)
```

Add to `.gitignore`:

```
.flowai-workflow/runs/
```

## Workflow YAML Schema

Minimal valid config:

```yaml
name: "my-workflow"
version: "1"

nodes:
  my-agent:
    type: agent
    label: "My Agent"
    prompt: |
      Do the thing.
      Output: {{node_dir}}/result.md
```

### Top-Level Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Workflow identifier (used in logs, state files) |
| `version` | yes | Must be `"1"` |
| `defaults` | no | Global settings applied to all nodes |
| `env` | no | Global env vars, accessible via `{{env.<key>}}` |
| `nodes` | yes | DAG node definitions (at least one) |
| `phases` | no | Group nodes into phases for organized artifact dirs |

### Defaults Block

```yaml
defaults:
  max_parallel: 2              # Concurrent node limit (0 = unlimited)
  max_continuations: 3         # Re-invocations on validation failure
  timeout_seconds: 1800        # Per-node wall-clock timeout
  max_retries: 3               # Full retry attempts after failure
  retry_delay_seconds: 5       # Delay between retries
  model: claude-sonnet-4-6     # Default Claude model
  permission_mode: bypassPermissions  # Claude CLI permission mode
  worktree_disabled: false     # true = run in CWD instead of worktree
  on_failure_script: path/to/script.sh  # Runs on workflow failure
  prepare_command: "echo setup"  # Runs once before node execution (fresh runs only)
  hitl:                        # Human-in-the-loop config
    ask_script: scripts/ask.sh
    check_script: scripts/check.sh
    poll_interval: 60
    timeout: 7200
```

### Node Types

#### Agent Node

Invokes Claude Code CLI with a prompt:

```yaml
my-agent:
  type: agent
  label: "Role — Description"
  inputs: [dependency-node]     # DAG edges (optional)
  model: claude-opus-4-6        # Override default model (optional)
  permission_mode: acceptEdits  # Override default (optional)
  system_prompt: |              # Injected via --append-system-prompt (optional)
    {{file(".flowai-workflow/prompts/my-agent.md")}}
  prompt: |                     # Task prompt via -p flag (required)
    Read input at {{input.dependency-node}}/artifact.md.
    Output: {{node_dir}}/result.md
  before: "echo starting"      # Pre-execution hook (optional)
  after: "echo done"           # Post-execution hook (optional)
  validate:                    # Artifact validation (optional)
    - type: artifact
      path: "{{node_dir}}/result.md"
      sections: ["Summary"]
  settings:                    # Per-node overrides (optional)
    timeout_seconds: 3600
    on_error: continue
```

`system_prompt` is optional. Use `{{file()}}` to inline reusable prompt
fragments from any path — `.flowai-workflow/prompts/`, project docs, or
IDE-specific locations like `.claude/agents/`.

#### Loop Node

Iterative body with exit condition:

```yaml
my-loop:
  type: loop
  label: "Iterative Process"
  inputs: [prior-node]
  condition_node: checker       # Body node to check
  condition_field: verdict      # Frontmatter field to evaluate
  exit_value: PASS              # Value that stops the loop
  max_iterations: 3
  nodes:
    worker:
      type: agent
      label: "Worker"
      inputs: [prior-node]      # Can reference external inputs
      prompt: |
        Iteration {{loop.iteration}}.
        Output: {{node_dir}}/work.md
    checker:
      type: agent
      label: "Checker"
      inputs: [worker]          # Must reference another body node
      prompt: |
        Check {{input.worker}}/work.md.
        Output: {{node_dir}}/check.md with frontmatter verdict: PASS or FAIL
      validate:
        - type: frontmatter_field
          path: "{{node_dir}}/check.md"
          field: verdict
          allowed: [PASS, FAIL]
```

**Loop rules:**
- `condition_node` must be a key in the loop's `nodes`
- If >1 body node, at least one must have `inputs` referencing another body node
- Body nodes referencing external inputs must list them in loop's `inputs`
- If condition node has `validate`, it must include `frontmatter_field` matching `condition_field`

#### Human Node

Terminal prompt for manual input:

```yaml
approval:
  type: human
  label: "Human Approval"
  inputs: [prior-node]
  question: "Approve the changes? (yes/no)"
  options: [yes, no]
  abort_on: [no]
```

#### Merge Node

Combines outputs from multiple nodes:

```yaml
combined:
  type: merge
  label: "Merge Inputs"
  inputs: [node-a, node-b]
  merge_strategy: copy_all
```

### Template Variables

Available in `prompt`, `system_prompt`, `before`, `after`, and validation paths:

| Variable | Description |
|----------|-------------|
| `{{node_dir}}` | Current node's artifact directory |
| `{{run_dir}}` | Run root directory |
| `{{run_id}}` | Unique run identifier |
| `{{input.<node-id>}}` | Dependency node's artifact directory |
| `{{args.<key>}}` | CLI argument value |
| `{{env.<key>}}` | Environment variable |
| `{{loop.iteration}}` | Current loop iteration (loop body only) |
| `{{file("path")}}` | Inline file content (relative to project root) |

### Validation Rules

| Type | Description | Extra Fields |
|------|-------------|--------------|
| `artifact` | Check sections/frontmatter in .md file | `sections`, `fields` |
| `file_exists` | File exists at path | — |
| `file_not_empty` | File exists and is non-empty | — |
| `contains_section` | File contains markdown section | `value` (heading text) |
| `frontmatter_field` | YAML frontmatter has specific field | `field`, `allowed` (optional) |
| `custom_script` | Run shell command, 0 = pass | `path` (command string) |

### Phases

Group nodes for organized artifact directories (`<run-dir>/<phase>/<node-id>/`):

```yaml
phases:
  planning: [spec, design]
  execution: [build, test]
  review: [final-review]
```

Without phases, artifacts go to `<run-dir>/<node-id>/`.

**Rule:** `phases` block and per-node `phase:` field cannot coexist.

### Post-Workflow Nodes

Nodes that run after all DAG levels complete:

```yaml
cleanup:
  type: agent
  label: "Post-workflow cleanup"
  run_on: always    # always | success | failure
  inputs: [some-node]
  prompt: "..."
```

### Scope Check (allowed_paths)

Restrict which files an agent can modify:

```yaml
my-agent:
  type: agent
  allowed_paths: ["src/**/*.ts", "tests/**"]
  # ...
```

## Prompt Files

Store reusable prompt fragments (role descriptions, constraints, output formats)
as `.md` files anywhere in the project. Common locations:

- `.flowai-workflow/prompts/` — workflow-specific prompts (recommended default)
- `prompts/` or `docs/prompts/` — shared across workflows
- `.claude/agents/` — if also used as Claude Code native subagents

Reference from workflow via `{{file()}}`:

```yaml
system_prompt: |
  {{file(".flowai-workflow/prompts/reviewer.md")}}
```

Prompt files are plain markdown — role description, constraints, output format.
The engine inlines file content at runtime, no special format required.

## Running

```bash
# Run workflow
flowai-workflow --config .flowai-workflow/workflow.yaml

# Or with deno (source mode)
deno run -A engine/cli.ts --config .flowai-workflow/workflow.yaml

# With additional context
flowai-workflow --config .flowai-workflow/workflow.yaml --prompt "Focus on X"

# Resume failed run
flowai-workflow --config .flowai-workflow/workflow.yaml --resume <run-id>

# Dry run (validate + show DAG)
flowai-workflow --config .flowai-workflow/workflow.yaml --dry-run

# Skip/only specific nodes
flowai-workflow --config .flowai-workflow/workflow.yaml --skip node-a,node-b
flowai-workflow --config .flowai-workflow/workflow.yaml --only node-c

# Verbosity: -q (quiet), -s (semi), -v (verbose)
flowai-workflow --config .flowai-workflow/workflow.yaml -v
```

## Setup Checklist

- [ ] Create `.flowai-workflow/` directory
- [ ] Create `.flowai-workflow/workflow.yaml` with nodes
- [ ] Create prompt files if using `{{file()}}` (e.g. in `.flowai-workflow/prompts/`)
- [ ] Add `.flowai-workflow/runs/` to `.gitignore`
- [ ] Run `flowai-workflow --dry-run` to validate config
- [ ] Test with a single node first, expand DAG incrementally

## Common Patterns

### Linear Pipeline

```yaml
nodes:
  step1:
    type: agent
    label: "Step 1"
    prompt: "..."
  step2:
    type: agent
    label: "Step 2"
    inputs: [step1]
    prompt: "Read {{input.step1}}/output.md ..."
  step3:
    type: agent
    label: "Step 3"
    inputs: [step2]
    prompt: "Read {{input.step2}}/output.md ..."
```

### Fan-Out / Fan-In

```yaml
nodes:
  source:
    type: agent
    label: "Source"
    prompt: "..."
  branch-a:
    type: agent
    label: "Branch A"
    inputs: [source]
    prompt: "..."
  branch-b:
    type: agent
    label: "Branch B"
    inputs: [source]
    prompt: "..."
  merge:
    type: merge
    label: "Combine"
    inputs: [branch-a, branch-b]
  final:
    type: agent
    label: "Final"
    inputs: [merge]
    prompt: "..."
```

### Human Gate

```yaml
nodes:
  draft:
    type: agent
    label: "Draft"
    prompt: "..."
  review:
    type: human
    label: "Approve Draft"
    inputs: [draft]
    question: "Approve? (yes/no/revise)"
    options: [yes, no, revise]
    abort_on: [no]
  publish:
    type: agent
    label: "Publish"
    inputs: [draft, review]
    prompt: "..."
```
