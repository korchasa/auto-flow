# OpenAI Codex

Docs: github.com/openai/codex, developers.openai.com/codex [^35]

## 1. Built-in Tools

- **Files**: `file_read`, `apply_patch` (first-class in Responses API), `view_image` (feature-gated).
- **System**: Shell tool (PTY-backed execution, feature `shell_tool = true`).
- **Process**: `update_plan` (TODO/plan items). Subagents via `[agents.<name>]` TOML config (built-in: `default`, `explorer`, `worker`).
- **Other**: `web_search` (modes: `cached`/`live`/`disabled`), MCP tools (from configured servers), App/connector tools (from plugins).
- **Note**: No `glob`/`grep` — file search done via shell tool. No dedicated `edit` — uses `apply_patch`. Feature-gated: `js_repl` (experimental), `image_generation` (under dev). [^35]

## 2. Persistent Instructions

`AGENTS.md` (same as OpenCode). Deeper directories override parent. `AGENTS.override.md` at any level replaces `AGENTS.md` at that level. Fallback filenames via `project_doc_fallback_filenames` config key. Global: `~/.codex/AGENTS.md`. Size limit: `project_doc_max_bytes = 32768` (default 32 KiB). Additional: `model_instructions_file` (replaces built-in instructions), `developer_instructions` (inline extra instructions) in `config.toml`. [^35]

## 3. Conditional Instructions

No conditional/path-scoped instructions. Subdir `AGENTS.md` files apply when cwd is within that subdir (directory-level scoping, not glob-based). Execution policy via `.rules` files (Starlark syntax) scopes to command patterns, not file paths. [^35]

## 4. Custom Commands

No file-based commands directory. TUI slash commands are built-in only (`/model`, `/review`, `/permissions`, `/status`, `/fork`, `/clear`, `/exit`, `/copy`, `/plugins`, `/mcp`, `/agent`, `/feedback`). Skills invocable via `$skill-name` syntax. `!<cmd>` runs local shell command. No user-defined custom commands. [^35]

## 5. Event Hooks [^35]

**Config**: `~/.codex/hooks.json` (user), `<repo>/.codex/hooks.json` (project). Feature-gated: `codex_hooks = true` required (stage: "under development").

**Schema** (same nesting as Claude Code):
```json
{ "hooks": { "<Event>": [{ "matchers": ["regex"], "hooks": [{ "type": "command", "command": "script.sh", "statusMessage": "...", "timeoutSec": 600 }] }] } }
```

**Hook types** (3):
- `command` — shell script; JSON via stdin, JSON via stdout.
- `prompt` — LLM evaluation; `$ARGUMENTS` placeholder.
- `agent` — spawns subagent for multi-turn verification.

**Events** (5): `SessionStart`, `PreToolUse` (Bash only currently), `PostToolUse` (Bash only currently), `UserPromptSubmit`, `Stop`.

**stdin JSON fields**: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `turn_id`.

**stdout response**: `{ "continue": true, "stopReason": "...", "systemMessage": "...", "suppressOutput": false }`. `PreToolUse` can block: `"permissionDecision": "deny"` or `"decision": "block"`. `Stop` can continue: `"decision": "block"` + `"reason"`.

**Fail mode**: Fail-open. Multiple matching hooks execute concurrently. Not supported on Windows.

## 6. Skills

`.codex/skills/<name>/SKILL.md` and `.agents/skills/<name>/SKILL.md` (both discovered). User-scope: `~/.codex/skills/<name>/`. Admin/system: `/etc/codex/skills/` + bundled skills at `~/.codex/skills/.system/`. flowai writes to `.codex/skills/`. [^35]

## 7. MCP Integration

`[mcp_servers.<name>]` tables in `config.toml`. Transports: stdio (`command`/`args`/`env`/`cwd`), Streamable HTTP (`url`/`bearer_token_env_var`/`http_headers`/`scopes`). Per-server: `startup_timeout_sec`, `tool_timeout_sec`, `enabled_tools`/`disabled_tools`, `required`. OAuth: `codex mcp login <server>`. CLI: `codex mcp add|remove|list|get|login|logout`. Self as MCP server: `codex mcp-server` (stdio). Plugin-bundled MCP via `.mcp.json` in plugin dir. Per-agent MCP via `mcp_servers` field in agent TOML. [^35]

## 8. Context Ignoring

Sandbox-based exclusion — no dedicated ignore file. `[sandbox_workspace_write]` in `config.toml` controls writable paths. `writable_roots` whitelist, `network_access = false` (default). `.git/` and `.codex/` always read-only in `workspace-write` mode. No `.codexignore` or equivalent. [^35]

## 9. Custom Agents

`[agents.<name>]` TOML tables in `config.toml` (global `~/.codex/config.toml` or project `.codex/config.toml`). Keys: `description` (req), `developer_instructions` (inline prompt) OR `config_file` (path to sidecar TOML with `name`/`description`/`developer_instructions`); optional `nickname_candidates`. Built-in roles: `default`, `explorer`, `worker`. Reference: `approvals_reviewer = "guardian_subagent"`. [^35]

**flowai approach (Branch A)**: each universal agent → sidecar `.codex/agents/<name>.toml` + `[agents.<name>]` registration in `.codex/config.toml` via `config_file`. Merge logic in `cli/src/toml_merge.ts` preserves user-authored tables.

## 10. Permission Modes

Two orthogonal axes: [^35]

**Approval policy** (`-a`): `untrusted` (only trusted cmds auto-run), `on-request` (model decides), `never` (never ask); granular sub-policies (`sandbox_approval`, `rules`, `mcp_elicitations`, `request_permissions`, `skill_approval`).

**Sandbox** (`-s`): `read-only`, `workspace-write` (`.git/`+`.codex/` read-only), `danger-full-access`.

Shortcuts: `--full-auto` = `on-request` + `workspace-write`, `--dangerously-bypass-approvals-and-sandbox` (`--yolo`).

**Execution policy**: `.rules` files (Starlark), decisions: `forbidden`/`prompt`/`allow` (strictest wins).

**OS-native sandbox**: Seatbelt (macOS), Bubblewrap/Landlock (Linux), Restricted token (Windows).

**Smart approvals**: model proposes `prefix_rule` during escalation; `approvals_reviewer = "guardian_subagent"` for routing.

## 11. Plugin Bundles [^35]

**Manifest**: `.codex-plugin/plugin.json` (required: `name`, `version`, `description`; optional: `author`, `homepage`, `repository`, `license`, `keywords`). Component pointers: `skills` (`"./skills/"`), `mcpServers` (`"./.mcp.json"`), `apps` (`"./.app.json"`).

**Bundled components**: Skills, MCP servers (`.mcp.json`), Apps/connectors (`.app.json`), Assets.

**Dir structure**: `skills/`, `.codex-plugin/plugin.json`, `.mcp.json`, `.app.json`, `assets/`.

**UI metadata**: `displayName`, `shortDescription`, `longDescription`, `developerName`, `category`, `capabilities`, `brandColor`, `composerIcon`, `logo`, `screenshots`, `defaultPrompt`, `websiteURL`, `privacyPolicyURL`, `termsOfServiceURL`.

**Distribution**: Official curated Plugin Directory. Marketplace files: `$REPO_ROOT/.agents/plugins/marketplace.json` (repo-scoped), `~/.agents/plugins/marketplace.json` (personal).

**Plugin cache**: `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/`.

**Config**: `[plugins."github@openai-curated"] enabled = true` in `config.toml`. TUI: `/plugins` to browse/install.

## 12. CLI Details

Verified against `codex-cli 0.118.0` (2026-04-11). [^35]

**CLI surface**: Binary: `codex`. Subcommands: `exec`, `review`, `login`, `logout`, `mcp`, `mcp-server`, `app-server`, `app`, `completion`, `sandbox`, `debug`, `apply`, `resume`, `fork`, `cloud`, `features`.

**Non-interactive**: `codex exec [OPTIONS] [PROMPT]`. Flags: `-c key=value`, `--enable/--disable FEATURE`, `-m/--model`, `--oss`, `-s/--sandbox`, `-p/--profile`, `--full-auto`, `--dangerously-bypass-approvals-and-sandbox`, `-C/--cd DIR`, `--skip-git-repo-check`, `--add-dir DIR`, `--ephemeral`, `--output-schema FILE`, `--color`, `--json`, `-o/--output-last-message FILE`.

**Resume**: nested subcommand `codex exec resume [SESSION_ID] [PROMPT] [--last] [--all]`. NOT `codex exec --resume`.

**Approval**: Top-level `codex -a untrusted|on-failure|on-request|never`. `codex exec` only honours `--full-auto` or `--dangerously-bypass-approvals-and-sandbox`.

**Config storage**: TOML (`config.toml`), not JSON/YAML. Paths: `~/.codex/config.toml` (global) or `<repo>/.codex/config.toml` (project). Override: `CODEX_HOME`. Feature flags under `[features]`. Model: `model = "gpt-5.4"`. Reasoning: `model_reasoning_effort = "high"`.

**Memory files**: `AGENTS.md` native. Deeper dirs override parent. Fallback via `project_doc_fallback_filenames`. Size: `project_doc_max_bytes`.

**Model catalog** (2026-04-11): `gpt-5.4` (frontier), `gpt-5.4-mini` (smaller), `gpt-5.3-codex` (Codex-optimized), `gpt-5.2` (long-running agents). Cache: `~/.codex/models_cache.json`.

**flowai tier map**: `max` → `gpt-5.4`, `smart` → `gpt-5.3-codex`, `fast` → `gpt-5.4-mini`, `cheap` → `gpt-5.4-mini`.

## 13. IDE Detection

Env vars: `CODEX_THREAD_ID=<uuid>`, `CODEX_SANDBOX=seatbelt`, `CODEX_SANDBOX_NETWORK_DISABLED=1`, `CODEX_CI=1`, `CODEX_MANAGED_BY_NPM=1`. No `CODEX=1` boolean — detect via presence of `CODEX_THREAD_ID` or `CODEX_SANDBOX` (non-empty). [^35]

## 14. Session Storage [^35]

**Format**: JSONL (`history.jsonl`).

**Scope**: Local sessions + cloud sessions (Codex Cloud/Web).

**Paths**:
- Transcripts: `~/.codex/history.jsonl`
- Session data: `~/.codex/sessions/`
- Auth: `~/.codex/auth.json`
- Agent memories (experimental): `~/.codex/memories/`
- Config home override: `CODEX_HOME` env var

**Resume**: `codex resume` (picker), `codex resume --last`, `codex resume <SESSION_ID>`. `codex fork` to branch a session.

## References

[^35]: https://github.com/openai/codex — OpenAI Codex CLI (Apache-2.0, Rust). npm: `@openai/codex`. Docs: https://developers.openai.com/codex. Verified against codex-cli 0.118.0–0.120.0 (2026-04-12). Config: TOML. Skills: `.codex/skills/`, `.agents/skills/`. Agents: `[agents]` in config.toml + `.toml` sidecar. Hooks: `hooks.json` (feature-gated). Plugins: `.codex-plugin/plugin.json`. MCP: `[mcp_servers]`. Sandbox: Seatbelt/Bubblewrap/Landlock. Execution policy: `.rules` (Starlark). IDE: VS Code extension, desktop app, Codex Web. Enterprise: `requirements.toml` (MDM/cloud-managed).
