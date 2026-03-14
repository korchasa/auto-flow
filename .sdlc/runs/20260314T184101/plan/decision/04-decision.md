---
variant: "Variant C: SDLC-Only Move with Engine Defaults Deferred"
tasks:
  - desc: "Rename .sdlc/ to .auto-flow/ via git mv"
    files: [".auto-flow/pipeline.yaml", ".auto-flow/scripts/", ".auto-flow/runs/", ".auto-flow/tasks/"]
  - desc: "Move .claude/skills/agent-*/ to .auto-flow/agents/*/ and create symlinks"
    files: [".auto-flow/agents/agent-pm/SKILL.md", ".auto-flow/agents/agent-architect/SKILL.md", ".auto-flow/agents/agent-tech-lead/SKILL.md", ".auto-flow/agents/agent-developer/SKILL.md", ".auto-flow/agents/agent-qa/SKILL.md", ".auto-flow/agents/agent-tech-lead-review/SKILL.md", ".auto-flow/agents/agent-meta-agent/SKILL.md", ".claude/skills/agent-pm", ".claude/skills/agent-architect", ".claude/skills/agent-tech-lead", ".claude/skills/agent-developer", ".claude/skills/agent-qa", ".claude/skills/agent-tech-lead-review", ".claude/skills/agent-meta-agent"]
  - desc: "Update engine default strings (3 locations: state.ts, lock.ts, cli.ts) — cosmetic only"
    files: ["engine/state.ts", "engine/lock.ts", "engine/cli.ts"]
  - desc: "Update engine test expectations for new default paths"
    files: ["engine/state_test.ts", "engine/cli_test.ts", "engine/engine_test.ts", "engine/pipeline_integrity_test.ts", "engine/hitl_test.ts"]
  - desc: "Update .auto-flow/pipeline.yaml prompt paths and script paths"
    files: [".auto-flow/pipeline.yaml"]
  - desc: "Update scripts/check.ts pipeline path, agent dir check, test dirs"
    files: ["scripts/check.ts"]
  - desc: "Update deno.json test task paths and fmt/lint excludes"
    files: ["deno.json"]
  - desc: "Update 7 SKILL.md files — internal .sdlc/ and .claude/skills/agent-* refs"
    files: [".auto-flow/agents/agent-pm/SKILL.md", ".auto-flow/agents/agent-architect/SKILL.md", ".auto-flow/agents/agent-tech-lead/SKILL.md", ".auto-flow/agents/agent-developer/SKILL.md", ".auto-flow/agents/agent-qa/SKILL.md", ".auto-flow/agents/agent-tech-lead-review/SKILL.md", ".auto-flow/agents/agent-meta-agent/SKILL.md"]
  - desc: "Update .claude/settings.json and .claude/settings.local.json path refs"
    files: [".claude/settings.json", ".claude/settings.local.json"]
  - desc: "Delete deprecated legacy stage scripts per FR-S26/SDS §3.2"
    files: [".auto-flow/scripts/stage-*.sh"]
  - desc: "Update docs: CLAUDE.md, README.md, AGENTS.md, design-sdlc.md, requirements-sdlc.md"
    files: ["CLAUDE.md", "README.md", "AGENTS.md", "documents/design-sdlc.md", "documents/requirements-sdlc.md"]
  - desc: "Update FR-S17, FR-S11, FR-S24, FR-S25 path references in SRS"
    files: ["documents/requirements-sdlc.md"]
---

## Justification

I selected **Variant C** over A and B for these reasons:

1. **Scope discipline.** Issue #111 is `scope: sdlc`. Variant B introduces engine schema changes (`runs_dir` config field, `engine/types.ts`, `engine/config.ts`) that constitute a functional engine change — this violates scope separation (AGENTS.md: "Engine is pipeline-independent"). Variant C keeps engine changes to 3 default-string swaps with zero behavioral impact — cosmetic, not functional.

2. **Effort/risk ratio.** Variant C is M effort vs L for A and B. The blast radius is identical to A (same file set), but C explicitly frames the engine string swaps as cosmetic defaults (not logic changes), which simplifies PR review by setting clear reviewer expectations.

3. **Vision alignment.** AGENTS.md states "engine is domain-agnostic" and "no git/GitHub/SDLC logic in engine." The `.sdlc/` namespace baked into engine defaults violates this principle. Variant C fixes the symptom (rename defaults) while deferring the root cause (configurable `runs_dir`) to a proper `scope: engine` issue — matching the project's preferred pattern of separate, focused issues per scope.

4. **FR-S26 compliance.** Variant C explicitly deletes deprecated legacy stage scripts (`.sdlc/scripts/stage-*.sh`) per FR-S26 acceptance criteria and SDS §3.2 DEPRECATED status. Variant A mentions this optionally; Variant B omits it.

5. **Symlink strategy for Claude Code.** All 3 variants use symlinks from `.claude/skills/agent-*` → `../../.auto-flow/agents/*/` to preserve Claude Code interactive skill discovery. This is necessary because Claude Code discovers skills from `.claude/skills/` (runtime-fixed path). The symlinks are lightweight and well-tested in git.

## Task Descriptions

1. **Rename .sdlc/ → .auto-flow/:** `git mv .sdlc .auto-flow` moves pipeline.yaml, scripts/, runs/, tasks/ atomically. Git tracks the rename.

2. **Move agent prompts + create symlinks:** Move each `.claude/skills/agent-<name>/` directory to `.auto-flow/agents/agent-<name>/`. Create symlinks `.claude/skills/agent-<name>` → `../../.auto-flow/agents/agent-<name>` (7 agents). Symlinks preserve Claude Code `/agent-*` slash command discovery.

3. **Update engine default strings:** 3 cosmetic changes — `engine/state.ts:92` (`getRunDir` default `.sdlc/runs/` → `.auto-flow/runs/`), `engine/lock.ts:14` (`.sdlc/runs/.lock` → `.auto-flow/runs/.lock`), `engine/cli.ts:23` (default config `.sdlc/pipeline.yaml` → `.auto-flow/pipeline.yaml`). No logic change.

4. **Update engine test expectations:** 5 test files reference `.sdlc/` in string assertions. Update to `.auto-flow/`.

5. **Update pipeline.yaml:** All `prompt:` paths from `.claude/skills/agent-*/SKILL.md` → `.auto-flow/agents/agent-*/SKILL.md`. HITL/rollback script paths from `.sdlc/scripts/` → `.auto-flow/scripts/`.

6. **Update scripts/check.ts:** Pipeline config path (`.sdlc/pipeline.yaml` → `.auto-flow/pipeline.yaml`), agent skills directory check (`.claude/skills/agent-*` → `.auto-flow/agents/agent-*` or symlink verification), test dirs list.

7. **Update deno.json:** Legacy test tasks `.sdlc/` → `.auto-flow/`, fmt/lint exclude paths.

8. **Update 7 SKILL.md files:** All internal references to `.sdlc/` paths and `.claude/skills/agent-*` paths updated to `.auto-flow/` equivalents.

9. **Update .claude/settings.json and settings.local.json:** All `.sdlc/` path references → `.auto-flow/`.

10. **Delete deprecated legacy stage scripts:** Remove `.auto-flow/scripts/stage-*.sh` and associated `*_test.ts` files. These are formally deprecated per SDS §3.2 and FR-S26.

11. **Update documentation:** CLAUDE.md, README.md, AGENTS.md — all `.sdlc/` and `.claude/skills/agent-*` path references. design-sdlc.md and requirements-sdlc.md — path references throughout.

12. **Update SRS FR path references:** FR-S17, FR-S11, FR-S24, FR-S25 sections in requirements-sdlc.md — update `.sdlc/` and `.claude/skills/agent-*` paths to `.auto-flow/` equivalents.

## Summary

I selected Variant C (SDLC-Only Move with Engine Defaults Deferred) for its tight scope compliance, M effort (vs L for alternatives), and explicit FR-S26 deprecated-script cleanup. I defined 12 ordered tasks covering directory rename, agent prompt relocation with symlinks, cosmetic engine default updates, test updates, config updates, deprecated script deletion, and documentation updates. I created branch `sdlc/issue-111` and opened a draft PR.
