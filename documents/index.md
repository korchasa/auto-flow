# Documents Index

## FR

- [FR-E39](requirements-engine/06-distribution-and-housekeeping.md#339-fr-e39-standalone-binary-distribution) — Standalone binary distribution via `deno compile` + GitHub Release assets — [x]
- [FR-E41](requirements-engine/06-distribution-and-housekeeping.md#341-fr-e41-cli-auto-update-and-automated-release-pipeline) — Automated CI release pipeline with conventional-commit version bumping — [x]
- [FR-E43](requirements-engine/02-nodes-and-models.md#343-fr-e43-runtime-fallback-fallback) — Runtime fallback (`defaults.fallback`): switch entire runtime on overload / quota / availability errors — [ ]
- [FR-E68](requirements-engine/05-cli-and-observability.md#368-fr-e68-node-lifecycle-callback-for-embedded-hosts) — Expose node lifecycle callback for embedded hosts — [x]
- [FR-E69](requirements-engine/05-cli-and-observability.md#369-fr-e69-durable-run-journal-replay) — Persist durable run journal for host recovery replay — [x]
- [FR-E70](requirements-engine/06-distribution-and-housekeeping.md#370-fr-e70-claude-code--codex-plugin-distribution) — Claude Code / Codex plugin distribution (plugin-first; downstream `flowai-workflow-plugins` repo) — [x]
- [FR-E71](requirements-engine/06-distribution-and-housekeeping.md#371-fr-e71-codex-plugin-install-path) — Codex plugin install path (Codex-native payload + auto-MCP, no manual `config.toml` patch) — [x]
- [FR-E72](requirements-engine/06-distribution-and-housekeeping.md#372-fr-e72-cross-repo-plugin-payload-sync) — Cross-repo plugin payload sync from engine repo to `korchasa/flowai-workflow-plugins` — [x]
- [FR-E73](requirements-engine/07-mcp-and-plugin-runtime.md#373-fr-e73-embedded-mcp-server-over-engine) — Embedded MCP server over engine (7 tools, MCP SDK) — [ ]
- [FR-E74](requirements-engine/07-mcp-and-plugin-runtime.md#374-fr-e74-plugin-self-contained-runtime-lazy-compile--auto-mcp) — Plugin self-contained runtime: lazy-compile binary + auto-MCP registration — superseded by FR-E78
- [FR-E77](requirements-engine/04-runtime-and-hooks.md#377-fr-e77-transport-selection-cli-vs-acp) — Transport Selection (CLI vs ACP) via `defaults.transport` / `node.transport` cascade — [x]
- [FR-E78](requirements-engine/07-mcp-and-plugin-runtime.md#378-fr-e78-plugin-precondition--release-binary-distribution) — Plugin precondition + release binary distribution (supersedes FR-E74 launcher) — [ ]
- [FR-E80](requirements-engine/05-cli-and-observability.md#380-fr-e80-cumulative-wall-clock-retry-cap) — Cumulative wall-clock retry cap per node via AbortSignal pass-through — [x]
- [FR-E9](requirements-engine/01-execution-model.md#39-fr-e9-run-artifacts-folder-structure) — Run artifacts live under the selected workflow run directory — [x]
