/**
 * @module
 * Cross-platform parent-death watchdog for the engine's long-lived stdio MCP
 * entrypoints (`flowai-workflow mcp` and `--internal-hitl-mcp`).
 *
 * **Why (FR-E83).** Both entrypoints terminate on only two signals: stdin EOF
 * (the stdio transport closing) and SIGTERM/SIGINT (the bin signal handlers).
 * Neither fires when the ACP host that spawned the server dies non-gracefully:
 * a `kill -9` delivers no SIGTERM, and stdin EOF never arrives while any
 * process in the pipe chain still holds the write end open (an orphaned
 * `codex-acp`, an intermediate launcher fd dup). The server then lingers as a
 * `ppid=1` orphan for days, accumulating into hundreds of stray processes that
 * pin swap and the memory compressor.
 *
 * The watchdog polls the parent PID; once the process is reparented to
 * init/launchd (`ppid === 1`) the host that spawned us is gone, so it shuts
 * down instead of lingering forever. `Deno.ppid` is portable (covers macOS,
 * the observed leak host); the Linux-only `PR_SET_PDEATHSIG` fast path is out
 * of scope.
 */

import { killAll } from "./process-registry.ts";

/** PID that init/launchd reports; reparented orphans see this as their parent. */
const INIT_PID = 1;

/** Default poll cadence (ms). */
export const PARENT_WATCHDOG_INTERVAL_MS = 5_000;

/** Options for {@link installParentDeathWatchdog}. */
export interface ParentDeathWatchdogOptions {
  /** Poll cadence in ms. Defaults to {@link PARENT_WATCHDOG_INTERVAL_MS}. */
  intervalMs?: number;
  /** Returns the current parent PID. Defaults to `() => Deno.ppid`; injectable
   * for tests so no real reparenting is needed. */
  getParentPid?: () => number;
  /** Invoked once when the parent is detected dead. Defaults to
   * `killAll()` followed by `Deno.exit(143)` (128 + SIGTERM). Injectable for
   * tests so the process is not actually terminated. */
  onParentDeath?: () => void;
}

/** Handle returned by {@link installParentDeathWatchdog}. */
export interface ParentDeathWatchdog {
  /** Stop polling and release the timer. Idempotent. */
  stop(): void;
}

/**
 * True when the current process has been reparented to init/launchd, i.e. the
 * process that spawned it has exited.
 */
export function parentIsOrphaned(
  getParentPid: () => number = () => Deno.ppid,
): boolean {
  return getParentPid() === INIT_PID;
}

/**
 * Start polling the parent PID. When the process becomes an orphan
 * ({@link parentIsOrphaned}), the watchdog fires {@link
 * ParentDeathWatchdogOptions.onParentDeath} exactly once and clears its own
 * timer. The timer is unref'd so the watchdog never keeps the event loop alive
 * on its own — if nothing else holds the loop open, a natural exit is already
 * the desired outcome.
 */
export function installParentDeathWatchdog(
  options: ParentDeathWatchdogOptions = {},
): ParentDeathWatchdog {
  const intervalMs = options.intervalMs ?? PARENT_WATCHDOG_INTERVAL_MS;
  const getParentPid = options.getParentPid ?? (() => Deno.ppid);
  const onParentDeath = options.onParentDeath ?? defaultShutdown;

  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    if (parentIsOrphaned(getParentPid)) {
      fired = true;
      clearInterval(timer);
      onParentDeath();
    }
  }, intervalMs);
  Deno.unrefTimer(timer);

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

/** Default teardown: kill tracked children, then exit with the SIGTERM code. */
function defaultShutdown(): void {
  killAll().finally(() => Deno.exit(143));
}
