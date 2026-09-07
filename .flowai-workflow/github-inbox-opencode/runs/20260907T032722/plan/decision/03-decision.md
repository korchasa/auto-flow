---
variant: "Variant B: Dedicated src/config/migrate.ts with injectable step registry"
tasks:
  - desc: "Create migrate.ts: CURRENT_CONFIG_SCHEMA_VERSION=1, MigrationStep type, empty MIGRATION_STEPS registry, migrateWorkflow(raw, steps?, log?) with oldest-known default, contiguity assert, newer-than-current throw, version stamp, per-step log line"
    files: ["src/config/migrate.ts"]
  - desc: "FR-E101 regression tests (Deno.test('FR-E101 …')): no-op chain, single bump, multi-step chain via injected steps, absent schemaVersion default, newer-version fail-fast, stamp + log assertions"
    files: ["src/config/migrate_test.ts"]
  - desc: "Integrate into config pipeline: optional logSink param on parseConfig/loadConfig (no-op default), migrateWorkflow call between parse and validateSchema, validateSchema allows schemaVersion (positive int)"
    files: ["src/config/config.ts", "src/types.ts"]
  - desc: "Engine wiring: pass logSink -> output.status('config', msg) at fresh-run and dry-run load call sites"
    files: ["src/engine/engine.ts"]
  - desc: "Export migrate.ts API from library entry for embedders"
    files: ["src/mod.ts"]
  - desc: "Module docs: file bullet + key decision for migration layer in src/config/AGENTS.md"
    files: ["src/config/AGENTS.md"]
  - desc: "SRS anchor: add config_migration_test.ts to FR-E101 **Tests:** line"
    files: ["documents/requirements-engine/03-config-and-validation.md"]
---

# Decision: FR-E101 Config Migration Layer

## Justification

I select **Variant B** (dedicated `src/config/migrate.ts`, injectable step
registry).

- **Fail fast, fail clearly** (AGENTS.md Core Rules): `migrateWorkflow`
  throws at load time on `schemaVersion > CURRENT` — silent
  forward-incompatibility, the exact failure the FR-E52 incident exposed,
  becomes impossible.
- **Domain-agnostic engine, modules grouped by domain** (AGENTS.md
  Architecture): `src/config/` already follows one-concern-per-file
  (`template.ts`, `validate.ts`). Migration is a distinct concern from
  parsing/validation; Variant A would stuff it into the ~2100-line
  `config.ts` monolith and accelerate its growth.
- **No stubs for internals** (AGENTS.md Test Rules): the injectable
  `steps` param makes all five AC behaviours pure fixtures — no-op,
  single bump, multi-step chain, absent-default, newer fail-fast. Variant A's
  private registry forces either an exported mutable registry or a
  test-only chain-runner helper.
- **Spec boundary** ("No existing FR text modified"): Variant B leaves the
  `version: "1"` document-format gate (FR-E4/E7, regression-locked at
  `config_test.ts:468-477`) untouched. Variant C retires it — regression-
  locked churn plus drift from FR-E101's own text.
- **Log channel fidelity**: the audit line `config: migrated schema v<N> →
  v<N+1>` is informational; routing it through `ConfigWarnSink` (Variant A)
  mislabels it `WARN: `. Variant B wires `output.status("config", …)` —
  prefix-free, default verbosity, dry-run visible.
- Variant A's only edge is effort (S vs M); the M cost buys the test seam,
  channel correctness, and module hygiene. Variant C's L cost buys versioning
  coherence the spec explicitly defers.

Rejected: Variant A (monolith growth, WARN mislabel, weak chain-test seam),
Variant C (contradicts spec boundary, bricks every config if the alias step
bugs out).

## Task Descriptions

1. **migrate.ts module** — `CURRENT_CONFIG_SCHEMA_VERSION = 1` (house style:
   `template.ts:16`); `export type MigrationStep = { from: number; to:
   number; apply: (raw: Record<string, unknown>) => void }`;
   `export const MIGRATION_STEPS: MigrationStep[] = []`. `migrateWorkflow`
   resolves start version (absent `schemaVersion` → oldest known =
   `CURRENT − steps.length`, contiguity asserted), applies ordered steps,
   throws on newer-than-current, stamps the resolved version, logs
   `config: migrated schema v<N> → v<N+1>` per applied step. Skeleton ships
   no-op (spec: first real step deferred).
2. **Regression tests** — names start `FR-E101 `; cover all five AC paths
   via injected step arrays; assert stamp value and log calls.
3. **Pipeline integration** — `parseConfig`/`loadConfig` gain optional
   `logSink?: ConfigWarnSink` (4th positional, no-op default keeps MCP
   `get_workflow` and all existing call sites compatible); migration runs
   after YAML parse, before `validateSchema`; `validateSchema` adds
   `schemaVersion` to allowed keys + positive-int check (stamp always
   present post-migration).
4. **Engine wiring** — fresh-run and dry-run load sites pass
   `(m) => this.output.status("config", m)`.
5. **Library export** — `migrateWorkflow` + constants re-exported from
   `src/mod.ts` for embedders.
6. **Module docs** — `src/config/AGENTS.md` gains the `migrate.ts` bullet
   + key decision (steps must not touch `defaults.worktree_disabled` —
   `extractWorktreeDisabled()` pre-parses it before `parseConfig`).
7. **SRS anchor** — FR-E101 `**Tests:**` line gains
   `src/config/migrate_test.ts`.

## Summary

Selected Variant B: dedicated `src/config/migrate.ts` with injectable
`MIGRATION_STEPS` registry. Rationale: fail-fast load contract, one-concern-
per-file module hygiene, pure-fixture testability of all five AC paths, and
zero drift from regression-locked FR-E4/E7 text. 7 tasks. Branch
`sdlc/issue-223` reused; draft PR #247 updated.
