# Claude Code

Docs: code.claude.com/docs [^2]

## 1. Built-in Tools

- **Files**: `Read` (img/PDF/NB), `Write`, `Edit`, `Glob`, `Grep`, `NotebookEdit`.
- **System**: `Bash` (CWD persists between commands, shell state — env vars, aliases — does not), `PowerShell` (Windows).
- **Process**: `EnterPlanMode`/`ExitPlanMode`, `TaskCreate`/`Get`/`Update`/`List`, `Agent` (subagents), `TaskOutput`/`TaskStop`, `SendMessage`/`ListPeers` (multi-agent), `EnterWorktree`/`ExitWorktree`.
- **Scheduling**: `CronCreate`/`CronDelete`/`CronList`, `RemoteTrigger`.
- **Context**: `TodoWrite`, `ToolSearch` (deferred tool loading), `ListMcpResources`/`ReadMcpResource`, `Snip`.
- **Other**: `AskUserQuestion`, `WebSearch`, `WebFetch`, `Skill`, `PushNotification`, `SubscribePR`, `TerminalCapture`. [^11] [^33]
- **Note**: 19 always-present + 30+ feature-gated = ~49 total tools. Many conditional on feature flags (GrowthBook).

## 2. Persistent Instructions

`CLAUDE.md` (root/subdir), `.claude/CLAUDE.md`, `~/.claude/CLAUDE.md` (global), `CLAUDE.local.md` (gitignored, project-local), managed paths (`/etc/claude-code/CLAUDE.md`, MDM plist/registry). `@include` directive (max 5 levels). 40K char/file limit. `omitClaudeMd` agent flag to skip hierarchy. [^2] [^33]

## 3. Conditional Instructions

`.claude/rules/*.md` (`paths`). Triggers on `Read` only (not `Write`/`Edit`). `globs:` field silently ignored. `description:` alone does not scope (becomes always-apply). Subdirectory rules (`.claude/rules/subdir/*.md`) discovered recursively. Limits: 200 lines / 4 KB per file, ~5 files per turn (~20 KB aggregate). Truncated files include note to use Read tool. [^2] [^32] [^33]

## 4. Custom Commands

`.claude/commands/*.md`, `.claude/commands/<namespace>/*.md` (merged into skill loader). Supports `$0`–`$N` positional args. Shell execution in prompt: `` !`command` `` (inline), ` ```! block ``` ` (multi-line; disabled for MCP skills). `${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}` placeholders. [^2] [^33]

Full frontmatter: `name`, `description`, `argument-hint`, `when_to_use`, `allowed-tools` (permission rule syntax), `model` (`sonnet`/`opus`/`haiku`/`inherit`), `effort` (`low`/`medium`/`high`/`max` or integer), `context` (`inline`/`fork`), `agent` (agent type for fork), `paths` (conditional activation), `hooks`, `shell` (`bash`/`powershell`), `type` (`user`/`feedback`/`project`/`reference`), `disable-model-invocation`, `user-invocable`, `hide-from-slash-command-tool`, `version`.

## 5. Event Hooks [^24]

**Config**: `.claude/settings.json` (`hooks` key), `~/.claude/settings.json` (global), `.claude/settings.local.json`, managed policy, skill/agent frontmatter.

**Schema** (3 nesting levels):
```json
{ "hooks": { "<Event>": [{ "matcher": "regex", "hooks": [{ "type": "command", "command": "script.sh", "timeout": 600, "statusMessage": "...", "async": false }] }] } }
```

**Hook types** (4 persisted + 1 runtime):
- `command` — shell script; stdin JSON, exit 0/2. `async: true` for background.
- `http` — POST to URL; `headers` with `$VAR` interpolation, `allowedEnvVars`.
- `prompt` — single-turn LLM evaluation; `$ARGUMENTS` placeholder. Returns `{ ok, reason }`.
- `agent` — spawns subagent with tools (Read, Grep, Glob); multi-turn verification.
- `function` — runtime-only JS callback (not persisted, not user-configurable).

Note: `prompt`/`agent` only on: `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `PreToolUse`, `Stop`, `SubagentStop`, `TaskCompleted`, `UserPromptSubmit`. Others: `command` only.

**Hook features**: `async: true` (fire-and-forget), `asyncRewake: true` (background + wake model on exit 2), `once: true` (remove after first run), `if: "Tool(pattern)"` (conditional filter via permission rule syntax), `timeout` (seconds, default 10 min), `statusMessage` (custom spinner text).

**Events** (27): `SessionStart`, `SessionEnd`, `InstructionsLoaded`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`, `Notification`, `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, `Setup`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `PreCompact`, `PostCompact`, `Elicitation`, `ElicitationResult`, `CwdChanged`, `FileChanged`. [^33]

**Matcher**: Regex on tool name (`Bash`, `Edit|Write`, `mcp__.*`), session source, notification type, agent type, compaction trigger, config source. Some events have no matcher (`UserPromptSubmit`, `Stop`, etc.).

**Decision control**:
- `PreToolUse`: `hookSpecificOutput.permissionDecision` (allow/deny/ask), `updatedInput`.
- `PermissionRequest`: `hookSpecificOutput.decision.behavior` (allow/deny), `updatedInput`.
- Others: top-level `decision: "block"` + `reason`, or exit 2 + stderr.

**Exit codes**: 0 = success (stdout to model), 2 = blocking (stderr to model), other = non-blocking error (stderr to user only).

**Env vars**: `$CLAUDE_PROJECT_DIR`, `$CLAUDE_PLUGIN_ROOT`, `$CLAUDE_ENV_FILE` (SessionStart only).

**Fail mode**: Fail-open. Exit 2 = blocking error (stderr fed to Claude).

## 6. Skills

`~/.claude/skills/`, `.claude/skills/` (project), managed/policy path (`${getManagedFilePath()}/.claude/skills/`). Also loads `.claude/commands/` (merged into skill loader). Conditional activation via `paths:` frontmatter (gitignore-style). Skill listing budget: 1% of context window, 250 char/skill cap. [^11] [^33]

## 7. MCP Integration

`.mcp.json` (project), `~/.claude.json` (user/local), `managed-mcp.json` (org). Config scopes: local, user, project, dynamic, enterprise, claudeai, managed. Transports: HTTP (recommended), SSE (deprecated), stdio, ws, sse-ide, ws-ide, sdk, claudeai-proxy. OAuth 2.0. Tool Search (auto >10% context). `claude mcp serve` (self as MCP server). Channels (push messages). Plugins can bundle MCP servers. Per-agent MCP via `mcpServers` field. [^15] [^33]

## 8. Context Ignoring

No dedicated ignore file. `.gitignore` respected by default (`respectGitignore: true`). Options:
- Exclusion patterns → `permissions.deny: ["Read(path)"]` in `settings.json`.
- Set `"respectGitignore": false` to surface gitignored files (global effect). [^15]

## 9. Custom Agents

`.claude/agents/*.md` (project), `~/.claude/agents/*.md` (user). [^23] [^33]

Built-in (6, dynamically gated): `general-purpose` (always), `statusline-setup` (always), `Explore` (Haiku, read-only, `omitClaudeMd`; gated), `Plan` (inherit, read-only, `omitClaudeMd`; gated), `claude-code-guide` (non-SDK only), `verification` (feature-flagged).

Frontmatter: `tools`, `disallowedTools`, `model` (`sonnet`/`opus`/`haiku`/`inherit`), `effort` (integer or `low`/`medium`/`high`/`max`), `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory` (`user`/`project`/`local`), `background`, `isolation` (`worktree`/`remote`), `omitClaudeMd`, `initialPrompt`, `color`. Agents CAN nest (subagent spawns subagents).

## 10. Permission Modes

Named modes: `default` (ask outside CWD), `plan` (read-only), `acceptEdits` (auto-accept file edits), `bypassPermissions` (auto-approve all), `auto` (ML classifier, feature-gated). Per-agent override via `permissionMode` frontmatter. Permission rules syntax: `Tool(pattern)` (e.g. `Bash(git *)`, `Write(*.ts)`). Dangerous pattern detection strips interpreter/shell allow-rules at auto-mode entry (`dangerousPatterns.ts`); dangerous command detection via yolo classifier (`rm -rf`, `git reset --hard`, etc.). [^33]

## 11. Plugin Bundles [^27]

**Manifest**: `.claude-plugin/plugin.json` (`name`, `description`, `version`, `author`, `homepage`, `repository`, `license`).

**Bundled components**: Skills, Agents, Commands, Hooks (`hooks/hooks.json`), MCP servers (`.mcp.json`), LSP servers (`.lsp.json`), Settings (`settings.json` — currently only `agent` key).

**Namespacing**: `/plugin-name:skill-name` prevents conflicts.

**Distribution**: Official Anthropic Marketplace (~101 plugins, ~33 Anthropic-built, as of 2026-03). Submission via `claude.ai/settings/plugins/submit` or `platform.claude.com/plugins/submit`.

**Local testing**: `--plugin-dir ./my-plugin`. Hot reload: `/reload-plugins`.

**Security**: Plugin subagents cannot use `hooks`, `mcpServers`, or `permissionMode` frontmatter fields.

**Env vars**: `$CLAUDE_PLUGIN_ROOT` (plugin dir), `${CLAUDE_PLUGIN_DATA}` (persistent data dir).

## 12. Execution Mode Differences

`--agent` flag behaves differently in headless (`-p`) vs interactive (REPL) modes: [^33]

- **systemPrompt**: Agent body replaces ~17 default sections — both modes.
- **systemContext** (git status): **skipped** in headless `-p` + `--agent`; present in interactive.
- **userContext** (CLAUDE.md + date): both modes.
- **tools** (schemas + descriptions): both modes.

**Implications**:
- Headless agents don't see git status — must read explicitly if needed.
- Agent body **replaces** all default prompt sections (safety, tone, tools usage rules). Authors must include own instructions.
- `--agent` requires registered name (from `.claude/agents/`), not file path. File paths silently fall through to default mode.
- `--append-system-prompt` always appended regardless of mode.

**Deferred tools (ToolSearch)**: Tools with `shouldDefer: true` not in system prompt. Model requests schema via `ToolSearch` on demand. Saves ~10% context. Always-loaded tools use `alwaysLoad: true`.

**Fork subagent**: When `subagent_type` omitted in Agent tool call, fork mode activates — inherits full parent context with prompt cache optimization (`FORK_PLACEHOLDER_RESULT`). Different from isolated subagent.

## 13. IDE Detection

Env var: `CLAUDECODE=1`.

Detection order: check `CURSOR_AGENT` first (Cursor Agent sets both `CURSOR_AGENT=1` AND `CLAUDECODE=1`), then `CLAUDECODE`.

## 14. Session Storage [^30]

**Format**: JSONL (one JSON object per line per message).

**Scope**: Per-project + global index.

**Paths** (Unix notation):
- Global index: `~/.claude/history.jsonl` (prompt text, timestamp, project path, session ID per line)
- Per-project: `~/.claude/projects/{project-path-with-dashes}/` — `.jsonl` session files + `sessions-index.json`

## References

[^2]: https://code.claude.com/docs
[^11]: https://code.claude.com/docs/en/skills; Bash tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/bash-tool
[^15]: https://code.claude.com/docs/en/settings
[^22]: https://code.claude.com/docs/en/memory
[^23]: https://code.claude.com/docs/en/sub-agents
[^24]: https://code.claude.com/docs/en/hooks
[^27]: https://code.claude.com/docs/en/plugins
[^30]: https://kentgigger.com/posts/claude-code-conversation-history
[^32]: Empirical verification of `paths:` behavior (v2.1.91, 2026-04-04). 12 test cases: all syntax variants work; Read-only trigger; `globs:` silently ignored; nested rules discovered.
[^33]: Claude Code CLI experiments.
