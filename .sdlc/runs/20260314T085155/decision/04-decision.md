---
variant: "Variant B: Fix templates + strengthen Voice sections"
tasks:
  - desc: "Fix hardcoded gh issue comment templates in PM, Architect, Tech Lead SKILL.md to first-person"
    files: [".claude/skills/agent-pm/SKILL.md", ".claude/skills/agent-architect/SKILL.md", ".claude/skills/agent-tech-lead/SKILL.md"]
  - desc: "Add explicit GitHub interaction scope sentence to Voice section in all 7 SKILL.md files"
    files: [".claude/skills/agent-pm/SKILL.md", ".claude/skills/agent-architect/SKILL.md", ".claude/skills/agent-tech-lead/SKILL.md", ".claude/skills/agent-developer/SKILL.md", ".claude/skills/agent-qa/SKILL.md", ".claude/skills/agent-tech-lead-review/SKILL.md", ".claude/skills/agent-meta-agent/SKILL.md"]
  - desc: "Add third correct/incorrect example pair targeting GitHub interactions to all 7 Voice sections"
    files: [".claude/skills/agent-pm/SKILL.md", ".claude/skills/agent-architect/SKILL.md", ".claude/skills/agent-tech-lead/SKILL.md", ".claude/skills/agent-developer/SKILL.md", ".claude/skills/agent-qa/SKILL.md", ".claude/skills/agent-tech-lead-review/SKILL.md", ".claude/skills/agent-meta-agent/SKILL.md"]
  - desc: "Mark FR-43 acceptance criteria with evidence paths in SRS"
    files: ["documents/requirements.md"]
---

## Justification

**Variant B selected** over A (minimal, implicit gap) and C (centralized, contradicts FR-40).

1. **Technical fit:** Variant A leaves Voice sections ambiguous — "all narrative
   output" doesn't explicitly list GitHub comments, PR descriptions, or status
   updates. Agents may still produce passive GitHub output. Variant B adds one
   sentence + one example pair per agent, eliminating ambiguity with ~3 lines
   per file.

2. **Vision alignment (AGENTS.md):** Project vision mandates "fully autonomous,
   no human gates." Ambiguous voice rules create drift that requires human
   correction — antithetical to autonomy. Explicit rules reduce correction
   loops.

3. **FR-40 consistency:** FR-40 (commit `09a9667`) established per-agent
   tailored Voice sections with role-specific examples. Variant C's centralized
   approach contradicts this decision. Variant B extends the per-agent pattern
   with GitHub-specific examples per role.

4. **Complexity trade-off:** Effort M (vs S for A). Additional ~3 lines per
   SKILL.md × 7 files = ~21 lines total. No structural changes, no new files,
   no cross-file references.

## Task Descriptions

### Task 1: Fix hardcoded gh issue comment templates (3 files)

Replace passive/third-person `gh issue comment --body` template strings:
- `agent-pm`: `"Pipeline started — specification phase"` → `"I started the specification phase for this issue"`
- `agent-architect`: `"Architect: producing implementation plan"` → `"I am producing the implementation plan"`
- `agent-tech-lead`: `"Tech Lead: selected <variant>, opened draft PR"` → `"I selected <variant> and opened a draft PR"`

Dependency: none (blocking — templates are the primary bug).

### Task 2: Add explicit GitHub interaction scope (7 files)

Add sentence to each `## Voice` section after the "all narrative output" rule:
"This includes GitHub issue comments, PR descriptions, and status updates."

Dependency: Task 1 (templates fixed first, then scope clarified).

### Task 3: Add third example pair per agent (7 files)

Add role-specific correct/incorrect example targeting GitHub interactions:
- PM: `"I started the specification phase"` / `"Specification phase started"`
- Architect: `"I am analyzing 3 variants"` / `"3 variants are being analyzed"`
- Tech Lead: `"I selected Variant B and opened a draft PR"` / `"Variant B was selected"`
- Developer: `"I implemented the login endpoint"` / `"The login endpoint was implemented"`
- QA: `"I verified all acceptance criteria"` / `"All acceptance criteria were verified"`
- Tech Lead Review: `"I approved the PR after CI passed"` / `"The PR was approved"`
- Meta-Agent: `"I identified 2 prompt improvements"` / `"2 prompt improvements were identified"`

Dependency: Task 2 (scope sentence added first for logical ordering).

### Task 4: Mark FR-43 acceptance criteria (1 file)

Update `documents/requirements.md` section 3.42 (FR-43): mark all 3 acceptance
criteria `[x]` with evidence paths to the modified SKILL.md files and line
numbers.

Dependency: Tasks 1-3 (evidence only available after implementation).

## Summary

- Selected Variant B: fix hardcoded templates + strengthen Voice sections with explicit GitHub scope and third example pair per agent
- 4 tasks defined: template fix (3 files) → scope sentence (7 files) → example pairs (7 files) → SRS evidence (1 file)
- Branch `sdlc/issue-13` active, draft PR #39 exists
