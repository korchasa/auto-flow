# Documentation Rules

**CRITICAL:** MEMORY RESETS. DOCS = ONLY LINK TO PAST. MAINTAIN ACCURACY.

## Scope Separation

Project has two in-repo documentation scopes:

- **Engine** — domain-agnostic DAG executor (`engine/`). Core features: node
  types, validation, continuation, resume, HITL, CLI, template interpolation.
- **SDLC Workflow** — example workflow using the engine. SDLC-specific agents,
  prompts, GitHub workflow, dashboard, devcontainer.

Each scope has its own SRS and SDS files.

The CLI wrapper library (`@korchasa/ai-ide-cli`) is documented in the sibling
repo [`korchasa/ai-ide-cli`](https://github.com/korchasa/ai-ide-cli)
(`documents/requirements.md`, `documents/design.md`, FR-L numbering).

### GitHub Issue Rules

- **Title prefix:** `engine:`, `sdlc:`, or `engine+sdlc:`. Mandatory.
- **Labels:** Every issue MUST have scope label(s):
  - Single scope: `scope: engine` or `scope: sdlc`.
  - Mixed: both `scope: engine` AND `scope: sdlc`.
- **FR reference:** If issue relates to an existing FR, include `FR-E<N>` or
  `FR-S<N>` in the title or body.
- **When to use `engine+sdlc:`:** Cross-cutting tasks that touch both scopes
  and cannot be meaningfully split. Prefer separate issues when scopes are
  independent.

## Hierarchy

1. **`AGENTS.md`**: "Why" & "For Whom". Long-term goal/value. READ-ONLY.
2. **SRS Engine** (`documents/requirements-engine.md` — index; sections under
   `documents/requirements-engine/*.md`): "What" & "Why" for engine. Source
   of truth. FR-E numbering.
3. **SRS SDLC** (`documents/requirements-sdlc.md` — index; sections under
   `documents/requirements-sdlc/*.md`): "What" & "Why" for SDLC workflow.
   Source of truth. FR-S numbering.
4. **SDS Engine** (`documents/design-engine.md` — index; sections under
   `documents/design-engine/*.md`): "How" for engine.
5. **SDS SDLC** (`documents/design-sdlc.md` — index; sections under
   `documents/design-sdlc/*.md`): "How" for SDLC workflow.
6. **Tasks** (`documents/tasks/<YYYY-MM-DD>-<slug>.md`): Temporary plans/notes per task.
7. **IDE Differences** (`documents/ides-difference.md` — index; sections under
   `documents/ides-difference/*.md`): R&D reference on AI IDE/CLI capabilities,
   context primitives, config formats, migration paths. Per-IDE files +
   cross-IDE comparison + Cursor→Claude Code conversion guide.

### File size budget

Every file under `documents/` must fit in `Read`'s 10k-token limit. Working
budget ~8k tokens / ~30 KB per file. If a file grows past this, split it by
functional area: keep the original path as a thin index, move sections into
a sibling directory. FR-IDs are stable on move — never renumber.
`scripts/check.ts` enforces this via `docsTokenBudget()`.

## Rules

- **STRICT COMPLIANCE**: AGENTS.md, SRS, SDS.
- **Workflow**: New/Updated req -> Update SRS -> Update SDS -> Implement.
- **Status**: `[x]` = implemented, `[ ]` = pending.
- **Evidence**: Every `[x]` acceptance criterion MUST include evidence -- file
  paths with line numbers proving implementation. Format:
  `- [x] Criterion text. Evidence: \`path/to/file.ts:42\`,
  \`other/file.md:10\``Without evidence, criterion stays`[ ]`.

## SRS Format

Separate files per scope. Same structure in each:

```markdown
# SRS: Engine (or SDLC Workflow)

## 0. Resolved Design Decisions

## 1. Intro
- **Desc:**
- **Def/Abbr:**

## 2. General
- **Context:**
- **Assumptions/Constraints:**

## 3. Functional Reqs
### 3.1 FR-E1: Title
- **Desc:**
- **Acceptance:**

## 4. Non-Functional
## 5. Interfaces
```

FR numbering: `FR-E<N>` for engine, `FR-S<N>` for SDLC workflow.

## SDS Format

Separate files per scope. Same structure in each:

```markdown
# SDS: Engine (or SDLC Workflow)

## 1. Intro
- **Purpose:**
- **Rel to SRS:**

## 2. Arch
- **Diagram:**
- **Subsystems:**

## 3. Components
### 3.1 Comp A
- **Purpose:**
- **Interfaces:**
- **Deps:**

## 4. Data
## 5. Logic
## 6. Non-Functional
## 7. Constraints
```

## Tasks (`documents/tasks/`)

- One file per task or session: `<YYYY-MM-DD>-<slug>.md` (kebab-case slug, max 40 chars).
- Examples: `2026-03-24-add-dark-mode.md`, `2026-03-24-fix-auth-bug.md`.
- Do not reuse another session's task file — create a new file. Old task files provide context but may contain outdated decisions.
- Use GODS format (see below) for issues and plans.
- Directory is gitignored. Files accumulate — this is expected.

### GODS Format

```markdown
---
implements:
  - FR-E<N>  # or FR-S<N> for SDLC scope; omit block if no FR yet
---
# [Task Title]

## Goal

[Why? Business value.]

## Overview

### Context

[Full problematics, pain points, operational environment, constraints, tech
debt, external URLs, @-refs to relevant files/docs.]

### Current State

[Technical description of existing system/code relevant to task.]

### Constraints

[Hard limits, anti-patterns, requirements (e.g., "Must use Deno", "No external
libs").]

## Definition of Done

- [ ] [Criteria 1]
- [ ] [Criteria 2]

## Solution

[Detailed step-by-step for SELECTED variant only. Filled AFTER user selects
variant.]
```

## Compressed Style Rules (All Docs)

- **No History**: No changelogs.
- **English Only(Except task files)**.
- **Summarize**: Extract facts -> compress. No loss of facts.
- **Essential Info**: No fluff. High-info words.
- **Compact**: Lists, tables, YAML, Mermaid.
- **Lexicon**: No stopwords. Short synonyms.
- **Entities**: Abbreviate after 1st use.
- **Direct**: No filler.
- **Structure**: Headings/sections.
- **Symbols**: Replace words with symbols/nums.
