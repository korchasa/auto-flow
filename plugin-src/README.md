# flowai-workflow plugin source

Source tree for the generated `korchasa/flowai-workflow-plugins`
marketplace payload.

## Layout

```
shared/                         # copied into every host plugin root
  skills/                        # user-invokable skills
  agents/                        # orchestrator and supervisor subagents
  README.md                      # plugin-root README
claude/
  .claude-plugin/marketplace.json
  plugins/flowai-workflow/
    .claude-plugin/plugin.json
    .mcp.json                   # invokes `flowai-workflow mcp`
codex/
  .agents/plugins/marketplace.json
  plugins/flowai-workflow/
    .codex-plugin/plugin.json
    .mcp.json                   # invokes `flowai-workflow mcp`
```

`scripts/build-plugin-payload.ts` combines this source tree with the
bundled `.flowai-workflow/<name>/` templates, then emits separate
`dist/plugin-payload/claude` and `dist/plugin-payload/codex`
marketplace roots.

The `flowai-workflow` engine binary is a plugin precondition (FR-E78);
neither the launcher nor the engine TypeScript tree is bundled inside
the payload anymore.

Do not edit `dist/plugin-payload/`; it is regenerated.
