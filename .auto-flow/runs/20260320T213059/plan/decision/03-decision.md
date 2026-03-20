---
variant: "Variant A: Inline Frontmatter Parsing in checkArtifact"
tasks:
  - desc: "Add `fields?: string[]` to ValidationRule type"
    files: ["engine/types.ts"]
  - desc: "Extend `validateValidationRule()` — validate `fields` entries, make `sections` optional when `fields` present"
    files: ["engine/config.ts"]
  - desc: "Add config_test cases: non-string field rejected, empty-string rejected, artifact with fields-only (no sections) accepted"
    files: ["engine/config_test.ts"]
  - desc: "Extend `checkArtifact()` with inline frontmatter field presence check after section check"
    files: ["engine/validate.ts"]
  - desc: "Add validate_test cases: fields absent (skip), all present, one missing, one empty-valued"
    files: ["engine/validate_test.ts"]
---

## Justification

I selected Variant A (inline frontmatter parsing) for these reasons:

1. **Minimal blast radius.** Only extends existing `checkArtifact()` with ~15
   lines of regex-based frontmatter parsing. No refactoring of working
   `checkFrontmatterField()` code — zero regression risk.
2. **Acceptable duplication.** The two parsing sites serve distinct semantic
   purposes: `checkFrontmatterField` validates value constraints (`allowed`
   set); `checkArtifact` checks presence-only. Distinct error formats and
   aggregation logic. Premature extraction (Variant B) violates AGENTS.md
   principle of simple-first design — extraction can happen if a future FR
   introduces more frontmatter features on `artifact` rules.
3. **No coupling.** Variant C creates behavioral coupling between
   `checkArtifact` and `checkFrontmatterField` internals, plus N re-parses per
   N fields. Variant A is self-contained.

## Task Descriptions

1. **Add `fields?: string[]` to ValidationRule type** (`engine/types.ts`).
   Optional property on the existing `ValidationRule` interface. Skipped when
   absent/empty — backward compatible.

2. **Extend `validateValidationRule()`** (`engine/config.ts`). When
   `type === "artifact"`: validate `fields` entries (non-empty strings) when
   present. Make `sections` optional — artifact rule may have only `fields`,
   only `sections`, or both. At least one of `sections`/`fields` required.

3. **Add config_test cases** (`engine/config_test.ts`). Non-string entry in
   `fields` → rejected. Empty-string entry → rejected. Artifact rule with
   `fields` only (no `sections`) → accepted. Artifact rule with neither →
   rejected.

4. **Extend `checkArtifact()` with field presence check**
   (`engine/validate.ts`). After section check: if `fields` present, parse
   frontmatter via `^---\n([\s\S]*?)\n---` regex (same approach as
   `checkFrontmatterField`). For each field: check key exists and value is
   non-empty. Collect missing/empty into one aggregate error. Fail-fast order
   preserved: absent file → empty file → missing sections → missing/empty
   fields.

5. **Add validate_test cases** (`engine/validate_test.ts`). Four scenarios:
   fields absent (skip — no error), all fields present with values, one field
   missing from frontmatter, one field present but empty-valued.

## Summary

I selected Variant A (inline frontmatter parsing in checkArtifact). Minimal
change surface, no refactoring of existing code, no coupling risk. 5 tasks
ordered by dependency (type → config → config tests → validate → validate
tests). Branch `sdlc/issue-182` with draft PR created.
