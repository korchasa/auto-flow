# Cursor

Docs: docs.cursor.com [^1]

## 1. Built-in Tools

- **Files**: `Read`, `Write`, `StrReplace`, `Delete`, `Glob`, `Grep`, `SemanticSearch`, `ReadLints`, `EditNotebook`.
- **System**: `Shell` (git, deno, etc.).
- **Process**: `TodoWrite`, `Task` (subagents).
- **Other**: `WebSearch`, `WebFetch`, `list_mcp_resources`, `fetch_mcp_resource`.
- **GUI-only** (not in headless/CLI): `SwitchMode` (Plan), `AskQuestion`, `generate_image`. [^1] [^34]

## 2. Persistent Instructions

`AGENTS.md` (root/subdir), `.cursor/rules/` (`alwaysApply: true`). [^21]

## 3. Conditional Instructions

`.cursor/rules/*.md` (`globs`, `description`). [^21]

## 4. Custom Commands

`.cursor/commands/*.md`. Arguments passed in free form. [^1]

## 5. Event Hooks [^14]

**Config**: `.cursor/hooks.json` (project), `~/.cursor/hooks.json` (user), enterprise MDM paths.

**Schema**:
```json
{ "version": 1, "hooks": { "<event>": [{ "command": "script.sh", "type": "command"|"prompt", "timeout": 30, "matcher": "regex" }] } }
```

**Hook types** (2):
- `command` — shell script; JSON via stdin, JSON via stdout. Exit 0 = ok, exit 2 = block.
- `prompt` — LLM evaluation; `$ARGUMENTS` placeholder. Returns `{ ok, reason }`.

**Events** (20):
- Agent (18): `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `subagentStart`, `subagentStop`, `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution` (fail-closed), `afterMCPExecution`, `beforeReadFile` (fail-closed), `afterFileEdit`, `beforeSubmitPrompt`, `preCompact`, `stop`, `afterAgentResponse`, `afterAgentThought`.
- Tab (2): `beforeTabFileRead`, `afterTabFileEdit`.

**Matcher**: Regex on tool name (`Shell|Read|Write`), subagent type, or command string.

**Env vars**: `CURSOR_PROJECT_DIR`, `CURSOR_VERSION`, `CURSOR_USER_EMAIL`, `CLAUDE_PROJECT_DIR` (compat).

**Fail mode**: Fail-open, except `beforeMCPExecution` and `beforeReadFile` (fail-closed).

## 6. Skills

`.cursor/skills/<name>/SKILL.md`; also `.claude/skills/`, `.codex/skills/` (compat). [^10]

## 7. MCP Integration

`.cursor/mcp.json` (project/user). Transports: stdio, SSE, Streamable HTTP. OAuth. Config interpolation (`${env:NAME}`, `${workspaceFolder}`). MCP Marketplace (one-click install). [^1]

## 8. Context Ignoring

`.cursorignore` — additive on top of `.gitignore`; negation `!pattern` un-ignores gitignored files. [^16]

## 9. Custom Agents

`~/.cursor/agents/*.md`, `.cursor/agents/*.md`. [^1]

## 10. Permission Modes

Accept/reject per-tool. No named modes. `.cursor/rules/` can restrict tool use. [^1]

## 11. Plugin Bundles [^26]

**Manifest**: `.cursor-plugin/plugin.json` (required: `name`; optional: `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `logo`).

**Bundled components**: Rules (`.mdc`), Skills (`SKILL.md`), Agents, Commands, MCP servers, Hooks.

**Dir structure**: `rules/`, `skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `.mcp.json`, `assets/`, `scripts/`. Auto-discovery from default dirs when manifest paths omitted.

**Distribution**: Git repos. Official Cursor Marketplace (manual security review). Team/Enterprise private marketplaces (1 for Teams, unlimited Enterprise). Multi-plugin repos via `.cursor-plugin/marketplace.json`.

**Local testing**: `~/.cursor/plugins/local/`.

**VSCode extensions**: Via Open VSX registry (NOT Microsoft Marketplace — blocked for forks).

## 12. IDE Detection

Env vars: `CURSOR_AGENT=1` + `CURSOR_INVOKED_AS=cursor-agent`.

**Important**: Cursor Agent (CLI) built on Claude Agent SDK. Sets BOTH `CURSOR_AGENT=1` AND `CLAUDECODE=1` + `CLAUDE_AGENT_SDK_VERSION`, `CLAUDE_CODE_ENTRYPOINT=claude-vscode`, `CLAUDE_CODE_EXECPATH`. Detection MUST check `CURSOR_AGENT` before `CLAUDECODE` to distinguish. [^34]

## 13. Session Storage [^28] [^34]

**Format (GUI)**: SQLite (`state.vscdb`, schema `ItemTable(key TEXT, value TEXT)` with JSON blobs).

**Format (CLI agent)**: SQLite per-chat: `~/.cursor/chats/<workspace-hash>/<chat-uuid>/store.db`. Schema: `blobs(id TEXT PK, data BLOB)` (compressed binary), `meta(key TEXT PK, value TEXT)` (hex-encoded JSON: `agentId`, `name`, `mode`, `createdAt`).

**Scope**: Per-workspace (GUI SQLite) + per-chat (CLI agent SQLite) + per-project (agent transcripts).

**Paths**:
- GUI macOS: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`, `~/Library/Application Support/Cursor/User/workspaceStorage/<hash>/state.vscdb`
- GUI Linux: `~/.config/Cursor/User/globalStorage/state.vscdb`, `~/.config/Cursor/User/workspaceStorage/<hash>/state.vscdb`
- GUI Windows: `%APPDATA%\Cursor\User\globalStorage\state.vscdb`, `%APPDATA%\Cursor\User\workspaceStorage\<hash>\state.vscdb`
- CLI agent: `~/.cursor/chats/<hash>/<uuid>/store.db`
- Agent transcripts: `~/.cursor/projects/{project_name}/agent-transcripts/`
- CLI config: `~/.cursor/cli-config.json` (auth, permissions, model, sandbox)
- CLI worktrees: `~/.cursor/worktrees/<reponame>/<name>/`

**SQLite keys (GUI)**: `composer.composerData` (current), migrated from `aichat` keys.

## References

[^1]: https://docs.cursor.com/
[^10]: https://cursor.com/docs/context/skills
[^14]: https://cursor.com/docs/agent/hooks
[^16]: https://docs.cursor.com/en/context/ignore-files
[^21]: https://docs.cursor.com/en/context/rules
[^26]: https://cursor.com/docs/plugins
[^28]: https://dasarpai.com/dsblog/cursor-chat-architecture-data-flow-storage/
[^34]: Cursor Agent CLI verification (v2026.03.20). Env vars: `CURSOR_AGENT=1`, `CURSOR_INVOKED_AS=cursor-agent`, `CLAUDECODE=1`, `CLAUDE_AGENT_SDK_VERSION=0.2.92`, `CLAUDE_CODE_ENTRYPOINT=claude-vscode`. Chat storage: `~/.cursor/chats/<hash>/<uuid>/store.db`. Auth: Keychain (GUI), `~/.cursor/cli-config.json` (CLI).
