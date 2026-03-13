---
variant: "Variant B: Phased execution (delete → create → rewire → verify → document)"
tasks:
  - desc: "Delete stale agent directories and symlinks"
    files:
      - "agents/tech-lead-reviewer/"
      - "agents/tech-lead-sds/"
      - "agents/committer/"
      - "agents/code-reviewer/"
      - ".claude/skills/agent-committer"
      - ".claude/skills/agent-tech-lead-reviewer"
      - ".claude/skills/agent-tech-lead-sds"
  - desc: "Create tech-lead-review agent and symlink"
    files:
      - "agents/tech-lead-review/SKILL.md"
      - ".claude/skills/agent-tech-lead-review"
  - desc: "Update pipeline.yaml: remove finalize node, replace review with tech-lead-review"
    files:
      - ".sdlc/pipeline.yaml"
  - desc: "Update QA prompt to post verdict via gh pr review only"
    files:
      - "agents/qa/SKILL.md"
  - desc: "Update SRS and SDS to reflect final 7-agent pipeline structure"
    files:
      - "documents/requirements.md"
      - "documents/design.md"
---

## Justification

**Selected Variant B** over A and C for these reasons:

1. **Autonomous verifiability** — Each phase can be validated independently via
   `deno task check`. This aligns with the project vision of "fully autonomous,
   no human gates between stages" (AGENTS.md): the executor can self-verify
   after each atomic step rather than relying on a single monolithic changeset.

2. **Risk containment** — Variant A's single-pass approach risks leaving the
   pipeline broken if any step fails mid-way. Variant B mitigates this: phases
   1-3 (delete → create → rewire) are treated as a logical unit by the executor,
   but each produces a verifiable commit. If phase 3 fails, phases 1-2 are
   already committed and the error is localized to pipeline.yaml rewiring.

3. **Variant C rejected** — Keeping `review` node ID while swapping prompt to
   `tech-lead-review` violates FR-33 node ID convention (activity-based IDs
   should match agent purpose). The spec explicitly states "replace
   `review`/code-reviewer node with `tech-lead-review`". Semantic mismatch
   between node ID and agent directory creates maintenance confusion.

4. **Effort parity** — Both A and B are rated M effort. B's phased structure
   adds ~2 extra commits but no additional complexity. The phased approach maps
   naturally to the executor's per-task commit cadence (FR-26 §4.2).

## Task Descriptions

### Task 1: Delete stale agent directories and symlinks

Remove 4 agent directories (`tech-lead-reviewer`, `tech-lead-sds`, `committer`,
`code-reviewer`) and 3 dangling symlinks (`agent-committer`,
`agent-tech-lead-reviewer`, `agent-tech-lead-sds`). These agents' responsibilities
are absorbed: tech-lead-reviewer/tech-lead-sds → tech-lead, committer → executor,
code-reviewer → tech-lead-review. Use `rm -rf` for directories, `rm` for symlinks.
Commit: `sdlc(cleanup): remove stale agent dirs and symlinks`.

### Task 2: Create tech-lead-review agent and symlink

Write `agents/tech-lead-review/SKILL.md` — post-pipeline agent performing: final
code review of PR diff, CI gate check (`deno task check` as proxy), and merge via
`gh pr merge`. Must handle missing-PR gracefully (no-op with message if pipeline
failed before tech-lead created PR). `run_on: always`. SKILL.md frontmatter:
`name: agent-tech-lead-review`, `disable-model-invocation: true`. Create symlink:
`.claude/skills/agent-tech-lead-review` → `../../agents/tech-lead-review/`.
Commit: `sdlc(agent): add tech-lead-review agent`.

### Task 3: Update pipeline.yaml

Three changes: (a) Remove `finalize` node definition entirely (lines 163-182).
(b) Replace `review` node: change ID to `tech-lead-review`, set prompt to
`agents/tech-lead-review/SKILL.md`, set inputs to `[specification, decision]`
(remove `finalize` dependency), update label/task_template for final review +
CI gate + merge. (c) Update `phases.report` from `[optimize, finalize, review]`
to `[optimize, tech-lead-review]`. Update header comment to reflect 7-node flow.
Commit: `sdlc(pipeline): consolidate to 7-node flow`.

### Task 4: Update QA prompt for PR review verdict

Modify `agents/qa/SKILL.md` to ensure verdict is posted exclusively via
`gh pr review <N> --approve` or `gh pr review <N> --request-changes --body "..."`.
Remove any `gh issue comment` verdict posting. Preserve existing QA report file
output (`05-qa-report.md` with YAML frontmatter `verdict: PASS|FAIL`).
Commit: `sdlc(agent): qa verdict via gh pr review only`.

### Task 5: Update SRS and SDS

**SRS** (`documents/requirements.md`): Mark remaining FR-26 acceptance criteria
as `[x]` with file path evidence for each completed criterion.

**SDS** (`documents/design.md`): (a) Add `code-reviewer` to §3.4 removed agents
list. (b) Add `agent-code-reviewer` to §3.5 removed symlinks. (c) Verify §2.3
DAG diagram, phases, and §4.2 commit strategy match the implemented 7-node
structure. (d) Update §5 if any logic descriptions reference stale node names.
Commit: `sdlc(docs): update SRS/SDS for final pipeline structure`.
