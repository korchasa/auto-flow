/**
 * @module
 * Global process registry for graceful shutdown.
 * Tracks spawned child processes and shutdown callbacks.
 * On SIGINT/SIGTERM: kills all registered processes, runs callbacks, exits.
 */

const processes = new Set<Deno.ChildProcess>();
const shutdownCallbacks: Array<() => Promise<void> | void> = [];
let handlersInstalled = false;
let shuttingDown = false;

// Store listener references for cleanup in tests
let sigintListener: (() => void) | null = null;
let sigtermListener: (() => void) | null = null;

/** Register a child process for tracking. Idempotent. */
export function register(p: Deno.ChildProcess): void {
  processes.add(p);
}

/** Unregister a child process (e.g. after it exits normally). */
export function unregister(p: Deno.ChildProcess): void {
  processes.delete(p);
}

/** Register a callback to run during shutdown (lock release, state save).
 * Returns a disposer function that removes the callback. */
export function onShutdown(cb: () => Promise<void> | void): () => void {
  shutdownCallbacks.push(cb);
  return () => {
    const idx = shutdownCallbacks.indexOf(cb);
    if (idx !== -1) shutdownCallbacks.splice(idx, 1);
  };
}

/** Kill all registered processes and run shutdown callbacks. */
export async function killAll(): Promise<void> {
  // Send SIGTERM to all tracked processes
  const waitPromises: Promise<unknown>[] = [];
  for (const p of processes) {
    try {
      p.kill("SIGTERM");
    } catch {
      // Process may have already exited
    }
    waitPromises.push(
      p.status.catch(() => {
        /* ignore */
      }),
    );
  }

  // Wait up to 5s for processes to exit, then clear timer
  if (waitPromises.length > 0) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((r) => {
      timeoutId = setTimeout(r, 5000);
    });
    await Promise.race([
      Promise.allSettled(waitPromises),
      timeoutPromise,
    ]);
    clearTimeout(timeoutId);
  }

  // SIGKILL survivors
  for (const p of processes) {
    try {
      p.kill("SIGKILL");
    } catch {
      // Already exited
    }
  }
  processes.clear();

  // Run shutdown callbacks
  for (const cb of shutdownCallbacks) {
    try {
      await cb();
    } catch {
      // Best-effort cleanup
    }
  }
  shutdownCallbacks.length = 0;
}

/**
 * Install SIGINT + SIGTERM handlers. Idempotent — only installs once.
 * On signal: calls killAll(), then Deno.exit(130 for SIGINT, 143 for SIGTERM).
 */
export function installSignalHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  const handler = (signal: Deno.Signal) => {
    if (shuttingDown) return; // Prevent re-entrant shutdown
    shuttingDown = true;
    const code = signal === "SIGINT" ? 130 : 143;
    killAll().finally(() => {
      Deno.exit(code);
    });
  };

  sigintListener = () => handler("SIGINT");
  sigtermListener = () => handler("SIGTERM");

  try {
    Deno.addSignalListener("SIGINT", sigintListener);
  } catch {
    // Signal may not be available (e.g. Windows)
  }
  try {
    Deno.addSignalListener("SIGTERM", sigtermListener);
  } catch {
    // Signal may not be available
  }
}

// --- Test helpers (prefixed with _ to indicate internal use) ---

/** Reset all state including signal listeners. For test isolation only. */
export function _reset(): void {
  processes.clear();
  shutdownCallbacks.length = 0;
  // Remove installed signal listeners to prevent test leaks
  if (sigintListener) {
    try {
      Deno.removeSignalListener("SIGINT", sigintListener);
    } catch { /* ignore */ }
    sigintListener = null;
  }
  if (sigtermListener) {
    try {
      Deno.removeSignalListener("SIGTERM", sigtermListener);
    } catch { /* ignore */ }
    sigtermListener = null;
  }
  handlersInstalled = false;
  shuttingDown = false;
}

/** Get process set reference. For test assertions only. */
export function _getProcesses(): Set<Deno.ChildProcess> {
  return processes;
}

/** Get shutdown callbacks array reference. For test assertions only. */
export function _getShutdownCallbacks(): Array<() => Promise<void> | void> {
  return shutdownCallbacks;
}
