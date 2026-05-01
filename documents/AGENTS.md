# Documentation Rules

**CRITICAL:** MEMORY RESETS. DOCS = ONLY LINK TO PAST. MAINTAIN ACCURACY.

> Project-wide scope separation, GitHub issue rules, and the high-level
> documentation hierarchy live in the root [AGENTS.md](../AGENTS.md). This
> file scopes only `documents/`-specific conventions: section index for
> R&D references, file size budget, SRS/SDS/GODS formats, compressed
> style rules.

## Documents Index (extends root hierarchy)

In addition to the SRS/SDS indexes listed in the root `AGENTS.md`, this
folder also hosts:

- **IDE Differences** (`documents/ides-difference.md` — index; sections under
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

### Acceptance criteria — test-coverage convention

Per [ADR-0011](adrs/0011-dod-test-coverage-convention.md), FR
acceptance blocks DO NOT enumerate behaviours that are locked by
regression tests. The pattern:

- **Behaviour covered by a `*_test.ts` assertion** — collapse to one
  per-FR line at the top of the acceptance block. Format:

  ```markdown
  - **Tests:** `<test_file>` (FR-E<N>; regression-locked). See ADR-NNNN.
  ```

  Rules:
  - **Test files only**, comma-separated. No test names — they rot on
    rename. The reader greps `FR-E<N>` inside the listed file(s);
    the project convention embeds FR ids in test names already.
  - `(FR-E<N>; regression-locked)` is the grep anchor + status.
    When the FR id is NOT embedded in any test name, replace with
    `(regression-locked; <3-5-word topic>)` — e.g.
    `(regression-locked; verbose toggle)`.
  - `See ADR-NNNN.` ONLY when an ADR records the rationale; omit
    otherwise (the FR's Description already carries the why).
  - Per-criterion `[x]` bullets exercised by the listed tests are
    removed. CI catches regressions, not the agent re-reading the FR.
- **Behaviour requiring manual verification** (prose docs, generated
  artefacts, one-time migrations, CLI smoke text, static config like
  `deno.json#tasks`, behaviours not yet test-covered) — stays as a
  `[x]` bullet with `Evidence: <path>:<line>` per the rule above.
- **`[x] deno task check passes`** — DROP. The repo runs `deno task
  check` on every commit; restating "CI is green" per FR is noise.

When auditing an existing acceptance block to apply this convention:
grep each listed test file for `FR-E<N>` (or read the tests by name
when no FR-tagged tests exist) and confirm assertions actually
exercise the claim. A test mentioned in `Evidence:` but unrelated to
the claim is NOT a regression lock — the item stays as `[x]`.

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
- **Compact**: Lists, tables, YAML, Mermaid. (Tables only in long-lived docs;
  do NOT use them in chat output — they render poorly in terminals.)
- **Lexicon**: No stopwords. Short synonyms.
- **Entities**: Abbreviate after 1st use.
- **Direct**: No filler.
- **Structure**: Headings/sections.
- **Symbols**: Replace words with symbols/nums.
