---
name: flowai-workflow-init
description: >-
  Initialize a new flowai-workflow project. Scaffolds the .flowai-workflow/
  directory with workflow config, agent definitions, and memory structure.
user-invocable: true
argument-hint: "[--template <name>] [--dry-run]"
---

# Initialize flowai-workflow Project

## Overview

Scaffold a `.flowai-workflow/` directory in the current project with workflow
config, agent definitions, memory files, and HITL scripts.

## Instructions

1. Run `flowai-workflow init` via Bash tool. Pass user-provided flags as-is.
2. If init fails due to uncommitted changes, ask the user whether to pass
   `--allow-dirty` or commit first.
3. If `.flowai-workflow/` already exists, inform the user. Do not overwrite
   without explicit confirmation.
4. After successful init, suggest next steps:
   - Review agents in `.flowai-workflow/agents/agent-*.md`
   - Review workflow in `.flowai-workflow/workflow.yaml`
   - Run `flowai-workflow run` to execute the workflow

## CLI Reference

```
flowai-workflow init [options]

Options:
  --template <name>   Template to use (default: sdlc-claude)
  --answers <file>    YAML file with pre-filled answers (non-interactive)
  --allow-dirty       Skip clean-git-tree preflight check
  --dry-run           Print files that would be created, exit without writing
  -h, --help          Show init help
```

## Available Templates

- `sdlc-claude` (default) — 6-agent SDLC workflow for Claude Code runtime
  (PM → Architect → Tech Lead → Developer/QA → Tech Lead Review)
