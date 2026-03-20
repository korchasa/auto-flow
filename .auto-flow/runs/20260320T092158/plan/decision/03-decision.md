---
variant: "Variant C: Migrate + Add build file_not_empty Check"
tasks:
  - desc: "Replace file_exists + file_not_empty + contains_section rules with artifact rule for all 6 agent nodes"
    files: [".auto-flow/pipeline.yaml"]
---

## Justification

I selected Variant C because:

1. **Honest about behavioral delta.** The `build` node currently validates
   `04-impl-summary.md` with `file_exists` + `contains_section: Summary` but
   lacks `file_not_empty`. Migrating to `artifact` implicitly adds the
   non-empty check. Variant C explicitly documents this tightening — Variant A
   silently introduces it. Transparency aligns with the project's
   "fail fast, fail clearly" strategy (AGENTS.md).

2. **Minimal effort (S).** Single file (`pipeline.yaml`), single commit.
   Mechanical transformation — no logic changes, no new code, no test changes.

3. **Risk is negligible.** A file containing `## Summary` cannot be empty, so
   the added `file_not_empty` check on `build` is a no-op tightening. Engine's
   `artifact` rule is already implemented and tested.

4. **Vision alignment.** AGENTS.md states the engine handles validation via
   YAML configs. Using the composite `artifact` rule reduces config verbosity
   (~11 fewer rules) and leverages engine capabilities as designed.

Variant B (per-node sequential) adds unnecessary overhead for a trivially
mechanical change — 6 commits for a single-file edit with no behavioral risk.

## Task Descriptions

### Task 1: Replace validate rules with artifact rule for all 6 agent nodes

Replace `file_exists` + `file_not_empty` + `contains_section` rule groups with
a single `type: artifact` rule per node in `.auto-flow/pipeline.yaml`:

- **specification**: Replace 5 rules (file_exists, file_not_empty,
  contains_section×3) → 1 `artifact` with `sections: [Problem Statement, Scope, Summary]`.
  Keep 2× `frontmatter_field` (issue, scope) unchanged.
- **design**: Replace 3 rules → 1 `artifact` with `sections: [Summary]`.
- **decision**: Replace 3 rules → 1 `artifact` with `sections: [Summary]`.
- **build**: Replace 2 rules (file_exists, contains_section) → 1 `artifact`
  with `sections: [Summary]`. Build gains implicit `file_not_empty` check
  (no-op tightening). Keep `custom_script` unchanged.
- **verify**: Replace 3 rules (file_exists, file_not_empty, contains_section) →
  1 `artifact` with `sections: [Summary]`. Keep `frontmatter_field: verdict`
  unchanged.
- **tech-lead-review**: Replace 3 rules → 1 `artifact` with `sections: [Summary]`.

Verification: `deno task check` must pass post-edit (validates pipeline config
via `loadConfig()`).

## Summary

- I selected Variant C: single-pass migration with explicit acknowledgment of
  `build` node gaining `file_not_empty` (no-op tightening).
- Rationale: effort S, negligible risk, transparent about behavioral delta,
  leverages engine's composite `artifact` rule as designed.
- 1 task: mechanical replacement in `pipeline.yaml` (19 rules → 6 `artifact`
  rules; 4 rules unchanged).
- Branch `sdlc/issue-174` created, draft PR opened.
