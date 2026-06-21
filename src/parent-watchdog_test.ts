/**
 * FR-E83: parent-death watchdog tests. The watchdog logic is exercised with
 * an injected `getParentPid` and a custom `onParentDeath` so no real
 * `Deno.exit` / `Deno.ppid` is touched. Two source-presence tests lock the
 * wiring into both stdio MCP entrypoints against regressions.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

import {
  installParentDeathWatchdog,
  parentIsOrphaned,
} from "./parent-watchdog.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("FR-E83 parentIsOrphaned detects reparenting to init (pid 1)", () => {
  assert(parentIsOrphaned(() => 1));
  assert(!parentIsOrphaned(() => 4242));
});

Deno.test(
  "FR-E83 watchdog fires onParentDeath exactly once when reparented",
  async () => {
    let calls = 0;
    const watchdog = installParentDeathWatchdog({
      intervalMs: 5,
      getParentPid: () => 1,
      onParentDeath: () => {
        calls += 1;
      },
    });
    // Several ticks elapse; the interval self-clears on the first fire.
    await delay(40);
    watchdog.stop();
    assertEquals(calls, 1);
  },
);

Deno.test(
  "FR-E83 watchdog never fires while the parent stays alive",
  async () => {
    let calls = 0;
    const watchdog = installParentDeathWatchdog({
      intervalMs: 5,
      getParentPid: () => 4242,
      onParentDeath: () => {
        calls += 1;
      },
    });
    await delay(40);
    watchdog.stop();
    assertEquals(calls, 0);
  },
);

Deno.test(
  "FR-E83 stop() cancels the watchdog before it can fire",
  async () => {
    let calls = 0;
    const watchdog = installParentDeathWatchdog({
      intervalMs: 5,
      getParentPid: () => 1,
      onParentDeath: () => {
        calls += 1;
      },
    });
    watchdog.stop();
    await delay(40);
    assertEquals(calls, 0);
  },
);

Deno.test("FR-E83 mcp-server stdio entrypoint wires the watchdog", async () => {
  const src = await Deno.readTextFile(
    fromFileUrl(new URL("./mcp/mcp-server.ts", import.meta.url)),
  );
  assert(src.includes("installParentDeathWatchdog"));
});

Deno.test("FR-E83 hitl mcp-server entrypoint wires the watchdog", async () => {
  const src = await Deno.readTextFile(
    fromFileUrl(new URL("./hitl/hitl-mcp-server.ts", import.meta.url)),
  );
  assert(src.includes("installParentDeathWatchdog"));
});
