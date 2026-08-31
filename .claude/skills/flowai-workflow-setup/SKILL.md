---
name: flowai-workflow-setup
description: >
  Set up flowai-workflow engine in a project: create workflow YAML config,
  agent definitions, directory structure, and run scripts. Use when the user
  wants to add flowai-workflow to a project, create a new workflow, configure
  DAG-based agent pipelines, or asks about workflow setup/configuration.
---

# Setup flowai-workflow in a Project

Complete reference for configuring the flowai-workflow DAG engine. Covers every field accepted by `workflow.yaml` and every CLI flag.

## Prerequisites

- `flowai-workflow` binary (JSR install or `deno compile`), or Deno runtime for source mode.
- One of the supported AI IDE CLIs installed and authenticated: `claude` (Claude Code), `opencode`, `cursor`, `codex`. Match the CLI to `defaults.runtime`.
- Git repository — engine creates per-run worktrees by default (`worktree_disabled: false`).

## Directory Structure

```
.flowai-workflow/
  <workflow-name>/
    workflow.yaml          # Workflow config (required, name-locked to folder)
    agents/                # Reusable system_prompt fragments (recommended)
      agent-*.md
    prompts/               # Reusable user-prompt fragments (optional)
    scripts/               # HITL ask/check, prepare, on_failure scripts
    memory/                # Agent reflection-memory (FR-S28)
      reflection-protocol.md     # tracked
      agent-*.md                 # gitignored, per-run
    runs/                  # Per-run state + worktrees (gitignore)
      <run-id>/
        state.json
        worktree/
        <node-id>/         # node artifacts
```

`.gitignore`:

```
.flowai-workflow/<workflow-name>/runs/
.flowai-workflow/<workflow-name>/memory/agent-*.md
!.flowai-workflow/<workflow-name>/memory/agent-*-history.md
```

## Top-Level Fields (`workflow.yaml`)

- `name` (string, **required**) — workflow identifier; appears in logs and `state.json`.
- `version` (string, **required**) — must be `"1"` (only schema version supported).
- `defaults` (object, optional) — workflow-wide defaults, see below.
- `env` (object, optional) — `Record<string, string>`; merged into agent env, accessible as `{{env.<key>}}`.
- `nodes` (object, **required**) — DAG node definitions; at least one entry.
- `phases` (object, optional) — `Record<string, string[]>` mapping phase name to node IDs. Mutually exclusive with per-node `phase:` field.

`pre_run` was removed — use `defaults.worktree_disabled: true` to opt out of worktree isolation. The engine rejects `pre_run` with a migration error.

## `defaults` Block (workflow-wide)

Every field is optional; engine fallbacks shown.

### Execution

- `worktree_disabled` (boolean, default `false`) — when `true`, engine runs in CWD instead of creating per-run git worktrees. Two-phase loaded: read before worktree creation.
- `max_parallel` (number, default `0`) — concurrent node cap; `0` means unlimited. Note: parallel execution is currently deferred — nodes run sequentially.
- `prepare_command` (string, default `""`) — shell command run once before the node loop on **fresh** runs (skipped on resume). Templated with `run_dir`, `run_id`, `env.*`, `args.*`. Non-zero exit aborts the workflow.
- `on_failure_script` (string, default `""`) — script invoked when the workflow fails (FR-E19).

### Runtime selection

- `runtime` (`"claude" | "opencode" | "cursor" | "codex"`, default `"claude"`) — selects which AI IDE CLI executes agent nodes.
- `runtime_args` (`Record<string, string | null>`, default `{}`) — generic extra CLI args forwarded to the runtime:
  - `{ "--flag": "value" }` — flag with value
  - `{ "--bool": "" }` — boolean flag (empty string)
  - `{ "--suppressed": null }` — suppress a parent-supplied flag
  - Reserved keys forbidden when typed `allowed_tools`/`disallowed_tools` is set: `--allowedTools`, `--allowed-tools`, `--disallowedTools`, `--disallowed-tools`, `--tools`.
- `permission_mode` (`"acceptEdits" | "bypassPermissions" | "default" | "plan"`, no default) — Claude `--permission-mode`. For `opencode` and `cursor`, only `bypassPermissions` is supported; other values fail validation.
- `model` (string, default `""`) — model ID forwarded to the runtime (e.g. `"claude-sonnet-4-6"`, `"claude-opus-4-7"`).
- `effort` (`"minimal" | "low" | "medium" | "high"`, no default) — reasoning effort dial (FR-E42). Maps to Claude `--effort`, Codex `--config model_reasoning_effort=…`, OpenCode `--variant`. Cursor warns and ignores. Skipped on `--resume` (session inherits).

### Per-node settings (cascade into every node's `settings`)

- `max_continuations` (number, default `3`) — re-invocations on validation failure within the same Claude session.
- `timeout_seconds` (number, default `1800`) — wall-clock cap per node.
- `on_error` (`"fail" | "continue"`, default `"fail"`) — node failure policy.
- `max_retries` (number, default `3`) — full retry attempts after failure.
- `retry_delay_seconds` (number, default `5`) — delay between retries.

### Budget (FR-E47)

- `budget` (object, no default):
  - `max_usd` (positive number, optional) — per-node `cost_usd` cap.
  - `max_turns` (positive integer, optional) — Claude only, maps to `--max-turns`. Other runtimes warn once and ignore.

### Tool filter (FR-E48; mutually exclusive)

- `allowed_tools` (string[], no default) — whitelist; Claude `--allowedTools <comma-joined>`. Other runtimes warn and ignore.
- `disallowed_tools` (string[], no default) — blacklist.

### Memory check (FR-S28)

- `memory_paths` (string[], no default) — globs identifying agent reflection-memory files. After every agent invocation under worktree isolation, dirty matches without `memory_commit_deferred: true` fail the node. Empty/undefined disables the check entirely.

### HITL (Human-in-the-loop)

- `hitl` (object, no default — engine fallback is empty scripts):
  - `ask_script` (string, **required if hitl set**) — script that posts the question.
  - `check_script` (string, **required if hitl set**) — script polled for the response.
  - `artifact_source` (string, optional) — relative path from `run_dir` to artifact carrying issue frontmatter.
  - `poll_interval` (number, default `60`) — seconds between polls.
  - `timeout` (number, default `7200`) — max seconds to wait.
  - `exclude_login` (string, optional) — login excluded from HITL replies (e.g. bot's own).

## Node Types

Every node accepts these **common** fields:

- `type` (`"agent" | "loop" | "merge" | "human"`, **required**).
- `label` (string, **required**) — shown in logs and status output.
- `inputs` (string[], optional) — DAG edges; node IDs whose artifacts this node consumes.
- `phase` (string, optional) — alternative to top-level `phases:`. Mutually exclusive with the top-level block.
- `run_on` (`"always" | "success" | "failure" | "every_attempt"`, optional) — when set, node runs after the graph, once its outcome is known. The first three run at most once per run, so `--resume` does not repeat a node that already completed; `every_attempt` opts the node into running again on each resume. `run_always: true` is the legacy alias and is normalized to `run_on: "always"`. The outcome is readable as `{{run.outcome}}` and the invocation counter as `{{run.attempt}}`, in prompts and in `when` predicates alike.
- `before` (string, optional) — shell command run before the node; templated.
- `after` (string, optional) — shell command run after success; templated.
- `settings` (object, optional) — overrides `max_continuations`, `timeout_seconds`, `on_error`, `max_retries`, `retry_delay_seconds` (any unknown key throws).
- `validate` (ValidationRule[], optional) — see [Validation Rules](#validation-rules).
- `env` (`Record<string, string>`, optional) — node-level env vars merged over global `env`.

### `agent`

Invokes the AI IDE CLI with a prompt. Required: `prompt`.

- `prompt` (string, **required**) — task prompt; templated.
- `system_prompt` (string, optional) — appended via `--append-system-prompt`; templated. Use `{{file()}}` / `{{flow_file()}}` to inline reusable role files.
- `agent` (string, optional) — name of an IDE-native subagent (without `.md`). Resolved by the runtime against its own subagent registry.
- `model` (string, optional) — overrides `defaults.model`.
- `effort` (effort enum, optional) — overrides `defaults.effort`. Cascade: node → enclosing loop → defaults.
- `runtime` (runtime enum, optional) — overrides `defaults.runtime`.
- `runtime_args` (ExtraArgsMap, optional) — merged with defaults (per-key); same shape as `defaults.runtime_args`.
- `permission_mode` (enum, optional) — overrides `defaults.permission_mode`.
- `allowed_paths` (string[], optional, FR-E37) — glob patterns of paths the agent may modify. Engine snapshots before/after under worktree isolation; mismatches inject a `scope_check` validation failure. Pre-existing uncommitted changes are excluded from the diff.
- `budget` (NodeBudget, optional) — overrides `defaults.budget`. Cascade: node → enclosing loop → defaults.
- `allowed_tools` / `disallowed_tools` (string[], optional, REPLACE semantics) — node→loop→defaults, first-defined level wins; no merge.
- `memory_commit_deferred` (boolean, default `false`, FR-S28) — opt out of the per-invocation memory-dirty check. Useful for loop bodies that legitimately defer the commit. Only meaningful when `defaults.memory_paths` is set.

### `loop`

Iterative body with exit condition. Required: `nodes`, `condition_node`, `condition_field`, `exit_value`.

- `nodes` (`Record<string, NodeConfig>`, **required**) — inline body node definitions.
- `condition_node` (string, **required**) — body node ID whose output is inspected for the exit value.
- `condition_field` (string, **required**) — frontmatter field on the condition node's artifact whose value is matched against `exit_value`.
- `exit_value` (string, **required**) — value that terminates the loop.
- `max_iterations` (number, optional) — safety cap; engine aborts loop on reach.
- `effort`, `budget`, `allowed_tools`, `disallowed_tools`, `runtime_args` — inherited by body nodes via cascade.

**Loop validation rules (enforced at config load):**

- `condition_node` MUST be a key in `nodes`.
- If `>1` body node, at least one body node MUST declare `inputs` referencing another body node (intra-body ordering).
- Body nodes referencing external (non-body) inputs MUST list those inputs in the loop's own `inputs` (FR-E35).
- If the condition node has a `validate` block, it MUST include a `frontmatter_field` rule with `field` matching `condition_field` (FR-E36).

### `merge`

Combines outputs of multiple `inputs` into the node's artifact directory.

- `merge_strategy` (`"copy_all"`, optional, default `"copy_all"`) — only strategy currently supported.

### `human`

Terminal prompt for manual input (interactive runs).

- `question` (string, **required**) — prompt text shown to the operator.
- `options` (string[], optional) — allowed responses.
- `abort_on` (string[], optional) — responses that abort the workflow.

## Validation Rules

`validate` is an array of rule objects. Common: `path` (string, required — empty only for engine-injected `scope_check`).

- `file_exists` — file present at `path`.
- `file_not_empty` — file present and non-empty.
- `contains_section` — file contains markdown heading equal to `value`.
  - `value` (string) — heading text.
- `frontmatter_field` — YAML frontmatter contains `field`.
  - `field` (string) — frontmatter key.
  - `allowed` (string[], optional) — acceptable values.
- `artifact` — composite check on a markdown file. Requires at least one of `sections` or `fields`.
  - `sections` (string[]) — required `# Heading` strings.
  - `fields` (string[]) — required frontmatter keys (presence + non-empty).
- `custom_script` — runs shell command `path`; exit 0 = pass.
- `scope_check` — engine-injected only when `allowed_paths` is set; do not declare manually.

## Phases

Two mutually exclusive mechanisms — pick one workflow-wide:

```yaml
phases:
  planning: [spec, design]
  execution: [build, test]
```

or per-node:

```yaml
nodes:
  spec:
    phase: planning
    type: agent
    # ...
```

Mixing the top-level block with any per-node `phase:` field throws. Without phases, artifacts go to `<run-dir>/<node-id>/`. With phases: `<run-dir>/<phase>/<node-id>/`.

## Template Variables

Available in `prompt`, `system_prompt`, `before`, `after`, validation paths, and `prepare_command`.

- `{{node_dir}}` — workDir-relative path to current node's artifact dir.
- `{{run_dir}}` — workDir-relative path to run root.
- `{{run_id}}` — unique run identifier.
- `{{input.<node-id>}}` — predecessor node's artifact dir.
- `{{args.<key>}}` — value of `--<key> <val>` CLI passthrough or `--prompt`.
- `{{env.<key>}}` — environment variable.
- `{{loop.iteration}}` — zero-based iteration counter (loop body only).
- `{{file("path")}}` — inlines file contents; path resolved against `workDir` (project root). Single-pass — the included content is **not** re-templated. Absolute paths used as-is.
- `{{flow_file("path")}}` — same, but path is resolved against the workflow folder (`<workDir>/.flowai-workflow/<workflow-name>/`). Falls back to `file()` semantics when the workflow sits at workDir root.

`{{workDir}}` and `{{workflow_dir}}` are NOT template placeholders — they exist only on the engine's internal `TemplateContext`.

`{{file()}}` / `{{flow_file()}}` references in `prompt` and `system_prompt` are validated at config load — missing files fail fast. Paths containing nested `{{` are skipped (resolved at render time).

## CLI Invocation

```
flowai-workflow run <workflow-folder> [flags]
```

Positional argument is the **workflow folder** (engine appends `/workflow.yaml`). Only one positional argument is accepted.

Flags:

- `--prompt <text>` — sets `args.prompt` (convenience alias).
- `--resume <run-id>` — resume an existing run; completed nodes skipped.
- `--dry-run` — validate config and print execution plan; no nodes run. Use this for config validation; `--validate` does NOT exist (unknown flags are silently captured as `args.<flag>`).
- `-v` / `--verbose` — full streaming output.
- `-s` / `--semi-verbose` — text output only (suppress tool calls).
- `-q` / `--quiet` — errors only.
- `--env KEY=VAL` — set env override (repeatable).
- `--skip <id1,id2>` — skip listed nodes.
- `--only <id1,id2>` — run only listed nodes.
- `--budget <usd>` — workflow-wide cost cap (positive number; strict — exact-equal does not trigger).
- `--skip-update-check` — do not query JSR for new versions on startup.
- `--version` / `-V` — print version.
- `--help` / `-h` — print usage.
- `--<any-other-key> <val>` — generic passthrough; becomes `args.<any-other-key>` and is referenceable as `{{args.<any-other-key>}}`.

Other subcommands (separate from `run`):

- `flowai-workflow init [--list]` — copy a bundled workflow scaffold into the current project.

## Setup Checklist

- [ ] Create `.flowai-workflow/<workflow-name>/`.
- [ ] Author `workflow.yaml` (`name`, `version: "1"`, `nodes`).
- [ ] Pick a `runtime` and verify the matching CLI is installed and authenticated.
- [ ] Add `runs/` and `memory/agent-*.md` (excluding `*-history.md`) to `.gitignore`.
- [ ] Write reusable role prompts under `agents/` referenced via `{{flow_file("agents/<role>.md")}}`.
- [ ] Run `flowai-workflow run <folder> --dry-run` to validate config and see the topological plan.
- [ ] Start with one or two nodes; expand the DAG incrementally.
- [ ] If using HITL, write `scripts/ask.sh` and `scripts/check.sh` and configure `defaults.hitl`.
- [ ] If gating output paths, set `allowed_paths` on agent nodes.

## Common Patterns

### Linear Pipeline

```yaml
name: linear
version: "1"
nodes:
  step1:
    type: agent
    label: "Step 1"
    prompt: "Output: {{node_dir}}/out.md"
  step2:
    type: agent
    label: "Step 2"
    inputs: [step1]
    prompt: "Read {{input.step1}}/out.md. Write {{node_dir}}/out.md"
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
  combined:
    type: merge
    label: "Combine"
    inputs: [branch-a, branch-b]
  final:
    type: agent
    label: "Final"
    inputs: [combined]
    prompt: "Inputs in {{input.combined}}/"
```

### Loop with Self-Verifying Body

```yaml
nodes:
  fix-loop:
    type: loop
    label: "Build → Verify"
    inputs: [spec]
    condition_node: verify
    condition_field: verdict
    exit_value: PASS
    max_iterations: 5
    nodes:
      build:
        type: agent
        label: "Build"
        inputs: [spec]
        prompt: "Iteration {{loop.iteration}}; spec at {{input.spec}}/"
      verify:
        type: agent
        label: "Verify"
        inputs: [build]
        prompt: |
          Check {{input.build}}/. Output {{node_dir}}/verdict.md
          with frontmatter `verdict: PASS` or `verdict: FAIL`.
        validate:
          - type: frontmatter_field
            path: "{{node_dir}}/verdict.md"
            field: verdict
            allowed: [PASS, FAIL]
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

### Post-Workflow Cleanup

```yaml
nodes:
  pipeline-end:
    type: agent
    label: "Final"
    inputs: [...]
    prompt: "..."
  notify:
    type: agent
    label: "Notify"
    run_on: always
    inputs: [pipeline-end]
    prompt: "Send a summary."
  on-fail:
    type: agent
    label: "Failure handler"
    run_on: failure
    inputs: [pipeline-end]
    prompt: "Open an issue with the error."
```
