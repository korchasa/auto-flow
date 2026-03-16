---
name: create-requirement-ticket
description: >-
  Create GitHub issue as a requirement ticket: problem + requirements only,
  no implementation details. Use when user asks to create a ticket, issue,
  or task for a feature/fix/change.
---

# CREATE REQUIREMENT TICKET

## ROLE

You create GitHub issues that describe **what** needs to be done and **why**,
never **how**. The ticket is a contract between stakeholder and implementer.
Implementer chooses the solution.

## PRINCIPLES

- **Requirements, not implementation.** Describe desired behavior, constraints,
  and acceptance criteria. Do not prescribe architecture, algorithms, or code
  structure.
- **Problem-first.** Every ticket starts with a clear problem statement.
  No problem — no ticket.
- **Observable DoD.** Definition of Done criteria must be verifiable by
  observation or test, but not so narrow that they dictate implementation.
  Good: "File validates at parse time". Bad: "Add `if` check on line 42 of
  config.ts".
- **Minimal scope.** One concern per ticket. If scope grows, split.
- **Evidence over opinion.** Reference existing behavior, error messages,
  config snippets, or user-visible symptoms.

## TICKET STRUCTURE

```markdown
## Problem

<What is wrong or missing. Current behavior, symptoms, impact.
Include code/config snippets if they clarify the problem.>

## Requirements

<Numbered list of WHAT the solution must do. Functional requirements.
Each item is a testable statement about behavior, not about code.>

### Example usage (optional)

<Short snippet showing desired UX/config/API from user perspective.
This is illustration, not specification of internals.>

### Out of scope (optional)

<Explicitly excluded concerns to prevent scope creep.>
```

## RULES

1. **No implementation language.** Do not use words like: "add a function",
   "create a class", "use regex", "call API X", "refactor module Y".
   Describe the desired outcome instead.
2. **No file/line references in requirements.** The ticket must survive
   refactoring. Reference concepts, not locations.
3. **DoD granularity.** Each DoD item should be verifiable in under 1 minute
   (run a command, observe behavior, check output). But it must not prescribe
   the verification method itself.
4. **No redundant DoD.** Do not add "tests pass", "linter clean", "docs
   updated" — these are project-level standards, not per-ticket criteria.
5. **Respect project conventions.** Follow the repository's title prefix rules,
   label conventions, and FR numbering if they exist (check CLAUDE.md).
6. **Language: English.** Tickets and all content in English.
7. **Use `gh issue create`** with `--title`, `--label`, and `--body` via
   HEREDOC for correct formatting.

## ANTI-PATTERNS

- "Add validation in `config.ts:320`" → instead: "Config loader MUST reject
  invalid X at parse time"
- "Use Map instead of object" → instead: "Lookup MUST be O(1) by key"
- "Write unit test for function Z" → instead: requirement implies testability;
  tests are implementer's concern
- "DoD: file `foo.ts` contains class `Bar`" → instead: "System supports
  behavior Y"
- "DoD: PR merged, CI green, coverage ≥ 80%" → these are process standards,
  not ticket-specific

## CHECKLIST (before submitting)

- [ ] Problem statement explains WHY, not just WHAT
- [ ] Every requirement is about behavior, not code
- [ ] No function/class/file names in requirements
- [ ] DoD items are observable but not implementation-prescriptive
- [ ] No generic DoD items that belong to project standards
- [ ] Scope is single-concern
- [ ] Title and labels follow project conventions
