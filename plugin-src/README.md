# flowai-workflow plugin source

Source tree for the generated `korchasa/flowai-workflow-plugins`
marketplace payload.

## Layout

```
shared/                         # copied into every host plugin root
  bin/launch.ts                  # lazy-compile launcher
  skills/                        # user-invokable skills
  agents/                        # orchestrator and supervisor subagents
  README.md                      # plugin-root README
claude/
  .claude-plugin/marketplace.json
  plugins/flowai-workflow/
    .claude-plugin/plugin.json
    .mcp.json
codex/
  .agents/plugins/marketplace.json
  plugins/flowai-workflow/
    .codex-plugin/plugin.json
    .mcp.json
```

`scripts/build-plugin-payload.ts` combines this source tree with the
engine sources and bundled `.flowai-workflow/<name>/` templates, then
emits separate `dist/plugin-payload/claude` and
`dist/plugin-payload/codex` marketplace roots.

Do not edit `dist/plugin-payload/`; it is regenerated.
