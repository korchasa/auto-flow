---
date: "2026-06-21"
status: done
---
# Harden Codex install-acceptance against LLM-gate flakiness (variants 3+4+5)

Scope: sdlc (CI + acceptance script). Follow-up to investigate report on CI
failure of commit 886b04e.

## Goal

Stop the flaky live-agent acceptance step from blocking releases and make its
failures diagnosable, while keeping the deterministic install + MCP probe as
the hard release gate.

## Overview

### Context

`scripts/plugin-install-acceptance.ts` runs, per host: (1) build payload,
(2) install plugin, (3) deterministic MCP probe (initialize + tools/list),
(4) live host agent that must call `get_workflow` and echo
`FLOWAI_INSTALL_ACCEPTANCE_PASS`. Step 4 depends on an external LLM
(`openai/gpt-4.1` via OpenRouter) and flakes: the model sometimes does a
resource-read instead of a tool call, or paraphrases the marker. The whole job
is in `release.needs`, so an LLM coin-flip blocks distribution; `reportOutput:
false` hides the raw agent output, so failures are opaque.

### Current State

- `assertAgentEvidence` (3 hard requirements: exit 0, exact marker string,
  `hasInstalledPluginToolEvidence`).
- No way to make the agent step non-fatal; CLI has no flag.
- CI `plugin-install-acceptance-codex` env `CODEX_INSTALL_ACCEPTANCE_MODEL:
  openai/gpt-4.1`; both acceptance jobs in `release.needs`.
- `HostInstallResult.status` is the literal `"passed"`.

### Constraints

- Keep deterministic install + MCP probe as a HARD gate (must still throw).
- `ci_yaml_test.ts` only checks the release-create step — safe to edit envs.
- Existing test "codex command execution is not MCP tool evidence" must keep
  passing (no tool evidence ⇒ reject).

## Definition of Done

- [x] V5: `assertAgentEvidence` accepts a completed `get_workflow` tool call as
  the authoritative signal; the exact marker echo is no longer required. On the
  no-tool-evidence failure path it includes a truncated raw agent-output dump.
- [x] V3: `InstallAcceptanceOptions.agentEvidenceOptional` + CLI
  `--agent-evidence-optional`; when set, a failed `assertAgentEvidence` is
  reported as a non-blocking warning and the host status becomes
  `"agent-evidence-skipped"` (run does not throw). Install + MCP probe stay
  fatal.
- [x] V4: CI codex env model → `openai/gpt-5-mini`.
- [x] V3 wiring: both acceptance CI steps pass `--agent-evidence-optional`.
- [x] Tests cover: relaxed marker pass, non-blocking skip path, arg parsing.
- [x] `deno task check` exits 0.

## Solution

1. RED — add tests in `scripts/plugin-install-acceptance_test.ts`:
   - tool-call evidence present + NO marker line ⇒ `status === "passed"`.
   - no tool evidence + `agentEvidenceOptional: true` ⇒ resolves,
     `status === "agent-evidence-skipped"`, evidence has a non-blocking warning.
   - `parseInstallAcceptanceArgs(["--agent-evidence-optional"])` sets the flag.
2. GREEN — code:
   - `assertAgentEvidence`: drop the hard marker check; require
     `hasInstalledPluginToolEvidence`; on failure append
     `truncateTail(combined, RAW_DUMP_LIMIT)`.
   - `InstallAcceptanceOptions.agentEvidenceOptional?: boolean`; thread to
     `runHostInstallAcceptance`; wrap `assertAgentEvidence` in try/catch →
     non-blocking warning + `{...installed, status: "agent-evidence-skipped"}`.
   - widen `HostInstallResult.status` to
     `"passed" | "agent-evidence-skipped"`.
   - CLI: parse `--agent-evidence-optional` → `agentEvidenceOptional`.
3. CI — `.github/workflows/ci.yml`:
   - codex env `CODEX_INSTALL_ACCEPTANCE_MODEL: openai/gpt-5-mini`.
   - both acceptance run steps add `--agent-evidence-optional`.
4. CHECK — `deno task check` exits 0.
</content>
