---
date: "2026-05-18"
status: done
implements: [FR-E9]
tags: [engine, runtime, claude, artifacts]
related_tasks:
  - 2026/05/phase-registry-per-run.md
---
# System prompt file artifact for Claude runtime

## Goal

Move Claude system prompt delivery from an inline command-line argument to a
persisted per-node file artifact, so large prompts do not inflate process argv,
operators can inspect the exact interpolated prompt, and sensitive context is
not exposed through routine process listings.

## Overview

### Context

GitHub issue #198 requests replacing inline `--append-system-prompt <text>`
delivery with `--append-system-prompt-file <path>`. The original issue assumed
the Claude process adapter lived in this repository. Since FR-E44, low-level
runtime argument construction lives in the sibling `@korchasa/ai-ide-cli`
package, while `flowai-workflow` still owns workflow interpolation, node
directory selection, and run artifact layout.

### Current State

`flowai-workflow` interpolates `node.system_prompt` in `agent.ts` and passes
the result to the runtime-neutral `systemPrompt` invoke option. The sibling
Claude adapter then renders that value as `--append-system-prompt <text>`.
Tests in this repository still assert the inline flag. Engine design
documentation also describes context injection through
`--append-system-prompt`.

### Constraints

- Preserve current Claude semantics: append to the default system prompt on
  fresh invocations and skip system prompt delivery on resume.
- Keep the final interpolated prompt available as a UTF-8 Markdown artifact at
  the owning node directory, phase-aware through existing FR-E9 path helpers.
- Keep OpenCode, Cursor, and Codex behavior unchanged unless the selected
  implementation variant explicitly extends the shared library contract.
- Avoid engine-side runtime-specific argument construction unless the selected
  variant accepts that coupling deliberately.
- Treat the sibling `@korchasa/ai-ide-cli` boundary as part of the design,
  because Claude argv construction no longer belongs directly to this repo.

## Definition of Done

- [x] FR-E9: `@korchasa/ai-ide-cli` exposes a Claude invoke option for
      file-based system prompt delivery and renders it as
      `--append-system-prompt-file <path>` without accepting simultaneous
      inline `systemPrompt`.
      Test: `../ai-ide-cli/claude/process_test.ts::buildClaudeArgs emits append-system-prompt-file for systemPromptFile`.
      Evidence: `deno test -A --no-check ../ai-ide-cli/claude/process_test.ts`.
- [x] FR-E9: `flowai-workflow` writes the interpolated system prompt to
      `<node-dir>/system-prompt.md` before the first Claude invocation and
      does not rewrite it on resume.
      Test: `agent_test.ts::runAgent writes interpolated system prompt artifact`.
      Evidence: `deno test -A --no-check agent_test.ts`.
- [x] FR-E9: Fresh Claude invocation receives a file-based system prompt path
      instead of inline prompt text, and resume invocation omits both forms.
      Test: `agent_test.ts::runAgent writes interpolated system prompt artifact`.
      Evidence: `deno test -A --no-check agent_test.ts`.
- [x] FR-E9: Regression coverage rejects `--append-system-prompt` for the
      migrated Claude path and verifies `--append-system-prompt-file` or the
      selected equivalent shared-library option.
      Test: `agent_test.ts::runAgent writes interpolated system prompt artifact`.
      Evidence: `deno test -A --no-check agent_test.ts`.
- [x] FR-E9: File-write failures fail clearly and never fall back to inline
      `--append-system-prompt`.
      Test: `agent_test.ts::runAgent fails clearly when system prompt artifact cannot be written`.
      Evidence: `deno test -A --no-check agent_test.ts`.
- [x] FR-E9: SRS and SDS document `system-prompt.md` as a node artifact and
      describe the runtime-library boundary for rendering the Claude flag.
      Test: `scripts/check.ts::docsTokenBudget`.
      Evidence: `deno task check`.
- [x] FR-E9: Full project verification passes after the implementation.
      Test: `deno task check`.
      Evidence: `deno task check`.

## Solution

Selected variant: update `@korchasa/ai-ide-cli` first, then consume the new
typed contract from `flowai-workflow`.

### Files to modify

Sibling repository `../ai-ide-cli`:

- `runtime/adapter-types.ts` — add a typed `systemPromptFile?: string` field
  next to `systemPrompt` for one-shot invocations.
- `claude/process.ts` and `runtime/claude-adapter.ts` — render
  `systemPromptFile` as
  `--append-system-prompt-file <path>` for fresh Claude invocations and keep
  resume behavior aligned with the current `systemPrompt` skip-on-resume
  contract.
- `runtime/*-adapter.ts` for non-Claude runtimes — either ignore
  `systemPromptFile` with explicit documentation or reject it with a clear
  validation error if the shared runtime contract chooses Claude-only support;
  prefer rejection over silent ignore so callers cannot lose system context.
- `claude/process_test.ts` and runtime adapter tests — cover fresh/resume
  behavior, mutual exclusion with inline `systemPrompt`, and reserved-flag
  collision with user-provided `--append-system-prompt-file`.

Current repository:

- `deno.json` / `deno.lock` — bump `@korchasa/ai-ide-cli` after the sibling
  change is released or linked locally.
- `agent.ts` — when `node.system_prompt` is present on a fresh invocation,
  interpolate it once for Claude, write it to `${nodeDir}/system-prompt.md`,
  and pass `systemPromptFile` instead of `systemPrompt` to the runtime
  adapter. For non-Claude runtimes, preserve the existing `systemPrompt`
  behavior. On Claude resume, do not rewrite the file and do not pass either
  prompt option.
- `agent_test.ts` — replace inline `--append-system-prompt` expectations with
  file-artifact assertions and adapter-option assertions.
- `documents/requirements-engine/01-execution-model.md` — extend FR-E9 with
  `system-prompt.md` as runtime metadata under the node directory.
- `documents/design-engine/01-engine-modules-core.md` and, if needed,
  `documents/design-engine/04-data-and-logic.md` — document the split:
  `flowai-workflow` owns interpolation and artifact persistence;
  `ai-ide-cli` owns Claude flag rendering.

### Implementation approach

1. In `ai-ide-cli`, introduce `systemPromptFile?: string` as a typed runtime
   invoke option and validate that callers do not provide both
   `systemPrompt` and `systemPromptFile` for the same fresh Claude invocation.
2. Teach the Claude one-shot argument builder to emit
   `--append-system-prompt-file <path>` only on fresh invocations. Preserve
   current resume behavior: system prompt context is not resent because the
   resumed session inherits it.
3. Add reserved-flag collision checks so a caller cannot set
   `systemPromptFile` while also passing `--append-system-prompt-file` through
   raw extra arguments.
4. Release or locally link the updated `ai-ide-cli`.
5. In `flowai-workflow`, add a small helper in `agent.ts` that:
   - receives `node.system_prompt`, `ctx`, `cwd`, `nodeDir`, and
     `resumeSessionId`;
   - returns `undefined` on resume or when no system prompt is configured;
   - interpolates once on fresh invocation;
   - ensures the node directory exists;
   - writes UTF-8 Markdown with no wrapper text to `system-prompt.md`;
   - returns the file path for `RuntimeInvokeOptions.systemPromptFile`.
6. Replace the current `systemPrompt: interpolate(...)` call with a
   runtime-aware branch: Claude fresh invocation uses
   `systemPromptFile: await writeSystemPromptArtifact(...)`; all other
   runtimes keep `systemPrompt`.
7. Update tests using a fake node directory and a fake adapter to assert both
   the file content and the absence of inline `systemPrompt` on fresh Claude
   invocations.
8. Update FR-E9 and SDS text only after tests define the final path contract.

### Code structure

Keep the artifact writer local to `agent.ts` unless it grows beyond the small
path/interpolation/write responsibility. It should not become a generic
artifact subsystem. The runtime-library option name should stay neutral
(`systemPromptFile`) while the Claude adapter maps it to the Claude-specific
flag.

### Dependencies

This task depends on a sibling `@korchasa/ai-ide-cli` change. During local
development, use the documented sibling checkout link flow rather than
committing a `links` entry. The final `flowai-workflow` change must depend on a
published JSR version or an accepted dependency bump.

### Error handling

Writing `system-prompt.md` is part of preparing the agent invocation. Failure
to create the directory or write the file must fail fast with a clear error
that names the node ID and target path. Do not silently fall back to inline
`systemPrompt`, because that would preserve the exact argv/privacy risk this
task removes.

The local `flowai-workflow` implementation must not set `systemPromptFile` for
non-Claude runtimes. That keeps existing OpenCode/Cursor/Codex behavior stable
even if the sibling library rejects `systemPromptFile` outside Claude.

### Verification commands

- `deno test -A --no-check ../ai-ide-cli/claude/process_test.ts`
- `deno test -A --no-check agent_test.ts`
- `deno task check`
