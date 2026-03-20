---
variant: "Variant A: Pattern-Sweep with Targeted Edits"
tasks:
  - desc: "Fix requirements-sdlc.md: agent count 7→6 in active refs, remove/mark meta-agent as removed, update Appendix A (remove Stage 7 row, fix artifact names to FR-S32 canonical), update Appendix B (remove agent-meta-agent entry, replace prompt: refs with task_template/file()), fix Section 5 Interfaces stale --append-system-prompt description"
    files: ["documents/requirements-sdlc.md"]
  - desc: "Verify design-sdlc.md phases/prompt references reflect current pipeline format; apply minor fixes if stale refs found"
    files: ["documents/design-sdlc.md"]
  - desc: "Fix pipeline-report.md artifact numbering to FR-S32 canonical sequence (01-spec → 02-plan → 03-decision → 04-impl-summary → 05-qa-report → 06-review)"
    files: ["documents/rnd/pipeline-report.md"]
  - desc: "Update spec-unified-task-template.md Phase 1 and Phase 2 status from not-started to done"
    files: ["documents/adrs/001-agent-context-setup-method/spec-unified-task-template.md"]
---

## Justification

I selected Variant A (Pattern-Sweep with Targeted Edits) for these reasons:

1. **Systematic coverage:** Grep-based pattern sweep across all 4 target files
   catches every stale reference — meta-agent active refs, old artifact names,
   `prompt:` field patterns, `--append-system-prompt` — without relying on an
   incomplete checklist. This aligns with the project vision of accurate,
   trustworthy documentation that "defines agent workflows" (AGENTS.md: agents
   are stateless, all context from file artifacts and system prompts — stale
   docs = stale agent context).

2. **Lower risk than Variant B:** Section-level rewrites (Variant B) add
   content-loss risk for Appendix A/B with marginal benefit. Targeted edits
   preserve surrounding context and are individually reviewable in PR diff.

3. **More thorough than Variant C:** Minimal AC-only delta (Variant C) leaves
   known stale references unfixed — Section 5 Interfaces `--append-system-prompt`,
   FR-S26/FR-S15 evidence lines with `prompt:` patterns. These would mislead
   future agents into incorrect assumptions about prompt delivery mechanism.
   Fixing them now avoids a follow-up cleanup issue.

## Task Descriptions

### Task 1: Fix requirements-sdlc.md

Pattern sweep targets:
- **Agent count 7→6:** FR-S13 (§3.13) "Agents (7)" → "Agents (6)", remove
  meta-agent from list. FR-S15 (§3.14) "2 post-pipeline (tech-lead-review,
  meta-agent)" → "1 post-pipeline (tech-lead-review)". FR-S21 (§3.21),
  FR-S22 (§3.22), FR-S28 (§3.28) "All 7 agent" → "All 6 agent" where ref
  is to currently-active agents.
- **Section 4 NFR:** "Meta-Agent runs to analyze the failure" — update to
  reflect removal.
- **Section 5 Interfaces:** Replace `--append-system-prompt` description with
  `-p` task prompt mechanism via `task_template` + `{{file(...)}}` (FR-S38).
- **Section 6 acceptance criteria:** Item 7 meta-agent reference.
- **Appendix A:** Remove Stage 7 Meta-Agent row. Fix `05-qa-report-N.md` →
  `05-qa-report.md`. Verify artifact names match FR-S32 canonical set.
- **Appendix B:** Remove `agent-meta-agent/SKILL.md` line. Remove/update any
  `prompt:` field comments → `task_template`/`{{file(...)}}` pattern.
- **Preserve historical context:** FR-S9 section (§3.9) itself stays — it
  describes the removed feature. FR-S13 AC evidence referencing 7 agents is
  historical (was true at commit time). FR-S15 target pipeline diagram with
  meta-agent is historical.

### Task 2: Verify/fix design-sdlc.md

SDS appears correct post-FR-S38:
- §2.2 `phases:` description accurate (declarative config, engine opaque).
- §3.4 correctly states "legacy `prompt:` field removed", describes
  `{{file(...)}}` injection.
- §3.4 Interfaces correctly shows `task_template` pattern.
Developer should grep for any remaining stale `prompt:` refs that imply the
field is still active (vs historical "removed" context). Update §8 SRS
Evidence Status with FR-S40 entry.

### Task 3: Fix pipeline-report.md

Update artifact numbering line to FR-S32 canonical:
`01-spec → 02-plan → 03-decision → 04-impl-summary → 05-qa-report → 06-review`.

### Task 4: Update spec-unified-task-template.md

Change Phase 1 status `not-started` → `done` and Phase 2 status
`not-started` → `done`. Both phases are implemented (FR-S38 file() injection
and FR-S39 cleanup complete).

## Summary

- I selected Variant A (Pattern-Sweep with Targeted Edits) for systematic
  stale-reference coverage with targeted edit safety.
- 4 tasks across 4 files, ordered by size/dependency (SRS first as largest).
- Primary work in `requirements-sdlc.md` (~25 scattered refs). SDS needs
  verification + minor §8 update. Two supporting docs need single-line fixes.
- I created branch `sdlc/issue-158` and opened a draft PR.
