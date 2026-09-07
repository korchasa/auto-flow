# Module: config

Workflow YAML → validated, defaults-merged `WorkflowConfig`, plus the
`{{...}}` template language and node output validation.

- `config.ts` — `loadConfig`/`parseConfig`: schema validation then a 3-tier
  default cascade (hardcoded → `defaults:` → `node.settings`).
- `template.ts` — `interpolate`/`validateTemplateVars`: dotted vars,
  `file()`, `flow_file()`, `bash()`. Single-pass; unresolved vars throw.
- `validate.ts` — node output rules (`artifact`, `frontmatter_field`,
  `custom_script`, `git_*`).
- `migrate.ts` — FR-E101 `migrateWorkflow`: ordered `MIGRATION_STEPS`
  chain run by `parseConfig` after the YAML parse and before
  `validateSchema`; stamps `schemaVersion`, logs each applied step through
  the load-time sink, fails fast on a config newer than the engine.

## Key decisions

- **Migration steps must not touch `defaults.worktree_disabled`.**
  `extractWorktreeDisabled()` pre-parses that key from the raw YAML before
  `parseConfig` runs (FR-E24), so a step that renamed or moved it would be
  read by the engine on the un-migrated shape and silently ignored.
- **`version` vs `schemaVersion` are two gates.** `version: "1"` is the
  config language generation — an old binary must refuse anything else.
  `schemaVersion` is the revision within that generation and migrates
  forward silently; a value newer than the engine fails at load.
- **Unknown keys are rejected, never ignored** — nodes (`NODE_CONFIG_KEYS`),
  `settings`, `budget`, `defaults.hitl`. A mistyped `validat:` silently
  disabled every output check of a node before this was enforced.
- **`defaults.hitl` merges per FIELD.** The surrounding defaults spread is
  shallow, so an author declaring only the two scripts used to erase
  `poll_interval`/`timeout`; the poll loop then computed `Date.now() + NaN`
  and "timed out" without a single poll.
- **`max_parallel` defaults to 1.** Concurrency is unsafe while the FR-E50
  guardrail is active (see `isolation/AGENTS.md`); `0` still means unlimited.
- **`validate.ts` passes the working directory into `interpolate`** so
  `{{bash()}}`/`{{file()}}` in a rule path resolve inside the run's worktree,
  matching what `runAgent` does for prompts and hooks.
- **Template values are inserted verbatim into shell strings.** Hooks and
  `custom_script` run through `sh -c`, so quoting is the workflow author's
  responsibility.
