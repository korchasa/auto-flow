---
variant: "Variant C: Doc fix + deprecate legacy scripts"
tasks:
  - desc: "Fix stale doc refs in requirements.md (FR-26 evidence paths, FR-17/FR-22/FR-35, §4, §5, Appendix B)"
    files: ["documents/requirements.md"]
  - desc: "Update AGENT_PROMPT paths in all stage scripts to .claude/skills/agent-<name>/SKILL.md"
    files: [".sdlc/scripts/stage-1-pm.sh", ".sdlc/scripts/stage-2-tech-lead.sh", ".sdlc/scripts/stage-3-reviewer.sh", ".sdlc/scripts/stage-4-architect.sh", ".sdlc/scripts/stage-5-sds-update.sh", ".sdlc/scripts/stage-6-executor.sh", ".sdlc/scripts/stage-7-qa.sh", ".sdlc/scripts/stage-8-presenter.sh", ".sdlc/scripts/stage-9-meta-agent.sh"]
  - desc: "Add deprecation headers to all stage scripts (superseded by engine)"
    files: [".sdlc/scripts/stage-1-pm.sh", ".sdlc/scripts/stage-2-tech-lead.sh", ".sdlc/scripts/stage-3-reviewer.sh", ".sdlc/scripts/stage-4-architect.sh", ".sdlc/scripts/stage-5-sds-update.sh", ".sdlc/scripts/stage-6-executor.sh", ".sdlc/scripts/stage-7-qa.sh", ".sdlc/scripts/stage-8-presenter.sh", ".sdlc/scripts/stage-9-meta-agent.sh"]
  - desc: "Fix FORBIDDEN_PATHS and inline comments in stage-6/stage-9 referencing old agents/ path"
    files: [".sdlc/scripts/stage-6-executor.sh", ".sdlc/scripts/stage-9-meta-agent.sh"]
  - desc: "Mark FR-36 criteria 2 (reworded as deprecated) and 6 as [x] with evidence"
    files: ["documents/requirements.md"]
  - desc: "Update SDS §3.2 and §3.4 to reflect deprecation of legacy stage scripts"
    files: ["documents/design.md"]
---

## Justification

**Selected: Variant C** over A (leaves criterion 2 open indefinitely) and B
(invests effort M in co-locating scripts that are end-of-life).

**Technical fit:** Legacy stage scripts in `.sdlc/scripts/` are superseded by
the Deno/TypeScript engine (`engine/`). The SDS §3.2 already states: "Preserved
for backward compatibility, superseded by engine." Co-locating them (Variant B)
adds complexity (relative `lib.sh` path breakage, orphaned scripts for removed
agents) with no return — these scripts will eventually be deleted.

**Vision alignment (AGENTS.md):** Project vision is "fully autonomous" pipeline
via `deno task run`. Engine-driven execution is the canonical path. Formally
deprecating legacy scripts aligns with the vision of engine-first architecture
and avoids investing in dead code paths.

**Complexity trade-off:** Effort S (same as Variant A) but closes both FR-36
criteria. Deprecation headers are low-risk, informational, and make the
superseded status explicit for any developer encountering these scripts.

## Task Descriptions

### Task 1: Fix stale doc refs in requirements.md

Update all `agents/<name>/SKILL.md` references to
`.claude/skills/agent-<name>/SKILL.md`. Covers: FR-26 evidence paths (lines
~607-634), FR-17 checkbox (project structure), FR-22 README criterion, FR-35
description, §4 Non-functional, §5 Interfaces, Appendix B file structure.
Remove any `agents/` directory entries and symlink references.

### Task 2: Update AGENT_PROMPT paths in stage scripts

Change `AGENT_PROMPT` variable in all 9 stage scripts from
`agents/<name>/SKILL.md` (or `.sdlc/agents/<name>/SKILL.md`) to
`.claude/skills/agent-<name>/SKILL.md`. Ensures scripts point to canonical
skill locations even in legacy/fallback usage.

### Task 3: Add deprecation headers to stage scripts

Insert standardized deprecation comment block at top of each stage script:
```bash
# DEPRECATED: This script is superseded by the Deno/TypeScript pipeline engine.
# Use `deno task run` instead. Retained for backward compatibility only.
```

### Task 4: Fix FORBIDDEN_PATHS and inline comments

Update `FORBIDDEN_PATHS` array in `stage-6-executor.sh` to reference
`.claude/skills/agent-*/` instead of `agents/` or `.sdlc/agents/`. Fix inline
comments in `stage-9-meta-agent.sh` referencing `.sdlc/agents/`.

### Task 5: Mark FR-36 criteria 2 and 6 as complete

- Criterion 6: Mark `[x]` — doc refs updated (evidence: requirements.md lines).
- Criterion 2: Reword to acknowledge deprecation: "Stage scripts formally
  deprecated (superseded by engine); co-location N/A for deprecated scripts."
  Mark `[x]` with evidence (deprecation headers in stage scripts).

### Task 6: Update SDS

Update `documents/design.md` §3.2 (Stage Scripts) to note formal deprecation
status. Update §3.4 (Agent Skills) to remove any remaining migration notes
referencing `agents/` directory. Keep changes minimal and targeted.
