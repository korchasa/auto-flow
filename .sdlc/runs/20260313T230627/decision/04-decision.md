---
variant: "Variant A: Atomic move + update all references in one pass"
tasks:
  - desc: "Move 7 SKILL.md files from agents/<name>/ to .claude/skills/agent-<name>/ (overwrite symlinks)"
    files:
      - ".claude/skills/agent-pm/SKILL.md"
      - ".claude/skills/agent-architect/SKILL.md"
      - ".claude/skills/agent-tech-lead/SKILL.md"
      - ".claude/skills/agent-tech-lead-review/SKILL.md"
      - ".claude/skills/agent-executor/SKILL.md"
      - ".claude/skills/agent-qa/SKILL.md"
      - ".claude/skills/agent-meta-agent/SKILL.md"
  - desc: "Update SKILL.md frontmatter to agentskills.io spec (replace disable-model-invocation with compatibility + allowed-tools)"
    files:
      - ".claude/skills/agent-pm/SKILL.md"
      - ".claude/skills/agent-architect/SKILL.md"
      - ".claude/skills/agent-tech-lead/SKILL.md"
      - ".claude/skills/agent-tech-lead-review/SKILL.md"
      - ".claude/skills/agent-executor/SKILL.md"
      - ".claude/skills/agent-qa/SKILL.md"
      - ".claude/skills/agent-meta-agent/SKILL.md"
  - desc: "Update pipeline.yaml prompt paths from agents/*/SKILL.md to .claude/skills/agent-*/SKILL.md"
    files: [".sdlc/pipeline.yaml"]
  - desc: "Update meta-agent SKILL.md body references to agents/*/SKILL.md paths"
    files: [".claude/skills/agent-meta-agent/SKILL.md"]
  - desc: "Update documentation references (requirements.md, design.md, AGENTS.md, README.md)"
    files:
      - "documents/requirements.md"
      - "documents/design.md"
      - "AGENTS.md"
      - "README.md"
  - desc: "Update test fixtures referencing agents/ paths"
    files:
      - "engine/config_test.ts"
      - "engine/agent_test.ts"
      - "engine/hitl_test.ts"
      - "engine/pipeline_integrity_test.ts"
  - desc: "Update .claude/settings.json and .gitleaks.toml if they reference agents/ paths"
    files:
      - ".claude/settings.json"
      - ".gitleaks.toml"
  - desc: "Remove agents/ directory and verify with deno task check + full test suite"
    files: ["agents/"]
---

## Justification

**Selected: Variant A** — atomic move with all references updated in one pass.

1. **Simplicity (AGENTS.md vision alignment):** The project vision emphasizes
   simplicity ("Single Docker image for all stages"). Variant A is the most
   direct path — move files, update refs, delete old dir. No intermediate states,
   no throwaway scripts, no reverse symlinks.

2. **Single-contributor project:** Variant B's backward-compatible bridge phase
   adds complexity (reverse symlinks, two commits, platform-dependent symlink
   behavior) for marginal safety benefit. The plan itself acknowledges this:
   "Added complexity for marginal safety benefit since this is an internal
   project with single contributor."

3. **Variant C over-engineers:** A migration script for 7 file moves is
   throwaway code that itself needs debugging. Effort rated L (largest). Docs
   and tests still need manual updates regardless.

4. **Blast radius is manageable:** All 7 agents are enumerable. `deno task check`
   + full test suite serve as validation gate. Git history provides rollback if
   needed. Single commit makes bisecting trivial.

5. **Engine-agnostic (AGENTS.md key decision):** Only `pipeline.yaml` prompt
   paths change. Engine code is untouched — consistent with "Engine is
   pipeline-independent" principle.

## Task Descriptions

### Task 1: Move SKILL.md files
Remove existing `.claude/skills/agent-*` symlinks. Move each
`agents/<name>/SKILL.md` to `.claude/skills/agent-<name>/SKILL.md` as a real
file (not symlink). 7 agents: pm, architect, tech-lead, tech-lead-review,
executor, qa, meta-agent.

### Task 2: Update frontmatter
In each moved SKILL.md, replace `disable-model-invocation: true` with
agentskills.io-compliant fields: `compatibility: ["claude-code"]` and
`allowed-tools: []`. Keep `name` and `description` fields.

### Task 3: Update pipeline.yaml
Change all 7 `prompt:` values from `agents/<name>/SKILL.md` to
`.claude/skills/agent-<name>/SKILL.md`.

### Task 4: Update meta-agent self-references
Meta-agent's SKILL.md body contains path patterns like `agents/*/SKILL.md`
(it edits agent prompts). Update these to `.claude/skills/agent-*/SKILL.md`.

### Task 5: Update documentation
Update path references in `documents/requirements.md` (FR-19, FR-17),
`documents/design.md` (sections 3.4, 3.5, 4), `AGENTS.md` (key decisions),
`README.md` (any agent path mentions).

### Task 6: Update test fixtures
Update test files that reference `agents/` paths in fixture data or assertions:
`config_test.ts`, `agent_test.ts`, `hitl_test.ts`, `pipeline_integrity_test.ts`.

### Task 7: Update settings and security config
Check `.claude/settings.json` allowlists and `.gitleaks.toml` for `agents/`
path references. Update to `.claude/skills/agent-*/` paths.

### Task 8: Remove agents/ directory and verify
Delete `agents/` top-level directory. Run `deno task check` and full test suite
to confirm zero regressions.
