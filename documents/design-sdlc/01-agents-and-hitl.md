<!-- section file — index: [documents/design-sdlc.md](../design-sdlc.md) -->

# SDS SDLC — Components: Docker, Stage Scripts, Shared Lib, Agent Skills, Reflection Memory, HITL


### 3.1 Docker Image

- **Purpose:** Single runtime environment for all stages.
- **Interfaces:** Contains `claude` CLI, `deno`, `git`, `gh`, `gitleaks`.
- **Deps:** Node.js (for claude CLI install), Deno runtime.

### 3.2 Stage Scripts — DELETED (FR-S26)

- **Status:** Deleted. Legacy stage orchestration scripts (`stage-*.sh`) and
  associated tests removed per FR-S26. Superseded by Deno/TypeScript workflow
  engine (`engine/`). Use `deno task run`.
- **Legacy `test:*` deno.json tasks:** Removed alongside scripts. No backward
  compatibility retention needed — engine execution via `deno task run` is the
  sole workflow entry point.

### 3.3 Shared Library (`.flowai-workflow/scripts/lib.sh`)

- **Purpose:** Common functions for all stage scripts.
- **Interfaces:** Functions: `log()`, `run_agent()`, `validate_artifact()`,
  `continuation_loop()`, `commit_artifacts()`, `report_status()`,
  `safety_check_diff()`, `retry_with_backoff()`.
  - `retry_with_backoff()`: Generic retry wrapper for external CLI calls
    (`claude`, `gh`). Max 3 attempts, 5s initial delay, 2x backoff. Retries on
    non-zero exit (network/rate-limit errors). Does not retry validation
    failures.
- **Deps:** `claude` CLI, `git`, `gh`.

### 3.4 Agent Skills (`.flowai-workflow/agents/agent-*`) (FR-S17, FR-S26)

- **Purpose:** Versioned system prompts defining each agent's role and behavior.
  Each agent lives in `.flowai-workflow/agents/agent-<name>/SKILL.md` (canonical
  location per FR-S26). Pipeline-driven: agent prompt files loaded via
  `{{file(...)}}` in the workflow's `system_prompt` field (FR-S38); per-task
  user message delivered via `prompt` field. Shared agent rules are inlined
  into each agent prompt file — no separate `shared-rules.md` is maintained
  (six inline copies were chosen over one shared file plus six references).
  Redundant `# BEFORE YOU DO ANYTHING` read-rules bootstrap removed from all
  6 agent prompt files (FR-S39) — the rules are already part of the loaded
  system prompt. Agent-specific "first tool call MUST be" instruction
  (5 of 6 agents) preserved as standalone paragraph before `# Role:`.
  Legacy `.claude/skills/` symlinks removed per FR-S33 — interactive
  `/agent-<name>` slash commands no longer supported (workflow-only agents
  should not be exposed as interactive skills).
- **Directory structure:** `.flowai-workflow/agents/agent-<name>/SKILL.md` — 6 agents:
  - `agent-pm` — triages open GitHub issues, selects highest-priority, produces
    spec. **Issue Author Filter (FR-S31):** PM filters candidates by author at
    two points: (1) `gh issue list --author korchasa` in STEP 2a (triage path),
    (2) `gh issue view --json author` + fail-fast guard in STEP 2c (resume/
    direct-branch path). Hardcoded `korchasa`; configurability deferred.
  - `agent-architect` — design-solution role: produces implementation plan with
    2-3 variants, affected files, effort estimates, risk analysis.
    **Codebase Exploration (FR-S43):** Before variant design, launches 2–3
    parallel `Agent` sub-agents with distinct focus areas (prior art,
    architecture layers, integration points). Sub-agents run within same
    session — no separate workflow node. Exploration findings provide concrete
    file:line evidence consumed by variant design phase. Explicit `Agent` tool
    allowance overrides the agent prompt's default tool prohibition.
  - `agent-tech-lead` — critique + decision + SDS update + branch creation
    (`git checkout -b sdlc/issue-<N>`) or rebase existing branch onto
    `origin/main` (`git rebase origin/main`, with conflict resolution) +
    draft PR (`gh pr create --draft`) + task breakdown from selected variant.
    Uses `{{run_id}}` for `--prompt` mode fallback branch `sdlc/{{run_id}}`.
  - `agent-developer` — implements tasks. Owns `git add`, `git commit`,
    `git push` after each task. Commit messages follow `sdlc(impl): <summary>`
    format.
  - `agent-qa` — verifies developer output. Posts verdict as PR review
    (`gh pr review`: approve/request-changes). **Check suite extension
    (FR-S31):** May autonomously add new verification functions to
    `scripts/check.ts` when recurring quality issues are detected. Constrained
    to evidence-based additions only, standalone function pattern, label to
    stdout, `Deno.exit(1)` on failure, zero false positives confirmed by
    running extended suite post-addition.
    **Confidence Scoring (FR-S44):** Applies 0–100 confidence score to each
    finding. Findings ≥ 80 → verdict-affecting (included in main report).
    Findings < 80 → listed in `## Observations` section (non-blocking, do not
    affect verdict). QA report frontmatter gains optional
    `high_confidence_issues: <N>` field.
    **Multi-Focus Parallel Review (FR-S45):** Launches 2–3 parallel `Agent`
    sub-agents with distinct focus: (1) correctness/bugs, (2) simplicity/DRY,
    (3) conventions/abstractions. Sub-agents run within same QA session — no
    new workflow node. Findings consolidated into per-focus sections in QA
    report. All findings subject to confidence scoring per FR-S44. Explicit
    `Agent` tool allowance overrides the agent prompt's default tool prohibition.
  - `agent-tech-lead-review` — post-workflow: final code review + CI gate
    check + merge. `run_on: always`. Handles missing-PR case gracefully.
- **Removed agents (FR-S15):** `tech-lead-reviewer`, `tech-lead-sds`,
  `committer`, `code-reviewer`.
- **Removed agents (FR-S9, issue #127):** `agent-meta-agent` — prompt
  optimization removed due to unreviewed SKILL.md edit risk and marginal value.
  Superseded by two-layer per-agent reflection (FR-S32).
- **Shared Reflection Protocol (FR-S32):**
  `.flowai-workflow/agents/reflection-protocol.md` — single source of truth for
  two-layer reflection protocol (MEMORY + HISTORY). Referenced by each agent's
  `## Reflection Memory` section in SKILL.md and reinforced via `task_template`
  in `workflow.yaml`. See §3.4.1 for details.
- **SKILL.md frontmatter (agentskills.io-compliant):**
  ```yaml
  ---
  name: "agent-<name>"
  description: "<one-line role description>"
  compatibility: ["claude-code"]
  allowed-tools: []
  ---
  ```
  - `compatibility: ["claude-code"]` — declares runtime compatibility.
  - `allowed-tools: []` — no automatic tool grants; agents use tools available
    in their execution context.
- **Interfaces:**
  - Pipeline (FR-S38): each agent node uses two fields. `system_prompt` loads
    the agent prompt file via `{{file(...)}}`. `prompt` carries the per-task
    user message and additionally injects `reflection-protocol.md` plus
    per-agent memory/history paths. Shared rules are inlined into each agent
    prompt file — no separate `shared-rules.md`. Template structure per node:
    ```yaml
    system_prompt: |
      {{file(".flowai-workflow/github-inbox/agents/agent-<name>.md")}}
    prompt: |
      {{file(".flowai-workflow/github-inbox/memory/reflection-protocol.md")}}
      Memory: .flowai-workflow/github-inbox/memory/agent-<name>.md
      History: .flowai-workflow/github-inbox/memory/agent-<name>-history.md
      ---
      <task-specific content>
    ```
    Engine `file()` template function resolves paths at runtime, inlines
    file content before CLI invocation. `system_prompt` is delivered as the
    runtime's system prompt; `prompt` as the user message (`-p`).
  - Interactive: Removed (FR-S33). Legacy `.claude/skills/agent-<name>`
    symlinks deleted. Pipeline-only agents are no longer discoverable as
    interactive Claude Code skills.
- **Agent Execution Summary (FR-S20, FR-S21, FR-S42):** All 6 agents must
  produce a `## Summary` section in their output artifacts. Content: 2-5 bullet
  points (actions taken, key decisions, artifacts produced, issues encountered).
  5 agents (PM, Architect, Tech Lead, QA, Tech Lead Review) append `## Summary`
  to their markdown artifact files. Developer includes summary in commit message
  body (no separate artifact file). Pipeline enforces via composite `artifact`
  validation rule (FR-S42) on all 6 agent nodes — each node declares a single
  `type: artifact` rule combining `file_exists` + `file_not_empty` +
  `contains_section` (via `sections` array). `build` also retains
  `custom_script: deno task check`. `specification` additionally validates
  sections `Problem Statement` and `Scope`. `verify` retains separate
  `frontmatter_field: verdict` rule. `specification` retains separate
  `frontmatter_field` rules for `issue` and `scope`.
- **Voice Convention (FR-S20, FR-S22):** Each SKILL.md contains a `## Voice`
  section (after `# Role:` heading, before `## Responsibilities`) mandating
  first-person narrative ("I") in all agent outputs. Scope explicitly includes
  GitHub issue comments, PR descriptions, and status updates (FR-S22). Passive/
  third-person prohibited in narrative text. YAML frontmatter and code blocks
  excluded. Each agent's section includes 3 role-specific correct vs incorrect
  example pairs: 2 anchored to artifacts/reports, 1 targeting GitHub
  interactions specifically (e.g., PM: "I started the specification phase" not
  "Specification phase started"; QA: "I verified all criteria" not "All criteria
  were verified"). Hardcoded `gh issue comment --body` templates in SKILL.md
  files must also use first-person (FR-S22).
- **Migration (FR-S17, FR-S26, FR-S33):** Three migrations completed:
  1. FR-S17: `agents/<name>/` → `.flowai-workflow/agents/agent-<name>/` (symlinks
     eliminated, `.claude/skills/` became canonical).
  2. FR-S26: `.flowai-workflow/agents/agent-<name>/` → `.flowai-workflow/agents/agent-<name>/`
     (consolidated into workflow directory; `.claude/skills/agent-<name>`
     symlinks created for Claude Code discovery).
  3. FR-S33: `.claude/skills/agent-<name>` symlinks removed. Canonical path
     `.flowai-workflow/agents/agent-<name>/SKILL.md` is sole discovery mechanism.
     `scripts/check.ts` symlink validation block removed (engine `loadConfig()`
     covers prompt file existence).
- **Voice directive (FR-S20):** Each SKILL.md contains `## Voice` section
  (before `## Rules`) mandating first-person ("I") narrative in all prose
  output. Shared 3-line core directive (first-person mandate, prohibited
  patterns, scope exclusions for YAML/code/tables) + 1 agent-specific
  correct/incorrect example pair per file. Applies to: handoff artifacts,
  PR/issue comments, QA reports, spec files. Excludes: YAML frontmatter,
  code blocks, structured data, tables.
- **Comment Identification (FR-S29):** Each SKILL.md contains a
  `## Comment Identification` section defining the prefix rule: all `gh issue
  comment` and `gh pr review` body strings MUST start with
  `**[<Agent> · <phase>]**`. Each agent's section specifies its prefix value:
  PM→`**[PM · specify]**`, Architect→`**[Architect · plan]**`,
  Tech Lead→`**[Tech Lead · decide]**`, Developer→`**[Developer · implement]**`,
  QA→`**[QA · verify]**`, Tech Lead Review→`**[Tech Lead Review · review]**`.
  Section is separate from `## Voice` (FR-S22/FR-S22) — Voice governs tone,
  Comment Identification governs attribution. Covers both hardcoded templates
  and dynamically generated comment bodies. Developer has no existing templates;
  section serves as instruction for future `gh` calls.
- **Deps:** None (static content, versioned in git).

### 3.4.1 Two-Layer Agent Reflection Memory (FR-S28, FR-S32)

- **Purpose:** Cross-run learning via per-agent memory and history files.
  Replaces single-layer reflection (FR-S28) with two-layer design (FR-S32).
  Eliminates meta-agent dependency — each agent manages its own learning.
- **Shared Protocol:** `.flowai-workflow/agents/reflection-protocol.md` — single
  source of truth for the two-layer reflection protocol. Referenced by each
  agent's `## Reflection Memory` section in SKILL.md (~3-5 line reference
  block) and reinforced via `task_template` in `workflow.yaml`. Contains:
  - Layer 1 (MEMORY) format and rules
  - Layer 2 (HISTORY) format and rules
  - Lifecycle instructions
  - Size constraints
- **Layer 1 — MEMORY** (edit-in-place operative knowledge):
  - **Directory:** `.flowai-workflow/memory/` — 6 files, one per agent:
    `agent-pm.md`, `agent-architect.md`, `agent-tech-lead.md`,
    `agent-developer.md`, `agent-qa.md`, `agent-tech-lead-review.md`.
  - **Lifecycle:** Read at session start → execute task → full rewrite at
    session end. Current-state snapshot, not append log. <=50 lines.
  - **Content categories:** Anti-patterns encountered, effective strategies,
    environment quirks, baseline metrics.
- **Layer 2 — HISTORY** (append-only run log):
  - **Directory:** `.flowai-workflow/memory/` — 6 files:
    `agent-pm-history.md`, `agent-architect-history.md`, etc.
  - **Lifecycle:** Read at session start → append one entry at session end.
    FIFO trim to <=20 most recent entries.
  - **Entry format:** Timestamp, issue#, turns, cost, outcome, key learnings.
    Agent-specific fields (e.g., PM: issue selected; QA: verdict).
  - **Purpose:** Enables trend detection — recurring errors, metric drift,
    pattern identification across runs.
- **SKILL.md integration:** Each agent's `## Reflection Memory` section
  replaced with ~3-5 line reference block:
  - "Follow `.flowai-workflow/agents/reflection-protocol.md`."
  - Memory path: `.flowai-workflow/memory/<agent>.md`
  - History path: `.flowai-workflow/memory/<agent>-history.md`
  - Agent-specific HISTORY format hint.
- **Pipeline integration:** Each agent's `task_template` in `workflow.yaml`
  includes both memory and history file paths as reinforcement.
- **Git tracking:** Memory and history files are git-tracked (not gitignored).
  Each agent reads/writes only its own files — no cross-agent access.
- **Interfaces:** File I/O only. No engine awareness — memory is workflow-level
  concern. Agents read/write via standard file tools.
- **Deps:** None (static files, versioned in git).

### 3.5 HITL Pipeline Scripts (`.flowai-workflow/scripts/hitl-*.sh`)

- **Purpose:** Deliver agent questions to humans and poll for replies via
  Telegram Bot API. Pipeline-specific (Telegram), not engine code. Engine
  invokes via configurable paths.
- **Env:** `FLOWAI_TELEGRAM_BOT_TOKEN`, `FLOWAI_TELEGRAM_CHAT_ID` sourced from project-root
  `.env` (gitignored). See `.env.example`. Personal DM with a bot created via
  `@BotFather`.
- **Scripts:**
  - `hitl-ask.sh` — send question to Telegram chat.
    - Input: `--run-dir`, `--run-id`, `--node-id`, `--question-json`
      (`--artifact-source` accepted for engine compat, ignored).
    - Renders plain-text body: `Agent <node> is waiting…` + header + question
      + numbered options + footer `[run=<id> node=<id>]`.
    - Captures baseline `update_id` via
      `GET /getUpdates?offset=-1&limit=1`, writes to
      `$RUN_DIR/$NODE_ID/.tg_baseline` so subsequent checks ignore prior
      messages.
    - Posts via `POST /sendMessage` (JSON body, `disable_web_page_preview`).
    - Deps: `curl`, `jq`.
  - `hitl-check.sh` — poll Telegram for a reply newer than baseline.
    - Input: `--run-dir`, `--node-id` (`--artifact-source`, `--run-id`,
      `--exclude-login` accepted for engine compat, ignored).
    - Reads baseline from `$RUN_DIR/$NODE_ID/.tg_baseline`.
    - Fetches `GET /getUpdates?offset=<baseline+1>&timeout=0`, filters
      `update_id > baseline && message.chat.id == FLOWAI_TELEGRAM_CHAT_ID &&
      message.text`, picks the oldest match.
    - Exit 0 + text on stdout = reply found. Exit 1 = no reply yet.
    - Deps: `curl`, `jq`.
- **Constraints:** Single bot consumer (no webhooks, no parallel pollers) —
  `getUpdates` is exclusive. Telegram retains pending updates for 24h, well
  above default `timeout=7200` (2h).
- **Interfaces:** Called by engine via `defaults.hitl.ask_script` /
  `defaults.hitl.check_script` paths in `workflow.yaml`.


