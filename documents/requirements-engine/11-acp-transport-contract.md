# SRS Section: ACP Transport Contract

Engine-side rules for what may cross the ACP wire into
`@korchasa/ai-ide-cli`. Index: [requirements-engine.md](../requirements-engine.md).

---

### 3.98 FR-E98: ACP-Unsupported Invoke Options Never Leave the Engine

- **Description:** ACP is the engine's only runtime transport (FR-E77), and
  the ACP wire cannot encode every field of the library's
  `RuntimeInvokeOptions`. The library refuses such an invoke outright with
  `AcpUnsupportedOptionError` rather than dropping the field silently, so a
  single offending field fails the node before the agent runs. The engine
  MUST therefore send none of them.

  **Forbidden set.** Authoritative list:
  `ACP_UNSUPPORTED_INVOKE_OPTIONS` exported by
  `@korchasa/ai-ide-cli` — currently `agent`, `systemPromptFile`,
  `extraArgs`, `strictMcpConfig`, `streamStallTimeoutSeconds`,
  `streamLogPath`, `verbosity`, `onOutput`. Detection is presence-based:
  any value other than `undefined`/`null` counts, the sole exception being
  an `extraArgs` map with zero entries. The engine MUST read the list from
  the library rather than restate it, so an upstream addition surfaces as a
  test failure.

  **Two classes, two treatments.** A forbidden field either duplicates
  something the engine owns locally, or carries workflow intent the wire
  cannot express. The engine handles the two differently:

  - *Engine-owned.* `verbosity` and `onOutput` describe terminal output,
    which the engine's own `OutputManager` already governs. The engine
    stops sending them and loses nothing. Live per-node output is instead
    derived from the ACP event stream the engine already subscribes to
    (`onEvent`, FR-E18/FR-E20), formatted once per event and fanned out to
    both `stream.log` and the terminal so the two never disagree.
  - *Workflow intent.* A node's `agent:` key and a non-empty resolved
    `runtime_args` (including the `--max-turns` that `budget.max_turns`
    folds in for the claude runtime, FR-E47) are explicit author decisions.
    Silently dropping them would present a budget cap that never fires, so
    the engine MUST refuse the node before any subprocess starts, with
    `error_category: "config_error"` and a message naming the workflow key
    the author wrote — not the library field it maps to.

  **Every call site.** The rule binds all three engine entry points into
  the adapter: the initial agent invoke, every continuation invoke, and the
  HITL resume invoke that delivers a human reply. The HITL path MUST refuse
  before asking the human, not after the answer arrives.

- **Motivation:** Reported from the `ratatoskr` project against engine
  0.9.0: every agent node died on `acp(codex): unsupported option(s):
  verbosity, onOutput`. Both fields are set on every ordinary CLI run —
  `onOutput` whenever an `OutputManager` and node id are present, and
  `verbosity` straight from the CLI flags — so no agent node could run at
  all. The engine's own test suite stayed green because it exercises
  `src/testing/fake-runtime.ts`, which does not enforce the ACP option
  contract.

- **Dep:** FR-E77 (ACP as the sole transport), FR-E18/FR-E20 (the event
  stream the terminal output is now derived from), FR-E47 (`budget.max_turns`
  is the usual source of a non-empty `runtime_args`).

- **Acceptance criteria:**
  - **Tests:** `agent_acp_options_test.ts`, `hitl_test.ts` (FR-E98;
    regression-locked).
  - [x] The forbidden set is read from the library, not restated in engine
    source or tests. Evidence:
    `src/engine/agent_acp_options_test.ts` imports
    `collectUnsupportedOptions` from `@korchasa/ai-ide-cli`.
  - [x] `AgentRunOptions.verbosity` survives as a public field so embedders
    keep compiling, documented as never forwarded. Evidence:
    `src/engine/agent.ts` `AgentRunOptions.verbosity` doc comment.
