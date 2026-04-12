# Cursor → Claude Code Conversion

## 1. Project Rules

`AGENTS.md` → `CLAUDE.md` (rename). Subdir rules: `subdir/AGENTS.md` → `subdir/CLAUDE.md`. [^21] [^2]

## 2. Conditional Rules

Path: `.cursor/rules/*.md` → `.claude/rules/*.md` [^21] [^22]

Frontmatter transform:

- `alwaysApply: true` → Remove frontmatter (rules without `paths` load unconditionally)
- `globs: [...]` → `paths: [...]` (YAML array, single value, CSV all work; v2.1.91 verified [^32])
- `alwaysApply: false` + `description` only → No equivalent — becomes always-apply (Claude Code has no agent-discovery scoping)
- No frontmatter (manual, `@rule-name`) → No direct equivalent

**Verified behavior** (v2.1.91, 2026-04-04) [^32]:
- All `paths:` syntax variants work: YAML array quoted/unquoted, single value quoted/unquoted, CSV.
- `paths:` triggers on `Read` only. `Write`/`Edit` to matching path does NOT load the rule.
- Cursor `globs:` field silently ignored in Claude Code (unknown frontmatter → no `paths:` → always-apply).
- Nested rules (`.claude/rules/subdir/*.md`) discovered and scoped correctly.

## 3. Custom Commands

`.cursor/commands/*.md` → `.claude/commands/*.md` — copy as-is. [^2]

`$ARGUMENTS` placeholder works the same. Claude Code adds optional frontmatter: `allowed-tools`, `model`, `description`, `argument-hint`, `disable-model-invocation`.

Note: Claude Code also supports skill-commands with `disable-model-invocation: true` in SKILL.md frontmatter.

## 4. Skills (SKILL.md)

`.cursor/skills/<name>/` → `.claude/skills/<name>/` — copy entire directory. [^10] [^11]

Format identical (Agent Skills open standard). Supporting files, scripts, references travel unchanged.

## 5. Custom Agents

`.cursor/agents/*.md` → `.claude/agents/*.md` [^23]

Frontmatter transform:

- `name` → `name` (unchanged)
- `description` → `description` (unchanged)
- `model: inherit` → `model: inherit` (unchanged)
- `model: fast` → `model: haiku` (Cursor "fast" = haiku-class)
- `readonly: true` → `disallowedTools: Write, Edit, NotebookEdit` or `permissionMode: plan`

Claude Code additional fields: `tools`, `disallowedTools`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory` (`user`/`project`/`local`), `effort`, `isolation` (`worktree`), `omitClaudeMd`, `initialPrompt`, `background`, `color`. Agents support nesting.

## 6. Hooks

`.cursor/hooks.json` → `hooks` key inside `.claude/settings.json` [^14] [^24]

**Structure transform:**

```
# Cursor (flat: event → array of hooks)
{ "version": 1, "hooks": { "eventName": [{ "command": "script.sh", "matcher": "regex" }] } }

# Claude Code (nested: event → matchers → hooks array)
{ "hooks": { "EventName": [{ "matcher": "regex", "hooks": [{ "type": "command", "command": "script.sh" }] }] } }
```

**Event name mapping:**

- `beforeShellExecution` → `PreToolUse` (matcher `"Bash"`)
- `afterShellExecution` → `PostToolUse` (matcher `"Bash"`)
- `preToolUse` → `PreToolUse`
- `postToolUse` → `PostToolUse`
- `postToolUseFailure` → `PostToolUseFailure`
- `sessionStart` → `SessionStart`
- `sessionEnd` → `SessionEnd`
- `subagentStart` → `SubagentStart`
- `subagentStop` → `SubagentStop`
- `stop` → `Stop`
- `preCompact` → `PreCompact`
- `afterFileEdit` → `PostToolUse` (matcher `"Edit|Write"`)
- `beforeSubmitPrompt` → `UserPromptSubmit`
- `beforeMCPExecution` → `PreToolUse` (matcher `"mcp__.*"`)
- `afterMCPExecution` → `PostToolUse` (matcher `"mcp__.*"`)
- `beforeReadFile` → `PreToolUse` (matcher `"Read"`)
- `afterAgentResponse` → no equivalent
- `afterAgentThought` → no equivalent
- `beforeTabFileRead` → no equivalent (tab-only)
- `afterTabFileEdit` → no equivalent (tab-only)

Claude Code events without Cursor equivalent: `PermissionRequest`, `PermissionDenied`, `Notification`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `Setup`, `CwdChanged`, `FileChanged`.

**Hook type mapping:**

- `command` → `command` (same semantics; exit 0/2 identical)
- `prompt` → `prompt` (both use `$ARGUMENTS`)
- — → `http` (Cursor lacks)
- — → `agent` (Cursor lacks)

**Hook response mapping:**

- `{ "decision": "allow" }` → `exit 0`
- `{ "decision": "deny" }` → `exit 2` + message to stderr
- `{ "decision": "ask" }` → `hookSpecificOutput.permissionDecision: "ask"`
- `{ "updated_input": {...} }` → `hookSpecificOutput.updatedInput: {...}`

Claude Code extra response fields: `hookSpecificOutput.additionalContext`, `hookSpecificOutput.initialUserMessage` (SessionStart), `hookSpecificOutput.watchPaths` (SessionStart), `hookSpecificOutput.updatedMCPToolOutput` (PostToolUse).

**Exit code semantics (Claude Code):**
- 0 = success: stdout shown to model
- 2 = blocking: stderr to model, prevents tool execution
- Other = non-blocking error: stderr to user only, continues

**Env var mapping:**

- `CURSOR_PROJECT_DIR` → `CLAUDE_PROJECT_DIR`
- `CURSOR_VERSION` → no equivalent
- `CURSOR_USER_EMAIL` → no equivalent
- — → `CLAUDE_PLUGIN_ROOT`
- — → `CLAUDE_PLUGIN_DATA`
- — → `CLAUDE_PLUGIN_OPTION_*` (plugin user config)
- — → `CLAUDE_ENV_FILE` (SessionStart/Setup/CwdChanged/FileChanged only)

Script paths: `.cursor/hooks/` → `.claude/hooks/`.

## 7. MCP Config

`mcp.json` → `.mcp.json` — rename (format identical). [^15]

## 8. Context Ignoring

`.cursorignore` — **no direct equivalent** in Claude Code. [^16] [^15]

Claude Code respects `.gitignore` by default (`respectGitignore: true`). Migration options:
- Exclusion patterns → add to `.gitignore` or `permissions.deny` in `.claude/settings.json`.
- Negation patterns (`!pattern`) → set `"respectGitignore": false` (global effect).

## References

[^2]: https://code.claude.com/docs
[^10]: https://cursor.com/docs/context/skills
[^11]: https://code.claude.com/docs/en/skills
[^14]: https://cursor.com/docs/agent/hooks
[^15]: https://code.claude.com/docs/en/settings
[^16]: https://docs.cursor.com/en/context/ignore-files
[^21]: https://docs.cursor.com/en/context/rules
[^22]: https://code.claude.com/docs/en/memory
[^23]: https://code.claude.com/docs/en/sub-agents
[^24]: https://code.claude.com/docs/en/hooks
[^32]: Empirical verification of `paths:` behavior (v2.1.91, 2026-04-04).
