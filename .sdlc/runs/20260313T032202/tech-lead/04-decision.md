---
variant: "Variant B"
tasks:
  - desc: "Add model field to PipelineDefaults and NodeConfig in types.ts"
    files: [".sdlc/engine/types.ts"]
  - desc: "Add model field to AgentRunOptions and InvokeOptions; emit --model in buildClaudeArgs with resume exclusion"
    files: [".sdlc/engine/agent.ts"]
  - desc: "Resolve effective model in executeAgentNode and pass to runAgent"
    files: [".sdlc/engine/engine.ts"]
  - desc: "Resolve effective model in loop body node execution and pass to runAgent"
    files: [".sdlc/engine/loop.ts"]
  - desc: "Forward model field through HitlRunOptions to runAgent"
    files: [".sdlc/engine/hitl.ts"]
  - desc: "Add pipeline.yaml model defaults and per-node overrides"
    files: [".sdlc/pipeline.yaml"]
  - desc: "Write tests for --model emission and resume exclusion in buildClaudeArgs"
    files: [".sdlc/engine/agent_test.ts"]
---

## Critique

### Variant A: claudeArgs mutation

- **Issue:** Resume exclusion of `--model` is caller responsibility spread across
  3 call sites (engine.ts, loop.ts, hitl.ts). This is an implicit contract — easy
  to miss when adding new call paths. The plan acknowledges this risk but offers
  no mitigation. `claudeArgs` is a shared array; mutating it (prepend/strip) in
  callers violates single-responsibility and makes the contract invisible to
  future maintainers.

### Variant B: First-class field in InvokeOptions + buildClaudeArgs

- **Issue:** Slightly more fields to thread through (model in AgentRunOptions,
  InvokeOptions, HitlRunOptions). However, the plan understates that
  `HitlRunOptions` already threads `claudeArgs` — adding one more field is
  marginal cost. The plan's risk note ("forgetting to pass model = no flag =
  safe default") is accurate but should be explicitly documented in JSDoc.

### Variant C: Config-level claude_args merge

- **Issue:** Array scanning for `--model` + next arg is fragile (plan correctly
  identifies this). Mixing semantic config with raw CLI args creates precedence
  confusion: what if user also puts `--model` in `claude_args` manually? No
  dedup logic proposed. Per-node `claude_args` is a new concept requiring merge
  semantics (append vs override) — scope creep beyond FR-27.

## Justification

**Selected: Variant B** — model as first-class field in InvokeOptions +
buildClaudeArgs.

- **Technical fit:** Resume exclusion centralized in one place (`buildClaudeArgs`)
  — the function already handles resume-conditional logic for
  `--append-system-prompt-file`. Adding `--model` with the same pattern is
  consistent and proven. No array scanning, no implicit caller contracts.
- **Vision alignment:** AGENTS.md states "Engine is domain-agnostic: Engine is a
  generic DAG executor." Variant B keeps model as an explicit, typed field flowing
  through the engine's option interfaces — clean separation. Variant C pollutes
  `claude_args` with semantic config, blurring the line. Variant A's caller-side
  mutation adds domain logic to engine.ts dispatch code.
- **Complexity/maintainability:** Variant B adds ~5 lines to `buildClaudeArgs()`
  and one optional field to 3 interfaces. The contract is explicit (typed field
  vs implicit array convention). Safe default on omission (CLI picks its own
  model). Effort: S. Lowest risk of regression on future call-path additions.

## Task Descriptions

1. **Add model field to PipelineDefaults and NodeConfig** — Add `model?: string`
   to both interfaces in types.ts. No default value (absent = no flag).

2. **Add model to AgentRunOptions/InvokeOptions + buildClaudeArgs** — Add
   `model?: string` to `AgentRunOptions` and `InvokeOptions`. In
   `buildClaudeArgs()`: when `opts.model` is set AND `opts.resumeSessionId` is
   NOT set, emit `["--model", opts.model]`. Resume path inherits original model
   from session.

3. **Resolve effective model in executeAgentNode** — In `engine.ts`
   `executeAgentNode()`: compute `effectiveModel = node.model ??
   this.config.defaults?.model ?? undefined`. Pass as `model` field to
   `runAgent()` call. Same for HITL paths (both initial and resume).

4. **Resolve effective model in loop body** — In `loop.ts` `runLoop()`: for each
   body node invocation, resolve `effectiveModel = bodyNode.model ??
   config.defaults?.model`. Pass to `runAgent()`.

5. **Forward model through HitlRunOptions** — Add `model?: string` to
   `HitlRunOptions`. Forward to `runAgent()` calls in hitl.ts. Resume exclusion
   automatic via `buildClaudeArgs`.

6. **Add pipeline.yaml model config** — Add `model: claude-sonnet-4-6` to
   defaults. Add per-node `model:` overrides for architect (`claude-opus-4-6`),
   tech-lead (`claude-opus-4-6`), meta-agent (`claude-opus-4-6`).

7. **Write tests** — Test `buildClaudeArgs()`: (a) model present + no resume →
   args contain `--model <value>`. (b) model present + resume → args do NOT
   contain `--model`. (c) model absent → args do NOT contain `--model`.
