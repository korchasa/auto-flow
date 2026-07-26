/**
 * @module
 * Per-workflow run lock (FR-E54). Serializes concurrent runs against the
 * same workflow folder; distinct workflow folders run in parallel.
 * Lock file lives at `<workflowDir>/runs/.lock` and contains JSON with
 * PID, hostname, run_id, and timestamp.
 * Stale detection: always PID check. Hostname stored for diagnostics only.
 * Rationale: lock file lives on local FS, so if readable — PID is checkable.
 */

/** Lock file content structure. */
export interface LockInfo {
  pid: number;
  hostname: string;
  run_id: string;
  started_at: string;
}

/** Default lock file path for the given workflow folder (FR-E54).
 * `workflowDir` is the directory containing `workflow.yaml`
 * (typically `.flowai-workflow/<name>` under the multi-workflow layout, or
 * `.` for a bare top-level config). */
export function defaultLockPath(workflowDir: string): string {
  return `${workflowDir}/runs/.lock`;
}

/** Check if a process with given PID is alive on this host.
 *
 * `PermissionDenied` (POSIX `EPERM`) means the process EXISTS but belongs to
 * another user — it must count as alive. Treating it as dead (the previous
 * behaviour of a blanket `catch`) let one user reclaim a lock still held by
 * another user's running engine. Only `NotFound` (`ESRCH`) proves the PID is
 * gone; anything else is surfaced as "alive" because we cannot prove
 * otherwise and reclaiming on a guess is the destructive option. */
function isProcessAlive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    return true;
  }
}

/** Read lock info from lock file.
 *
 * Throws `Deno.errors.NotFound` when the file is absent and `SyntaxError`
 * when its contents are not a well-formed {@link LockInfo} — including
 * syntactically valid JSON of the wrong shape (`null`, an array, a record
 * missing `pid`). Callers rely on that single "corrupt" category to decide
 * between reclaiming debris and surfacing a genuine I/O failure, so shape
 * validation must not be left to the first property access. */
export async function readLockInfo(lockPath: string): Promise<LockInfo> {
  const text = await Deno.readTextFile(lockPath);
  const parsed = JSON.parse(text);
  if (
    !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    typeof (parsed as LockInfo).pid !== "number" ||
    typeof (parsed as LockInfo).run_id !== "string"
  ) {
    throw new SyntaxError(
      `Malformed lock file at ${lockPath}: expected {pid, hostname, run_id, started_at}`,
    );
  }
  return parsed as LockInfo;
}

/** Check if an existing lock is still held by a live process.
 * Always checks PID directly — lock file on local FS guarantees
 * PID namespace is shared. Hostname stored for diagnostics only. */
function isLockAlive(existing: LockInfo): boolean {
  return isProcessAlive(existing.pid);
}

/** Report whether `runId` is the run currently held alive by the workflow
 * lock (FR-E75). True iff the lock file exists, names this exact `runId`,
 * and its PID is a live process. Returns false (never throws) when the
 * lock is absent, corrupted, owned by a different run, or held by a dead
 * PID. Used by the unified command layer so `answer` can tell the operator
 * whether the live poll loop will pick up the inbox file or whether they
 * must resume the engine separately. */
export async function isRunLive(
  workflowDir: string,
  runId: string,
): Promise<boolean> {
  let info: LockInfo;
  try {
    info = await readLockInfo(defaultLockPath(workflowDir));
  } catch {
    // NotFound (no lock) or SyntaxError (corrupted lock) → not live.
    return false;
  }
  return info.run_id === runId && isProcessAlive(info.pid);
}

/** Return the lock holder for `workflowDir` iff a live process holds it
 * (FR-E84). Unlike {@link isRunLive} it does NOT match a specific run_id —
 * it answers "is ANY run currently active for this workflow folder", the
 * pre-check {@link startRun} needs before launching a fresh background run.
 * Returns null (never throws) when the lock is absent, corrupted, or held
 * by a dead PID. */
export async function liveLockHolder(
  workflowDir: string,
): Promise<LockInfo | null> {
  let info: LockInfo;
  try {
    info = await readLockInfo(defaultLockPath(workflowDir));
  } catch {
    // NotFound (no lock) or SyntaxError (corrupted lock) → not active.
    return null;
  }
  return isProcessAlive(info.pid) ? info : null;
}

/**
 * Acquire the workflow lock. Throws if another live process holds it.
 * Reclaims stale locks (dead PID) and corrupted lock files automatically.
 *
 * Creation is ATOMIC: the lock file is opened with `createNew: true`, so the
 * kernel — not this process — decides the winner when two engines race. The
 * previous read-then-write shape had a window between "no lock found" and
 * "lock written" in which both racers concluded the folder was free and both
 * proceeded, defeating FR-E54's serialization guarantee.
 *
 * On `AlreadyExists` the holder is inspected once: a live PID is a hard
 * failure; a dead PID or an unparseable file is removed and creation is
 * retried. A single retry is enough — a third party winning the re-created
 * slot is itself a live holder and surfaces as the normal "already running"
 * error.
 */
export async function acquireLock(
  lockPath: string,
  runId: string,
): Promise<void> {
  const info: LockInfo = {
    pid: Deno.pid,
    hostname: Deno.hostname(),
    run_id: runId,
    started_at: new Date().toISOString(),
  };
  const payload = JSON.stringify(info, null, 2) + "\n";

  // Ensure parent directory exists
  const dir = lockPath.substring(0, lockPath.lastIndexOf("/"));
  if (dir) {
    await Deno.mkdir(dir, { recursive: true });
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await createLockFile(lockPath, payload);
      return;
    } catch (err) {
      if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
    }

    // Someone holds the file. Decide whether it is a live run or debris.
    let existing: LockInfo | undefined;
    try {
      existing = await readLockInfo(lockPath);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        // Holder released between create and read — retry the create.
        continue;
      }
      if (!(err instanceof SyntaxError)) throw err;
      // Corrupted lock file — treated as debris below (existing stays undefined).
    }

    if (existing && isLockAlive(existing)) {
      throw new Error(
        `Workflow is already running (run_id: ${existing.run_id}, pid: ${existing.pid}, host: ${existing.hostname}). ` +
          `Remove ${lockPath} manually if the process is stuck.`,
      );
    }

    // Stale (dead PID) or corrupted — drop it and retry once.
    await releaseLock(lockPath);
  }

  throw new Error(
    `Failed to acquire workflow lock at ${lockPath}: contended by another process`,
  );
}

/**
 * Publish the lock file exclusively. Throws `AlreadyExists` when taken.
 *
 * Staged through a sibling temp file plus `Deno.link`, NOT a plain
 * `Deno.open({createNew: true})`. `createNew` publishes an EMPTY file and
 * fills it a moment later, so a racer that loses the create can still read
 * the empty file, classify it as corrupt debris, delete it and acquire the
 * lock — both processes then believe they hold it. A hard link makes the
 * name appear only when the content behind it is already complete.
 */
async function createLockFile(
  lockPath: string,
  payload: string,
): Promise<void> {
  const tmpPath = `${lockPath}.${Deno.pid}.tmp`;
  await Deno.writeTextFile(tmpPath, payload);
  try {
    await Deno.link(tmpPath, lockPath);
  } finally {
    await Deno.remove(tmpPath).catch(() => {});
  }
}

/** Release workflow lock. No-op if lock file doesn't exist. */
export async function releaseLock(lockPath: string): Promise<void> {
  try {
    await Deno.remove(lockPath);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
  }
}
