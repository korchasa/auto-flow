import { assertEquals } from "@std/assert";
import {
  _getProcesses,
  _getShutdownCallbacks,
  _reset,
  installSignalHandlers,
  killAll,
  onShutdown,
  register,
  unregister,
} from "./process-registry.ts";

Deno.test("register adds process to set", () => {
  _reset();
  const fake = { pid: 1, kill: () => {} } as unknown as Deno.ChildProcess;
  register(fake);
  assertEquals(_getProcesses().size, 1);
  assertEquals(_getProcesses().has(fake), true);
  _reset();
});

Deno.test("unregister removes process from set", () => {
  _reset();
  const fake = { pid: 1, kill: () => {} } as unknown as Deno.ChildProcess;
  register(fake);
  unregister(fake);
  assertEquals(_getProcesses().size, 0);
  _reset();
});

Deno.test("double register is idempotent", () => {
  _reset();
  const fake = { pid: 1, kill: () => {} } as unknown as Deno.ChildProcess;
  register(fake);
  register(fake);
  assertEquals(_getProcesses().size, 1);
  _reset();
});

Deno.test("unregister non-registered is no-op", () => {
  _reset();
  const fake = { pid: 1, kill: () => {} } as unknown as Deno.ChildProcess;
  unregister(fake); // should not throw
  assertEquals(_getProcesses().size, 0);
  _reset();
});

Deno.test("killAll sends SIGTERM to registered processes", async () => {
  _reset();
  const killed: string[] = [];
  const fakeProcess = {
    pid: 999,
    kill(signal: string) {
      killed.push(signal);
    },
    status: Promise.resolve({ success: false, code: 143, signal: "SIGTERM" }),
  } as unknown as Deno.ChildProcess;

  register(fakeProcess);
  await killAll();
  assertEquals(killed.includes("SIGTERM"), true);
  // Process should be cleared from set after killAll
  assertEquals(_getProcesses().size, 0);
  _reset();
});

Deno.test("onShutdown callbacks execute during killAll", async () => {
  _reset();
  let called = false;
  onShutdown(() => {
    called = true;
  });
  await killAll();
  assertEquals(called, true);
  _reset();
});

Deno.test("onShutdown async callbacks are awaited", async () => {
  _reset();
  let called = false;
  onShutdown(async () => {
    await new Promise((r) => setTimeout(r, 10));
    called = true;
  });
  await killAll();
  assertEquals(called, true);
  _reset();
});

Deno.test("killAll handles process.kill throwing (already exited)", async () => {
  _reset();
  const fakeProcess = {
    pid: 999,
    kill(_signal: string) {
      throw new Error("Process already exited");
    },
    status: Promise.resolve({ success: false, code: 1, signal: null }),
  } as unknown as Deno.ChildProcess;

  register(fakeProcess);
  // Should not throw
  await killAll();
  assertEquals(_getProcesses().size, 0);
  _reset();
});

Deno.test("installSignalHandlers is callable without error", () => {
  _reset();
  // Just verify it doesn't throw; actual signal handling tested manually
  installSignalHandlers();
  _reset();
});
