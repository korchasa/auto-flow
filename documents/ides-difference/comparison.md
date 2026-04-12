# Cross-IDE Comparison

## IDE Detection Order

Detection order: `CURSOR_AGENT` first (may co-exist with `CLAUDECODE` in nested envs), then `CLAUDECODE`, then `OPENCODE`, then Codex presence vars (`CODEX_THREAD_ID` / `CODEX_SANDBOX`).

**Important**: Cursor Agent (CLI) built on Claude Agent SDK — sets BOTH `CURSOR_AGENT=1` AND `CLAUDECODE=1`. Check `CURSOR_AGENT` first. [^34]

## Feature Matrix

| Primitive | Cursor | Claude Code | OpenCode | OpenAI Codex |
| :--- | :--- | :--- | :--- | :--- |
| **Global Rules** | — | `~/.claude/CLAUDE.md` | `~/.config/opencode/AGENTS.md` | `~/.codex/AGENTS.md` |
| **Project Rules** | `AGENTS.md` | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` (+`AGENTS.override.md`) |
| **Folder Rules** | `subdir/AGENTS.md` | `subdir/CLAUDE.md` | — | `subdir/AGENTS.md` (cwd-based) |
| **Hooks** | `hooks.json` (20 events, 2 types) | `settings.json` (27 events, 4+1 types) | `.opencode/plugins/` (30+ events, code) | `hooks.json` (5 events, 3 types; feature-gated) |
| **Skills** | Yes | Yes | Yes | Yes (`.codex/skills/`, `.agents/skills/`) |
| **Subagents** | `Task` | `Task` | `task` | `[agents.<name>]` TOML |
| **Custom Tools** | MCP | MCP | `.opencode/tools/` + MCP | MCP |
| **Custom Agents** | `.cursor/agents/` | `.claude/agents/` | `.opencode/agents/` | `config.toml` `[agents]` + `.toml` sidecar |
| **Commands** | `.cursor/commands/` | `.claude/commands/` | `.opencode/commands/` | — (built-in slash only) |
| **Permission Modes** | Per-tool accept/reject | 5 named modes + rule syntax | `auto`/`ask`/`deny` | Approval × Sandbox + `.rules` (Starlark) |
| **Plugin Bundles** | `.cursor-plugin/` | `.claude-plugin/` | npm packages | `.codex-plugin/` |
| **Marketplace** | cursor.com/marketplace | claude.ai (~101 plugins) | npm | Plugin Directory (curated) |
| **MCP Config** | `.cursor/mcp.json` | `.mcp.json` | `opencode.jsonc` | `config.toml` `[mcp_servers]` |
| **Session Storage** | SQLite `state.vscdb` (GUI) + `store.db` (CLI) | JSONL `~/.claude/projects/` | SQLite `opencode.db` | JSONL `~/.codex/` + `sessions/` |
| **Config Format** | JSON | JSON | JSON/JSONC | TOML |
| **Execution Policy** | — | Permission rules syntax | — | `.rules` (Starlark, prefix-match) |
| **Enterprise/Managed** | — | Managed policy paths, MDM | — | `requirements.toml` (MDM/cloud-managed) |
| **Code Review** | — | — | — | `codex review` (non-interactive) |
| **CI/CD** | `cursor-agent` CLI | `claude -p` headless | — | `codex exec`, GitHub Action |
| **IDE Extensions** | Native | VS Code, JetBrains | TUI only | VS Code (+ Cursor/Windsurf compat) |

## Context Ignoring (Other IDEs)

**Dedicated AI ignore files** (gitignore syntax):
- **Aider**: `.aiderignore` — `--no-gitignore` disables `.gitignore`; `--add-gitignore-files` forces gitignored files into scope.

**Config-based exclusion**:
- **GitHub Copilot**: Server-side YAML in GitHub org/enterprise Settings → Content Exclusion (Business/Enterprise only; 30 min sync lag; independent of `.gitignore`). [^25]

**`.gitignore` only** (no dedicated mechanism):
- Windsurf, Zed, JetBrains AI Assistant, Continue.dev.

## References

[^25]: https://docs.github.com/en/copilot/how-tos/configure-content-exclusion/exclude-content-from-copilot
[^34]: Cursor Agent CLI verification (v2026.03.20).
