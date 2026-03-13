/** Pipeline lock to prevent parallel runs.
 * Lock file contains JSON with PID, hostname, run_id, and timestamp.
 * Stale detection: same hostname → PID check; different hostname → lock is
 * treated as live (conservative: container PIDs are invisible from host). */

import { hostname } from "node:os";

/** Lock file content structure. */
export interface LockInfo {
  pid: number;
  hostname: string;
  run_id: string;
  started_at: string;
}

const LOCK_PATH = ".sdlc/runs/.lock";

/** Default lock file path. */
export function defaultLockPath(): string {
  return LOCK_PATH;
}

/** Check if a process with given PID is alive on this host. */
function isProcessAlive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

/** Read lock info from lock file. Throws if file doesn't exist. */
export async function readLockInfo(lockPath: string): Promise<LockInfo> {
  const text = await Deno.readTextFile(lockPath);
  return JSON.parse(text) as LockInfo;
}

/** Check if an existing lock is still held by a live process.
 * Same hostname → PID check. Different hostname → assume alive. */
function isLockAlive(existing: LockInfo): boolean {
  const currentHost = hostname();
  if (existing.hostname && existing.hostname !== currentHost) {
    // Different host (e.g. container vs host) — cannot verify PID, assume alive
    return true;
  }
  // Same host or missing hostname (backward compat) — check PID
  return isProcessAlive(existing.pid);
}

/** Acquire pipeline lock. Throws if another live process holds it.
 * Reclaims stale locks (dead PID on same host) automatically. */
export async function acquireLock(
  lockPath: string,
  runId: string,
): Promise<void> {
  // Check existing lock
  try {
    const existing = await readLockInfo(lockPath);
    if (isLockAlive(existing)) {
      throw new Error(
        `Pipeline is already running (run_id: ${existing.run_id}, pid: ${existing.pid}, host: ${existing.hostname}). ` +
          `Remove ${lockPath} manually if the process is stuck.`,
      );
    }
    // Stale lock — reclaim it
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      // No lock file — proceed
    } else if (
      err instanceof Error && err.message.includes("already running")
    ) {
      throw err;
    } else if (err instanceof SyntaxError) {
      // Corrupted lock file — overwrite
    }
    // For NotFound and SyntaxError, fall through to create new lock
  }

  const info: LockInfo = {
    pid: Deno.pid,
    hostname: hostname(),
    run_id: runId,
    started_at: new Date().toISOString(),
  };

  // Ensure parent directory exists
  const dir = lockPath.substring(0, lockPath.lastIndexOf("/"));
  if (dir) {
    await Deno.mkdir(dir, { recursive: true });
  }

  await Deno.writeTextFile(lockPath, JSON.stringify(info, null, 2) + "\n");
}

/** Release pipeline lock. No-op if lock file doesn't exist. */
export async function releaseLock(lockPath: string): Promise<void> {
  try {
    await Deno.remove(lockPath);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
  }
}
