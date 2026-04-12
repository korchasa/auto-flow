# IDE Differences (flowai R&D)

Research reference: AI IDE/CLI capabilities, context primitives, config
formats, migration paths. Split by IDE for targeted reads.

## Per-IDE References

| IDE | File | Docs |
|:----|:-----|:-----|
| Cursor | [cursor.md](ides-difference/cursor.md) | docs.cursor.com |
| Claude Code | [claude-code.md](ides-difference/claude-code.md) | code.claude.com/docs |
| OpenCode | [opencode.md](ides-difference/opencode.md) | opencode.ai/docs |
| OpenAI Codex | [openai-codex.md](ides-difference/openai-codex.md) | github.com/openai/codex |

## Cross-IDE

- [comparison.md](ides-difference/comparison.md) — feature matrix, IDE detection order
- [conversion-cursor-claude.md](ides-difference/conversion-cursor-claude.md) — Cursor → Claude Code migration guide

## Section Map (per IDE file)

Each IDE file follows the same structure:

1. Built-in Tools
2. Persistent Instructions
3. Conditional Instructions
4. Custom Commands
5. Event Hooks / Plugins
6. Skills
7. MCP Integration
8. Context Ignoring
9. Custom Agents
10. Permission Modes
11. Plugin Bundles
12. IDE Detection
13. Session Storage

IDE-specific extras: Claude Code §12 (Execution Mode Differences),
OpenAI Codex §12 (CLI Details), OpenCode §11 (Custom Tools).
