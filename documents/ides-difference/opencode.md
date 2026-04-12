# OpenCode

Docs: opencode.ai/docs [^3]

## 1. Built-in Tools

- **Files**: `read`, `glob`, `grep`, `list`, `edit`, `write`, `patch`, `multiedit`.
- **System**: `bash`.
- **Process**: `todowrite`, `todoread`, `task` (subagents), `skill`, `parallel`.
- **Other**: `question`, `webfetch`, `websearch` (when `OPENCODE_ENABLE_EXA=1`), `lsp` (experimental). [^8]

## 2. Persistent Instructions

`AGENTS.md` > `CLAUDE.md`. `opencode.json` (`instructions`). [^3]

## 3. Conditional Instructions

`opencode.json` (`instructions` with globs). [^3]

## 4. Custom Commands

`.opencode/commands/*.md`. Supports `$ARGUMENTS`, `$1`–`$N`, `` !`shell` ``, `@filepath`. Frontmatter: `description`, `agent`, `model`, `subtask` (boolean). [^3]

## 5. Plugins (Event Hooks) [^3]

**Config**: `.opencode/plugins/*.{js,ts}` (project), `~/.config/opencode/plugins/` (global), npm packages in `opencode.json` (`"plugin": ["pkg-name"]`).

**Format**: JS/TS modules exporting async plugin functions. TypeScript: `import type { Plugin } from "@opencode-ai/plugin"`.

```typescript
export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => { /* mutate output */ },
    event: async ({ event }) => { /* handle event.type */ },
    tool: { mytool: tool({ description: "...", args: { ... }, execute(args, ctx) { ... } }) },
  }
}
```

**Hook types**: Programmatic (code-based). No declarative JSON config.
- Event handlers: `event: async ({ event }) => {}` — check `event.type`.
- Tool hooks: `tool.execute.before` / `tool.execute.after` — `(input, output)` signature; mutate `output.args`, `throw` to block.
- Shell hooks: `shell.env` — inject env vars via `output.env`.
- Custom tools: `tool` key with `tool()` helper from `@opencode-ai/plugin`.
- Compaction: `experimental.session.compacting` — inject context or replace prompt.

**Events** (30+): `command.executed`, `file.edited`, `file.watcher.updated`, `installation.updated`, `lsp.client.diagnostics`, `lsp.updated`, `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated`, `permission.asked`, `permission.replied`, `server.connected`, `session.created`, `session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated`, `todo.updated`, `shell.env`, `tool.execute.after`, `tool.execute.before`, `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`, `experimental.session.compacting`.

**Blocking**: `throw new Error("message")` in `tool.execute.before`.

**Dependencies**: `package.json` in config dir; `bun install` at startup.

**Custom tools**: Override built-in tools by using same name.

## 6. Skills

`.opencode/skills/` (fallbacks: `.claude/skills/`, `.agents/skills/`). Frontmatter: `name`, `description` (required); `license`, `compatibility`, `metadata` (optional). Name regex: `^[a-z0-9]+(-[a-z0-9]+)*$`, 1–64 chars, must match dir name. [^12]

## 7. MCP Integration

`opencode.jsonc` (`mcp` field). Types: local (command) and remote (URL). OAuth (RFC 7591). Glob-based tool permissions. CLI: `opencode mcp auth|list|logout|debug`. [^3]

## 8. Context Ignoring

`.gitignore`, `.ignore`, `opencode.json` (`watcher.ignore`). [^3]

## 9. Custom Agents

`~/.config/opencode/agents/*.md`, `.opencode/agents/*.md`. Frontmatter: `description`, `mode` (`primary`/`subagent`/`all`), `model`, `temperature`, `top_p`, `steps`, `tools`, `permission`, `color`, `hidden`, `disable`. [^3]

## 10. Permission Modes

`permission` field in agent frontmatter (`auto`/`ask`/`deny`). No permission rule syntax. [^3]

## 11. Custom Tools

`.opencode/tools/*.{ts,js}` (project), `~/.config/opencode/tools/` (user). Uses `tool()` from `@opencode-ai/plugin`. Filename = tool name. Multiple exports create `<filename>_<exportname>`. Can override built-in tools by using same name. [^3]

## 12. Plugin Bundles [^3]

**No manifest/bundle format**. Plugins are JS/TS code modules, not declarative packages.

**Distribution**: npm packages in `opencode.jsonc` (`"plugin": ["pkg-name"]`). Auto-installed via Bun to `~/.cache/opencode/node_modules/`.

**Local plugins**: `.opencode/plugins/*.{js,ts}` (project) or `~/.config/opencode/plugins/` (global). Dependencies in `.opencode/package.json` (bun install at startup).

**SDKs**: JS/TS, Go, Python.

## 13. IDE Detection

Env var: `OPENCODE=1`.

## 14. Session Storage [^31]

**Format**: SQLite (`opencode.db`, Drizzle ORM).

**Scope**: Per-project (tied to `ProjectID`).

**Paths**:
- Linux/macOS: `~/.local/share/opencode/opencode.db` (XDG standard)
- Auth: `~/.local/share/opencode/auth.json`

**Env vars**: `OPENCODE_DATA_DIR` (unconfirmed).

**Data**: Messages, cost summaries, timestamps per session.

## References

[^3]: https://opencode.ai/docs/
[^8]: https://opencode.ai/docs/tools/
[^12]: https://opencode.ai/docs/skills
[^31]: https://deepwiki.com/sst/opencode/2.1-session-management
