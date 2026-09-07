# Implementation Summary — FR-E101 Config Migration Layer

## Summary

- Files changed:
  - `src/config/migrate.ts` (new) — FR-E101 migration module:
    `CURRENT_CONFIG_SCHEMA_VERSION = 1`, `MigrationStep`
    (`{ from, to, apply }`), `MIGRATION_STEPS = []` (skeleton no-op chain),
    `migrateWorkflow(raw, steps?, log?)` — absent `schemaVersion` resolves
    to oldest known (`CURRENT − steps.length`, registry contiguity
    asserted), steps applied in place in order, emits
    `config: migrated schema v<N> → v<N+1>` per applied step via `log`,
    fails fast on declared version newer than supported / older than the
    chain covers / non-integer, always stamps the resolved version.
  - `src/config/config.ts` — `parseConfig`/`loadConfig` gain trailing
    optional `logSink?: ConfigWarnSink` (positional, no-op default; MCP
    `get_workflow` and all existing call sites unchanged);
    `migrateWorkflow(config, MIGRATION_STEPS, logSink)` runs BEFORE
    `validateSchema` (old shapes normalize before validation);
    `validateSchema` adds a positive-int `schemaVersion` check (defense in
    depth — stamp is always present post-migration).
  - `src/engine/engine.ts` — fresh-run and dry-run `loadConfig` sites wire
    `(m) => this.output.status("config", m)` as logSink (prefix-free
    default-verbosity audit channel; `warnSink` untouched).
  - `src/types.ts` — `WorkflowConfig.schemaVersion?: number`.
- Tests added: `src/config/config_test.ts` — 7 FR-E101-tagged tests:
  no-op at current version, single bump (mutates config + emits log),
  multi-step chain applied in registry order with two log lines, absent
  `schemaVersion` default (custom registry → oldest step applies; default
  registry → stamped current), newer-version fail-fast, non-contiguous
  registry throws, `parseConfig` stamps migrated version on loaded config.
- `deno task check`: PASS (type check, gitleaks, publish dry-run, FR
  canonical field-set lint incl. FR-E101 anchor in `config_test.ts`, docs
  token budget).
