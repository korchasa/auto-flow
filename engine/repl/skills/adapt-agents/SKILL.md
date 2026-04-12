---
name: adapt-agents
description: >-
  Adapt flowai-workflow agents to the current project after a framework update.
  Merges upstream agent changes with project-specific customizations.
user-invocable: true
argument-hint: "[agent-name]"
---

# Adapt Agents After Update

## Overview

When the flowai-workflow framework is updated, agent definitions may change.
This skill merges upstream changes with your project-specific adaptations,
preserving your customizations while incorporating new features and fixes.

## Steps

1. Detect installed agents in `.flowai-workflow/agents/`.
2. Compare each agent against the upstream template version.
3. For each agent with upstream changes:
   a. Show a diff of upstream changes.
   b. Propose a merged version preserving project customizations.
   c. Apply the merge after confirmation.
4. Report summary of adapted agents.

## Notes

- Adaptation is conservative: project-specific sections are preserved.
- If a conflict cannot be auto-resolved, the skill presents both versions
  and asks the user to choose.
- Run this skill after `flowai-workflow` framework updates (e.g., after
  `deno install` pulls a new version).
