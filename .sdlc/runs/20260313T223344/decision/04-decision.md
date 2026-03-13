---
variant: "Variant A: Verify-only close"
tasks:
  - desc: "Run FR-27 unit tests and confirm all pass"
    files: ["engine/agent_test.ts"]
  - desc: "Verify SRS FR-27 acceptance criteria evidence (file:line refs)"
    files: ["documents/requirements.md"]
  - desc: "Update SRS FR-27 criteria from [ ] to [x] if any lack evidence"
    files: ["documents/requirements.md"]
  - desc: "Post closure summary to issue #21"
    files: []
---

## Justification

FR-27 (Per-Node Model Configuration) is fully implemented and merged (PR #34).
The spec explicitly documents completed work for formal closure. Selecting
Variant A because:

1. **Vision alignment:** AGENTS.md mandates fully autonomous pipeline with no
   unnecessary human gates. Verify-and-close is the minimal correct action for
   already-merged work — avoids gold-plating completed features.
2. **Scope discipline:** Variant C (config validation gate) is explicitly
   out-of-scope per spec ("Model availability validation at config-load time").
   Adding it would violate scope boundaries and introduce a hardcoded allowlist
   that goes stale as Anthropic releases new models.
3. **Complexity trade-off:** Variant B (regression test hardening) adds
   integration test coupling to dry-run output format for a low-risk,
   recently-merged feature. Test maintenance cost exceeds verification value.
4. **Effort:** S-sized. No code changes needed — only SRS status updates and
   evidence verification.

## Task Descriptions

### Task 1: Run FR-27 unit tests

Execute `deno test engine/agent_test.ts` and confirm the 3 model-related tests
pass: model emission, resume exclusion, absence. These tests at
`engine/agent_test.ts:173-199` cover the full `buildClaudeArgs()` model logic.

### Task 2: Verify SRS acceptance criteria evidence

Cross-reference each FR-27 acceptance criterion's evidence paths against current
codebase. Confirm file:line references still point to correct implementation:
- `engine/types.ts:21,35` — `model?: string` fields
- `engine/agent.ts:302-303` — `--model` flag conditional emission
- `engine/loop.ts:76` — body node model resolution
- `.sdlc/pipeline.yaml:15,64,83,146` — default + overrides
- `engine/agent_test.ts:173-199` — test coverage

### Task 3: Update SRS FR-27 status

If any acceptance criterion lacks evidence or has stale file:line refs, update
to `[x]` with corrected evidence. If all already marked `[x]`, no-op.

### Task 4: Post closure summary

Comment on issue #21 with verification results: test pass/fail, criteria
evidence status, recommendation to close.
