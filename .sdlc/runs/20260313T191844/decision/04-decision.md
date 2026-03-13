---
variant: "Variant B: Pipeline-config-first with batch cleanup"
tasks:
  - desc: "Rewrite .sdlc/pipeline.yaml: remove finalize node, replace review with tech-lead-review, update phases.report"
    files: [".sdlc/pipeline.yaml"]
  - desc: "Delete stale agent dirs: agents/committer/, agents/tech-lead-reviewer/, agents/tech-lead-sds/, agents/code-reviewer/"
    files: ["agents/committer/SKILL.md", "agents/tech-lead-reviewer/SKILL.md", "agents/tech-lead-sds/SKILL.md", "agents/code-reviewer/SKILL.md"]
  - desc: "Create agents/tech-lead-review/SKILL.md with final review + CI gate + merge prompt"
    files: ["agents/tech-lead-review/SKILL.md"]
  - desc: "Fix symlinks: remove agent-committer, agent-tech-lead-reviewer, agent-tech-lead-sds; create agent-tech-lead-review"
    files: [".claude/skills/agent-committer", ".claude/skills/agent-tech-lead-reviewer", ".claude/skills/agent-tech-lead-sds", ".claude/skills/agent-tech-lead-review"]
  - desc: "Update agents/qa/SKILL.md: replace gh issue comment with gh pr review"
    files: ["agents/qa/SKILL.md"]
  - desc: "Update documents/requirements.md: mark completed FR-26 criteria [x] with evidence"
    files: ["documents/requirements.md"]
  - desc: "Update documents/design.md: remove committer/code-reviewer refs, add tech-lead-review component"
    files: ["documents/design.md"]
  - desc: "Run deno task check to validate pipeline integrity"
    files: []
---

## Justification

**Selected Variant B** over A (sequential atomic) and C (minimal diff).

- **Completeness over minimalism:** Spec explicitly requires "complete existing
  FR-26 work items" — C's partial delivery violates this. Ruled out.
- **Structural coherence:** B applies pipeline.yaml restructure first (the most
  critical change), ensuring the DAG definition is internally consistent before
  filesystem operations. A's sequential approach risks intermediate states where
  pipeline config references deleted/nonexistent agents.
- **Effort:** S (vs A's M). Batch file operations in a single step reduce
  context switches and error surface.
- **Vision alignment (AGENTS.md):** "Fully autonomous, no human gates between
  stages" — B's batch approach minimizes failure points in automated execution.
  Fewer intermediate states = fewer places an automated executor can fail and
  require human intervention.
- **Risk acceptance:** B's brief inconsistency (pipeline.yaml references
  tech-lead-review/SKILL.md before file exists) is negligible — executor
  implements tasks sequentially within a single run; file creation follows
  immediately.

## Task Descriptions

### Task 1: Rewrite pipeline.yaml

Single edit to `.sdlc/pipeline.yaml`:
- Remove `finalize` node entirely (committer role eliminated per FR-26).
- Replace `review` node config: change `prompt` to
  `agents/tech-lead-review/SKILL.md`, set `inputs: [specification, decision]`,
  `run_on: always`, update `task_template` for review+CI+merge workflow.
- Update `phases.report` to `[optimize, review]` (remove `finalize`).
- Validate: node IDs consistent, no dangling references.

### Task 2: Delete stale agent directories

Batch delete 4 directories:
- `agents/committer/` — executor owns commits (FR-26).
- `agents/tech-lead-reviewer/` — absorbed into tech-lead (FR-26).
- `agents/tech-lead-sds/` — absorbed into tech-lead (FR-26).
- `agents/code-reviewer/` — unexpected artifact, not in spec, cleanup target.

### Task 3: Create tech-lead-review agent

Create `agents/tech-lead-review/SKILL.md` with YAML frontmatter:
- `name: "agent-tech-lead-review"`, `disable-model-invocation: true`
- Role: Post-pipeline final code review + CI gate check (`gh run list`) +
  merge PR (`gh pr merge`) or leave open with comments.
- `run_on: always` behavior: handle missing-PR gracefully (no-op + message
  when pipeline failed before PR creation).

### Task 4: Fix skill symlinks

In `.claude/skills/`:
- Remove stale: `agent-committer`, `agent-tech-lead-reviewer`,
  `agent-tech-lead-sds`.
- Create: `agent-tech-lead-review` → `../../agents/tech-lead-review/`
  (relative path for portability).
- Result: 7 symlinks matching 7 agents (pm, architect, tech-lead,
  tech-lead-review, executor, qa, meta-agent).

### Task 5: Update QA prompt

Edit `agents/qa/SKILL.md`:
- Replace all `gh issue comment` references with `gh pr review --approve` /
  `--request-changes`.
- Remove issue comment references.
- Add explicit rule: "Do NOT post to issues."

### Task 6: Update SRS

Mark completed FR-26 acceptance criteria `[x]` with evidence (file paths +
line numbers). Only mark criteria that are verifiably implemented after tasks
1-5.

### Task 7: Update SDS

- Remove committer references from §3.4 Agent Prompts (already lists
  "Removed agents").
- Remove code-reviewer references if any.
- Add/update tech-lead-review component description in §3.4.
- Ensure §2.3 Pipeline DAG diagram reflects final node set.
- Verify §3.5 Skill Symlinks section lists correct 7 symlinks.

### Task 8: Validate

Run `deno task check` — confirms pipeline integrity, linting, formatting.
No code changes; verification-only step.
