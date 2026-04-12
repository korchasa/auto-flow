---
name: flowai-workflow-init
description: >-
  Initialize a new flowai-workflow project. Guides through template selection,
  project configuration, and scaffolds the .flowai-workflow/ directory.
user-invocable: true
argument-hint: "[template-name]"
---

# Initialize flowai-workflow Project

## Overview

Set up a new flowai-workflow project in the current directory. Creates the
`.flowai-workflow/` directory with workflow config, agent definitions, and
memory structure.

## Steps

1. Check if `.flowai-workflow/` already exists — warn if overwriting.
2. Ask which template to use (default: `sdlc-claude`).
3. Detect project characteristics (language, package manager, test runner).
4. Ask project-specific questions (name, repo URL, branch conventions).
5. Scaffold `.flowai-workflow/` directory from the selected template.
6. Print next steps: review agents, run first workflow.

## Available Templates

- `sdlc-claude` — Full SDLC workflow with 6 agents (PM, Architect, Tech Lead,
  Developer, QA, Tech Lead Review). Designed for Claude Code runtime.

## Notes

- The scaffold is non-destructive: existing files are not overwritten unless
  explicitly confirmed.
- After initialization, review agent definitions in
  `.flowai-workflow/agents/` and adapt to your project conventions.
