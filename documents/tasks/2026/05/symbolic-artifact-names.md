---
date: "2026-05-01"
status: to do
implements: [FR-E16, FR-E62]
tags: [feature, template, config, engine, sdlc]
related_tasks:
  - 2026/05/config-split.md
---
# engine+sdlc: Symbolic artifact names instead of hardcoded paths

## Goal

Decouple producer/consumer agents in the artifact filename. Replace
hardcoded `01-spec.md`, `02-plan.md`, `03-decision.md` references with
symbolic names declared in producer node config and resolved by the
template engine.

## Overview

### Context

Critique #6: every workflow YAML hardcodes filenames in prompts:
`{{input.specification}}/01-spec.md`, `{{input.design}}/02-plan.md`. If
a producer renames its output, downstream prompts silently break — only
detected at runtime when an agent reads a missing file. The `validate`
block protects the producer; nothing protects consumers.

### Current State

- Node prompts reference files by literal name in template strings
  ([.flowai-workflow/github-inbox/workflow.yaml:79](.flowai-workflow/github-inbox/workflow.yaml#L79),
  similar in all 4 workflows).
- `validate.artifact.path` declares producer-side filename, but no
  channel exposes it to consumers.
- `TemplateContext.input` maps node-id → directory only.

### Constraints

- Must not break existing 4 workflows. Migration: introduce symbolic
  layer; keep legacy `{{input.X}}/filename.md` working.
- Engine remains domain-agnostic — symbolic names are config-declared,
  not hardcoded names like `spec`/`plan`.
- Validate at config load time: every consumer reference must resolve.

## Definition of Done

- [ ] New `NodeConfig.outputs?: Record<string, string>` — map of
      symbolic name → relative path inside `node_dir`.
- [ ] New template form `{{input.<node-id>.<output-name>}}` — resolves
      to absolute `<input-dir>/<path>`.
- [ ] Config-load validation:
      - Every `{{input.X.Y}}` reference verifies node X declares
        output Y. Unknown name → load error with FR-E16-style message.
      - When a node uses the new form, its inputs MUST list X.
- [ ] All 4 dogfood workflows migrated:
      `outputs: { spec: "01-spec.md", scope: "01-spec.md#scope" }` etc.
      Prompts reference `{{input.specification.spec}}`.
- [ ] Back-compat: `{{input.X}}/filename.md` remains valid (string
      concat) — no forced migration for client workflows.
- [ ] New unit tests in `template_test.ts` and `config_validate_test.ts`
      (post config-split task).
- [ ] SRS engine: new FR-E62 (Symbolic Artifact References). SDS engine:
      §template resolution updated.
- [ ] AGENTS.md "Inter-agent communication" section updated.

## Solution

### Step 1 — Type + parser

Extend `NodeConfig` with `outputs?: Record<string, string>`. Parse from
YAML in `config-parse.ts` (post config-split task).

### Step 2 — Template resolver

In `template.ts`, extend the `{{input.X}}` regex to match
`{{input.X.Y}}`. Resolution: `outputs[Y]` from producer node config.
Result: `${input[X]}/${outputs[Y]}`. Falls through to plain
`${input[X]}` for legacy form.

### Step 3 — Load-time validation

In `config-validate.ts` (post config-split task), regex-scan every `prompt`,
`system_prompt`, `before`, `after` for `{{input.<id>.<name>}}`. For
each: assert producer declares the name. Aggregate errors before
throwing.

### Step 4 — Migrate dogfood workflows

Each workflow YAML: add `outputs:` block per producer node, rewrite
consumer prompts. One commit per workflow for easy revert.

### Step 5 — Doc update

FR-E62 in `documents/requirements-engine/03-config-and-validation.md`
(or a new section if budget-tight). SDS template-resolution algo.

### Verification

- `deno task check` green.
- All 4 dogfood workflows: dry-run + smoke run produce identical
  artifacts as before.
- Negative test: rename a producer output, expect load-time error
  pointing at the consumer.
- Negative test: reference `{{input.X.unknown}}` → load error.
