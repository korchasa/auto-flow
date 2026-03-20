---
variant: "Variant A: Single compile script + workflow"
tasks:
  - desc: "Create compile script with target list and filename convention"
    files: ["scripts/compile.ts"]
  - desc: "Create compile script tests (target generation, filename format, dry-run)"
    files: ["scripts/compile_test.ts"]
  - desc: "Create version-tag-triggered release CI workflow"
    files: [".github/workflows/release.yml"]
  - desc: "Add installation and binary usage docs to README"
    files: ["README.md"]
  - desc: "Register compile task in deno.json"
    files: ["deno.json"]
---

## Justification

I selected Variant A because it satisfies all FR-E39 acceptance criteria (AC1–AC6) with minimal effort and complexity. Key reasons:

- **Follows existing conventions:** Project uses `scripts/*.ts` for tooling (AGENTS.md: "Deno scripting, utilities, validation"). A TypeScript compile script fits this pattern. Variant C's Makefile breaks convention; Variant B's smoke matrix adds CI cost/complexity without proportional confidence gain.
- **Domain-agnostic alignment:** The compile script wraps `deno compile` for the engine binary — no SDLC-specific logic. Aligns with AGENTS.md vision: "Universal DAG-based engine... Domain-agnostic."
- **Incremental approach:** Smoke testing (Variant B) can be added later once the base release pipeline is proven. The `npm:yaml@2` compile compatibility risk is the main concern — addressed in RED phase (TDD) before CI integration.
- **Minimal blast radius:** 4 new files + 1 existing file update. No engine source changes. No test infrastructure changes.

## Task Descriptions

### Task 1: Create compile script (`scripts/compile.ts`)

Deno script wrapping `deno compile` for 4 platform targets. Defines target list as constant array: `[{os: "linux", arch: "x86_64"}, {os: "linux", arch: "arm64"}, {os: "darwin", arch: "x86_64"}, {os: "darwin", arch: "arm64"}]`. Maps each to Deno `--target` value and output filename `auto-flow-<os>-<arch>`. Accepts `--dry-run` flag (print commands without executing). Entry point: `engine/cli.ts`. Compile flags: `--allow-all` (required for `Deno.Command`, env access, file I/O). Output dir: `dist/`.

### Task 2: Create compile script tests (`scripts/compile_test.ts`)

Unit tests for target list generation, output filename convention (`auto-flow-<os>-<arch>`), `--target` mapping, and dry-run mode. Tests validate logic — no actual compilation (TDD RED phase verifies `npm:yaml@2` compatibility separately via integration).

### Task 3: Create release CI workflow (`.github/workflows/release.yml`)

GitHub Actions workflow triggered on `v*` tag push. Steps: checkout → setup-deno → run compile script → `gh release create $TAG dist/*` with auto-generated notes. Single job (no matrix). Uses `ubuntu-latest` runner. Cross-compilation handled by Deno's `--target` flag (no native runner needed for cross-compile).

### Task 4: Add install docs to README

Add "Installation" section: (1) Binary download via GitHub Releases (`curl -L`), (2) `chmod +x`, (3) Usage: `auto-flow --config <path>`. Platform detection example. Mention Deno source install as alternative.

### Task 5: Register compile task in deno.json

Add `"compile": "deno run --allow-all scripts/compile.ts"` to `deno.json` tasks. Enables `deno task compile` as standard interface.

## Summary

I selected Variant A (single compile script + workflow). It satisfies all FR-E39 acceptance criteria with minimal effort, follows the project's `scripts/*.ts` convention, and avoids premature CI complexity. 5 tasks ordered by dependency: compile script → tests → CI workflow → README → deno.json registration. Branch `sdlc/issue-183` with draft PR created.
