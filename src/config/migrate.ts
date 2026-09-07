/**
 * FR-E101: versioned config schema migration chain.
 *
 * Runs BEFORE validation on every config load (see `parseConfig`): a parsed
 * `workflow.yaml` is walked through the ordered `MIGRATION_STEPS` registry
 * until it reaches `CURRENT_CONFIG_SCHEMA_VERSION`, then stamped with the
 * resolved version. An absent `schemaVersion` means "oldest known version",
 * so unversioned legacy configs migrate too. A config stamped NEWER than the
 * engine supports fails fast at load — silent forward-incompatibility is
 * forbidden.
 *
 * Out of scope: journal `schema_version` (FR-E69 replay contract) and the
 * document-format `version: "1"` gate (FR-E4/E7) — different concerns.
 * Migration steps MUST NOT touch `defaults.worktree_disabled` — it is
 * pre-parsed from the raw YAML before `parseConfig` (FR-E24).
 */

/** Schema version this engine's config code is written against. */
export const CURRENT_CONFIG_SCHEMA_VERSION = 1;

/** One ordered migration step: normalises a v`from` config in place to v`to`. */
export interface MigrationStep {
  /** Schema version the step reads. */
  from: number;
  /** Schema version the step produces — always `from + 1`. */
  to: number;
  /** Normalise the raw parsed config in place from v`from` to v`to`. */
  apply: (raw: Record<string, unknown>) => void;
}

/**
 * Ordered registry of `v<N> → v<N+1>` steps. MUST form a contiguous chain
 * ending at {@link CURRENT_CONFIG_SCHEMA_VERSION} (asserted in
 * {@link migrateWorkflow}). Skeleton for now — the first real step lands
 * with the next breaking config change.
 */
export const MIGRATION_STEPS: MigrationStep[] = [];

/** Informational audit-line sink (status channel — no WARN prefix). */
export type MigrationLogSink = (message: string) => void;

/**
 * Migrate a parsed workflow config to the current schema version, in place.
 *
 * Start version resolution: absent `schemaVersion` → oldest known
 * (`CURRENT − steps.length`); declared values are validated (integer, not
 * newer than current, not older than the chain covers). Every applied step
 * emits `config: migrated schema v<N> → v<N+1>` via `log`. Always stamps
 * the resolved (current) version on the raw config.
 *
 * @param raw  — parsed top-level config object, mutated in place.
 * @param steps — migration registry; defaults to {@link MIGRATION_STEPS}.
 * @param log  — optional audit-line sink; defaults to silent.
 * @throws when `schemaVersion` is newer than supported (fail-fast at load),
 *   older than the chain covers, not an integer, or when `steps` is not a
 *   contiguous chain ending at the current version (registry authoring bug).
 */
export function migrateWorkflow(
  raw: Record<string, unknown>,
  steps: MigrationStep[] = MIGRATION_STEPS,
  log?: MigrationLogSink,
): void {
  const oldest = CURRENT_CONFIG_SCHEMA_VERSION - steps.length;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.from !== oldest + i || step.to !== step.from + 1) {
      throw new Error(
        `Migration steps must form a contiguous v<N> → v<N+1> chain ending at v${CURRENT_CONFIG_SCHEMA_VERSION}; step ${i} covers v${step.from} → v${step.to}`,
      );
    }
  }
  const declared = raw.schemaVersion;
  let start: number;
  if (declared === undefined) {
    start = oldest;
  } else if (typeof declared !== "number" || !Number.isInteger(declared)) {
    throw new Error(
      `Config 'schemaVersion' must be an integer, got ${
        JSON.stringify(declared)
      }`,
    );
  } else if (declared > CURRENT_CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Config 'schemaVersion' ${declared} is newer than the supported version ${CURRENT_CONFIG_SCHEMA_VERSION} — upgrade flowai-workflow to load this workflow`,
    );
  } else if (declared < oldest) {
    throw new Error(
      `Config 'schemaVersion' ${declared} is older than the oldest supported version ${oldest} — no migration chain covers it`,
    );
  } else {
    start = declared;
  }
  for (let v = start; v < CURRENT_CONFIG_SCHEMA_VERSION; v++) {
    steps[v - oldest].apply(raw);
    log?.(`config: migrated schema v${v} → v${v + 1}`);
  }
  raw.schemaVersion = CURRENT_CONFIG_SCHEMA_VERSION;
}
