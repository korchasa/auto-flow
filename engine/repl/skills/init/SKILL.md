---
name: flowai-workflow-init
description: >-
  Initialize a new flowai-workflow project. Autodetects project settings
  and scaffolds the .flowai-workflow/ directory with workflow config,
  agent definitions, and memory structure.
user-invocable: true
argument-hint: "[--template <name>] [--dry-run] [--allow-dirty]"
---

# Initialize flowai-workflow Project

## Overview

Set up a new flowai-workflow project in the current directory. Autodetects
project name, default branch, test and lint commands from manifest files
(deno.json, package.json, Cargo.toml, go.mod, pyproject.toml). Scaffolds
`.flowai-workflow/` directory from a template.

## Usage

Run the init script:

```bash
python3 init.py
```

The script:
1. Autodetects project settings (name, branch, test/lint commands).
2. Prints detected values for the user to review.
3. Calls `flowai-workflow init --answers <detected-values>` to scaffold.

### Options (passed through to `flowai-workflow init`)

- `--template <name>` — template to use (default: `sdlc-claude`)
- `--dry-run` — print files that would be created, don't write
- `--allow-dirty` — skip clean-git-tree preflight check

## After Initialization

1. Review agent definitions in `.flowai-workflow/agents/agent-*.md`
   and adapt to your project conventions.
2. Review `.flowai-workflow/workflow.yaml` for workflow structure.
3. Run: `flowai-workflow run` to execute the first workflow.

## Available Templates

- `sdlc-claude` (default) — Full SDLC workflow with 6 agents (PM,
  Architect, Tech Lead, Developer, QA, Tech Lead Review).
