---
variant: "Variant A: Single-pass removal + inline cleanup"
tasks:
  - desc: "Delete 6 agent-* symlinks from .claude/skills/"
    files:
      - ".claude/skills/agent-pm"
      - ".claude/skills/agent-architect"
      - ".claude/skills/agent-developer"
      - ".claude/skills/agent-qa"
      - ".claude/skills/agent-tech-lead"
      - ".claude/skills/agent-tech-lead-review"
  - desc: "Remove symlink validation block from scripts/check.ts"
    files:
      - "scripts/check.ts"
  - desc: "Update SDS symlink references in design-sdlc.md"
    files:
      - "documents/design-sdlc.md"
---

## Justification

I selected Variant A because it directly satisfies all FR-S33 acceptance
criteria with minimal blast radius and zero scope creep.

Key reasons:

1. **Alignment with project vision (AGENTS.md):** The engine is domain-agnostic
   and pipeline-independent. Agent prompts are read via `pipeline.yaml` `prompt:`
   paths — no symlink indirection needed. Removing symlinks enforces the
   canonical `.auto-flow/agents/agent-<name>/SKILL.md` path as the sole
   discovery mechanism.

2. **Variant B rejected:** Extracting symlink validation into a standalone
   function before deleting it adds an unnecessary intermediate refactoring step
   with no lasting value. The function is immediately deleted — no cleaner diff
   justifies the extra commit.

3. **Variant C rejected:** Replacing symlink validation with agent-dir existence
   checks exceeds FR-S33 scope ("remove symlink validation"). Engine's
   `loadConfig()` already validates prompt file existence at pipeline load time
   (§3.8). Adding a redundant check creates maintenance burden and duplicates
   engine-level validation.

4. **Interactive discovery explicitly undesirable:** Issue #148 states symlinks
   "cause Claude Code to expose pipeline-only agents as interactive skills."
   Removal eliminates this unwanted behavior — no replacement needed.

## Task Descriptions

### Task 1: Delete 6 agent-* symlinks from .claude/skills/

Remove the 6 symlink files: `agent-pm`, `agent-architect`, `agent-developer`,
`agent-qa`, `agent-tech-lead`, `agent-tech-lead-review` from `.claude/skills/`.
Each is a symlink pointing to `../../.auto-flow/agents/agent-<name>`. Verify
the `.claude/skills/` directory still exists (other non-agent skills may reside
there). This is a blocking task — subsequent tasks reference the removal.

### Task 2: Remove symlink validation block from scripts/check.ts

Remove lines 103-130 in `pipelineIntegrity()` function: the symlink validation
loop that checks each agent symlink exists and points to correct target. Also
remove the "Agent symlinks valid" log line. The function retains step 1
(`loadConfig()` delegation) which covers prompt file existence validation.
Run `deno task check` to verify no regressions.

### Task 3: Update SDS symlink references in design-sdlc.md

Remove/reword 4 symlink references in `documents/design-sdlc.md`:
- §2.2 line 42: Remove "symlinked from..." clause in Agent Runtime subsystem.
- §3.4 lines 95-98: Remove dual-use/symlink language from purpose.
- §3.4 lines 152-155: Remove interactive symlink discovery from interfaces.
- §3.4 lines 176-181: Update migration note to reflect symlinks removed.

## Summary

I selected Variant A (single-pass removal + inline cleanup) for issue #148
(FR-S33). 3 tasks ordered by dependency: symlink deletion → check.ts cleanup →
SDS doc update. Minimal blast radius, no scope creep, directly satisfies all
FR-S33 ACs. I created branch `sdlc/issue-148` and opened a draft PR.
