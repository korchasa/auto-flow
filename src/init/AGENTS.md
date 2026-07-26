# Module: init

`flowai-workflow init`: copies a bundled workflow folder into a project.

- `preflight.ts` — environment/tooling checks before writing anything.
- `scaffold.ts` — the verbatim copy itself.
- `mod.ts` — CLI wiring, `--list`, exit codes.

## Key decisions

- **Verbatim copy, no templating.** The bundled `.flowai-workflow/<name>/`
  folders ARE the templates — the same ones this repo dogfoods — so there is
  no placeholder substitution, no wizard, and no separate template tree to
  drift out of sync.
- **Preflight runs before any write**, so a failed scaffold leaves no
  half-written workflow behind.
- **Per-run dirt never ships.** `runs/`, `memory/agent-*.md` and
  `.template.json` are excluded from the published tarball and from what
  `init` copies.
