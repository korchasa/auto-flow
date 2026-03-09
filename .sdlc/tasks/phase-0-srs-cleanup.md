## Phase 0: SRS/SDS Scope Cleanup + AC Sync

### Problem

SRS (`documents/requirements.md`) and SDS (`documents/design.md`) contain
outdated scope (GitHub Issue trigger, GHA workflow) and stale AC markers.
Multiple implemented features have `[ ]` markers. A new requirement (Agents as
Skills) needs to be added.

### Task 1: Remove GitHub Issue pipeline scope from SRS and SDS

Remove or mark as "Deferred" all references to:
- FR-1: `deno task run:issue <N>` subcommand, GitHub Issue trigger, re-run
  guard (keep `run:task`, `run:text`, `run:file`)
- FR-9: issue comment posting via `gh` (keep PR creation)
- FR-11: issue comment posting (keep meta-report generation)
- FR-12: GHA workflow references (keep devcontainer, local execution)
- FR-14: `agent/<issue-number>` branch naming for issue mode (keep engine
  branch management)
- Section 2 "System context": remove `deno task run:issue` as primary trigger
- Section 5 "Interfaces": remove issue-based trigger, update CLI interface
- Section 6 "Acceptance criteria": remove issue-based criteria
- Appendix references to GH issue flow

In SDS: remove GHA workflow, issue-based triggering, issue comment posting.

Do NOT remove: PR creation (Presenter), `gh` CLI for PR operations, GitHub
token for PR operations.

### Task 2: Update AC markers for FR-8 (Continuation Mechanism)

These ACs were implemented in PR #8 (branch agent/8, now merged). Update
markers from `[ ]` to `[x]` with evidence:

- Executor `custom_script` validation rule. Evidence:
  `.sdlc/engine/validate.ts`, `.sdlc/pipeline.yaml` executor node
- QA `frontmatter_field` validation rule. Evidence:
  `.sdlc/engine/validate.ts`, `.sdlc/engine/validate_test.ts`
- If continuation limit reached: node fails, `run_always` nodes (Meta-Agent)
  still execute. Evidence: `.sdlc/engine/engine.ts` (collectRunAlwaysNodes),
  `.sdlc/engine/types.ts` (run_always field)
- Gitleaks CLI primary detection. Evidence: `.sdlc/engine/git.ts` (runGitleaks)
- Safety violation triggers continuation. Evidence:
  `.sdlc/engine/engine.ts` (executeAgentNode safety-continuation loop)

### Task 3: Update AC markers for FR-18 (Verbose Output)

FR-18 was fully implemented in PR #7 (branch agent/18, merged). Update all 8
ACs from `[ ]` to `[x]` with evidence from `.sdlc/engine/output.ts`,
`.sdlc/engine/engine.ts`, `.sdlc/engine/agent.ts`.

### Task 4: Add new FR-19 "Agents as Skills" to SRS

Add a new functional requirement FR-19 to `documents/requirements.md`:

- **Description:** Each pipeline agent is a Claude Code project skill, stored
  in `./agents/<name>/SKILL.md`. Skills are linked into `.claude/skills/` via
  symlinks for IDE integration. Each agent can be invoked standalone via
  `/agent-<name>` or used by the pipeline engine.
- **Acceptance criteria:**
  - [ ] Each of 9 agents has a dedicated directory under `./agents/<name>/`
    with a `SKILL.md` file containing YAML frontmatter (name, description,
    disable-model-invocation) and role instructions.
  - [ ] Symlinks exist: `.claude/skills/agent-<name>` →
    `../../agents/<name>/` for all 9 agents.
  - [ ] Pipeline engine `prompt:` fields in `pipeline.yaml` and
    `pipeline-task.yaml` reference the new SKILL.md paths.
  - [ ] Current `.sdlc/agents/*.md` files are migrated (content preserved,
    format adapted to SKILL.md with frontmatter).
  - [ ] `.sdlc/agents/` directory removed after migration.
  - [ ] Each agent skill is invocable standalone via `/agent-<name>`.
  - [ ] `deno task check` passes after migration.

Also update SDS to document the new agents directory structure and symlink
pattern.

### Task 5: Delete completed task files

Remove `.sdlc/tasks/fr-8.md` and `.sdlc/tasks/fr-10-agent-log-storage.md`
(both tasks are implemented and merged).

### Out of Scope

- Implementing Agents as Skills (FR-19) — that's Phase 1
- Code changes to the engine
- Changes to agent prompt content
