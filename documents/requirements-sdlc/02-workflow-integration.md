<!-- section file — index: [documents/requirements-sdlc.md](../requirements-sdlc.md) -->

# SRS SDLC — Git Workflow Integration and Commit Strategy


### 3.11 FR-S11: Inter-Stage Data Flow & Commit Strategy

- **Description:** Defines how data flows between workflow stages and when commits happen on the feature branch.
- **Data flow:**
  - Engine path: artifacts stored in `.flowai-workflow/runs/<run-id>/[<phase>/]<node-id>/` (phase subdir present when node's `phase` field is set in `workflow.yaml`; flat `<node-id>/` otherwise). Linked via `{{input.<node-id>}}` templates. Phase-aware directory creation depends on engine FR-E9 implementation. Evidence: `documents/design-sdlc.md` §2.2 (Artifact Store subsystem description).
  - Legacy path: artifacts in `.flowai-workflow/workflow/<issue-number>/`.
  - The file system is the single source of truth for inter-stage communication. No manifest or registry.
  - Claude CLI's built-in context auto-compression handles large input sets; no manual context management is required.
- **Commit strategy (FR-S15):**
  - Feature branch `sdlc/issue-<N>` created by Tech Lead agent. Fallback `sdlc/{{run_id}}` for `--prompt` mode.
  - Engine does NOT auto-commit after nodes (invariant preserved).
  - No dedicated committer agent nodes. Developer owns commits: `git add`, `git commit`, `git push` after each task. Commit format: `sdlc(impl): <summary>`.
  - Tech Lead creates draft PR before impl-loop. Developer pushes to same branch.
  - QA posts PR review verdicts. Tech-lead-review performs final review + merge.
  - Legacy scripts commit + push after each stage (unchanged).
- **Branch lifecycle:**
  - Branch created by Tech Lead agent after variant selection.
  - On re-run, existing branch is reused — new commits overwrite previous artifacts (previous versions preserved in git history per FR-E3).
  - Branch is merged via tech-lead-review post-workflow agent.
- **Acceptance criteria:**
  - [x] Engine does NOT auto-commit after any node. Evidence: `engine.ts` — no `commitIfNeeded()` calls
  - Developer commits/pushes own code during implementation.
  - Tech Lead creates feature branch and draft PR.
  - Tech-lead-review merges PR if CI passes.



### 3.15 FR-S15: Align Workflow Git Workflow with Standard GitHub Practices

- **Description:** Restructure workflow agent roles and git workflow to match
  standard GitHub development practices. Rename/merge agents to reflect
  real-world roles, eliminate artificial agents (committer, reviewer), move git
  operations (branch, commit, push, PR) to the agents that own the work, and
  use PRs (not issues) as the primary communication channel for code review.
- **Motivation:** Current workflow diverges from standard practices: roles are
  misnamed (tech-lead does architecture, architect does tech-lead work),
  artificial roles exist (committer, reviewer), git operations are deferred to
  separate committer nodes, and QA/review communication happens in issues
  instead of PRs.
- **Target workflow flow:**
  ```
  pm → architect → tech-lead → impl-loop(developer, qa) → tech-lead-review
                                                           ↑
                                                    meta-agent (run_always)
  ```
  5 agent invocations in happy path (was 8): pm, architect, tech-lead,
  developer, qa — plus tech-lead-review and meta-agent as post-workflow.
- **Role changes:**
  - `tech-lead` node (current) → renamed to **`architect`** (designs solution
    with variants). Prompt: `.flowai-workflow/agents/agent-architect/SKILL.md`.
  - `reviewer` node → **removed**. Design review absorbed into new tech-lead.
  - `architect` node (current) → renamed to **`tech-lead`** (reviews design,
    selects variant, task breakdown, updates SDS, creates branch
    `sdlc/issue-<N>`, opens draft PR). Absorbs reviewer + sds-update roles.
  - `tech-lead-sds` node → **removed**. SDS update absorbed into new tech-lead.
  - `committer` nodes → **removed**. Developer commits/pushes own code.
  - New **`tech-lead-review`** node (`run_on: always`) — final code review in
    PR, CI gate, merge if green.
- **Git workflow changes:**
  - **Tech-lead** creates feature branch `sdlc/issue-<N>` + opens draft PR
    after making decision. Fallback branch `sdlc/<run-id>` for `--prompt` mode.
  - **Developer** commits and pushes during implementation, posts progress as PR
    comments.
  - **QA** posts results as PR review (`gh pr review --approve` or
    `--request-changes`), not issue comments.
  - **Tech-lead-review** reviews PR diff, checks CI, merges or leaves open.
- **File changes:**
  - Rename `.flowai-workflow/agents/agent-tech-lead/` ↔ `.flowai-workflow/agents/agent-architect/` (swap roles).
  - Expand `.flowai-workflow/agents/agent-tech-lead/SKILL.md` (design review, SDS update, branch creation, draft PR).
  - Delete `.flowai-workflow/agents/agent-tech-lead-reviewer/`, `.flowai-workflow/agents/agent-tech-lead-sds/`,
    `.flowai-workflow/agents/agent-committer/`.
  - Update `.flowai-workflow/agents/agent-developer/SKILL.md` — add commit/push, PR comments. (FR-S18: formerly `agent-executor`)
  - Update `.flowai-workflow/agents/agent-qa/SKILL.md` — PR review instead of issue comments.
  - New `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md` — code review + CI gate + merge.
  - Update `workflow.yaml` — new DAG with fewer nodes.
- **Invariants (no changes):**
  - `engine/` — engine remains domain-agnostic, no code changes.
  - `.flowai-workflow/agents/agent-pm/` — no changes.
  - `.flowai-workflow/agents/agent-meta-agent/` — no changes.
- **Acceptance criteria:**
  - [x] Agent directory `.flowai-workflow/agents/agent-architect/` contains design-solution prompt. Evidence: `.flowai-workflow/agents/agent-architect/SKILL.md`
  - [x] Agent directory `.flowai-workflow/agents/agent-tech-lead/` contains expanded prompt: critique + variant selection + task breakdown + SDS update + branch creation + draft PR. Evidence: `.flowai-workflow/agents/agent-tech-lead/SKILL.md`
  - [x] `agent-tech-lead-reviewer`, `agent-tech-lead-sds`, `agent-committer` deleted. Evidence: directories removed; `agents/` directory removed (commit `985e3e5`)
  - [x] `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md` created with code review + CI gate + merge logic. Evidence: `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md:21-24`
  - [x] `.flowai-workflow/agents/agent-developer/SKILL.md` exists: commits/pushes own code, posts PR comments, "do not commit" rule removed. Evidence: commit `f0085df sdlc(impl): rename Executor agent role to Developer (FR-S18)`, `.flowai-workflow/agents/agent-developer/SKILL.md`
  - [x] `.flowai-workflow/agents/agent-qa/SKILL.md` updated: posts PR reviews via `gh pr review` ONLY (no issue comments). Evidence: `.flowai-workflow/agents/agent-qa/SKILL.md`
  - [x] `workflow.yaml` updated: `finalize` (committer) node removed; `review` node renamed to `tech-lead-review` using `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md` with `run_on: always` + merge capability. Evidence: `.flowai-workflow/workflow.yaml:163-184`
  - [x] Agent skill directories present as `.flowai-workflow/agents/agent-*/` (no `.claude/skills/` symlinks). Evidence: commit `6176e91`, `985e3e5`; FR-S33 removes remaining `.claude/skills/ agent-*` symlinks
  - [x] Workflow produces 5 agent invocations in happy path (pm, architect, tech-lead, developer, qa) plus 1 post-workflow (tech-lead-review). Evidence: commit `f0085df`, `.flowai-workflow/workflow.yaml` (developer node in impl-loop)
  - [x] Developer creates commits on feature branch during implementation. Evidence: commit `f0085df`, `.flowai-workflow/agents/agent-developer/SKILL.md`
  - [x] QA posts review on PR only (not issue comment). Evidence: `.flowai-workflow/agents/agent-qa/SKILL.md`
  - [x] Tech-lead-review merges PR if CI green, or leaves open with comments. Evidence: `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md`
  - [x] `--prompt` mode (no GitHub issue) uses fallback branch name `sdlc/<run-id>`. Evidence: `.flowai-workflow/agents/agent-tech-lead/SKILL.md`
  - [x] SRS, SDS updated to reflect final workflow structure. Evidence: `documents/requirements-sdlc.md`, `documents/design-sdlc.md`



### 3.22 FR-S22: Agent First-Person Voice in GitHub Interactions

- **Description:** All 6 agent SKILL.md files MUST include a `## Voice` section
  that: (1) explicitly covers GitHub issue comments, PR descriptions, and status
  updates in scope; (2) provides correct/incorrect example pairs including one
  targeting GitHub interactions; (3) uses first-person ("I") in all hardcoded
  `gh issue comment` body strings.
- **Rationale:** FR-S20 established per-agent Voice sections but omitted explicit
  GitHub interaction scope and lacked GitHub-specific examples. Passive/impersonal
  templates in PM, Architect, and Tech Lead comments reduce traceability.
- **Scope:** All `gh issue comment` and `gh pr review` body strings in agent
  SKILL.md files, plus the `## Voice` section scope sentence and examples.
- **Acceptance criteria:**
  - [x] Hardcoded `gh issue comment --body` templates changed to first-person in
    PM, Architect, and Tech Lead SKILL.md files. Evidence:
    `.flowai-workflow/agents/agent-pm/SKILL.md`,
    `.flowai-workflow/agents/agent-architect/SKILL.md`,
    `.flowai-workflow/agents/agent-tech-lead/SKILL.md`
  - [x] "This includes GitHub issue comments, PR descriptions, and status
    updates." scope sentence added to all 6 `## Voice` sections. Evidence:
    `.flowai-workflow/agents/agent-pm/SKILL.md`,
    `.flowai-workflow/agents/agent-architect/SKILL.md`,
    `.flowai-workflow/agents/agent-tech-lead/SKILL.md`,
    `.flowai-workflow/agents/agent-developer/SKILL.md`,
    `.flowai-workflow/agents/agent-qa/SKILL.md`,
    `.flowai-workflow/agents/agent-tech-lead-review/SKILL.md`
  - [x] Third correct/incorrect example pair targeting GitHub interactions added
    to all 6 `## Voice` sections. Evidence: all 6 SKILL.md files listed above.


