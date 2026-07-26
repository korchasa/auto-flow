import { assertEquals, assertRejects } from "@std/assert";
import { createFakeRuntime, FAKE_SESSION_ID } from "./fake-runtime.ts";
import { getRuntimeAdapter } from "@korchasa/ai-ide-cli/runtime";
import { defaultRegistry } from "@korchasa/ai-ide-cli/process-registry";
import type { RuntimeInvokeOptions } from "@korchasa/ai-ide-cli/runtime/types";

function makeInvokeOptions(
  overrides: Partial<RuntimeInvokeOptions> = {},
): RuntimeInvokeOptions {
  return {
    processRegistry: defaultRegistry,
    taskPrompt: "do the thing",
    timeoutSeconds: 30,
    maxRetries: 1,
    retryDelaySeconds: 1,
    ...overrides,
  };
}

Deno.test("FR-E86 fake runtime records every invocation in call order", async () => {
  const adapter = createFakeRuntime((call) =>
    call.reply({ result: `turn ${call.index}` })
  );

  const first = await adapter.invoke(makeInvokeOptions({ taskPrompt: "a" }));
  const second = await adapter.invoke(
    makeInvokeOptions({ taskPrompt: "b", resumeSessionId: FAKE_SESSION_ID }),
  );

  assertEquals(adapter.calls.length, 2);
  assertEquals(adapter.calls[0].taskPrompt, "a");
  assertEquals(adapter.calls[1].resumeSessionId, FAKE_SESSION_ID);
  assertEquals(first.output?.result, "turn 1");
  assertEquals(second.output?.result, "turn 2");
});

Deno.test("FR-E86 handler sees its own index and the history so far", async () => {
  const seen: Array<{ index: number; historyLength: number }> = [];
  const adapter = createFakeRuntime((call) => {
    seen.push({ index: call.index, historyLength: call.history.length });
    return call.reply();
  });

  await adapter.invoke(makeInvokeOptions());
  await adapter.invoke(makeInvokeOptions());

  assertEquals(seen, [
    { index: 1, historyLength: 1 },
    { index: 2, historyLength: 2 },
  ]);
});

Deno.test("FR-E86 reply() fills inert fields, fail() returns no output", async () => {
  const adapter = createFakeRuntime((call) =>
    call.index === 1
      ? call.reply({ costUsd: 0.25, sessionId: "ses-custom" })
      : call.fail("front died", "stream_stall")
  );

  const ok = await adapter.invoke(makeInvokeOptions());
  assertEquals(ok.output?.runtime, "opencode");
  assertEquals(ok.output?.session_id, "ses-custom");
  assertEquals(ok.output?.total_cost_usd, 0.25);
  assertEquals(ok.output?.is_error, false);

  const dead = await adapter.invoke(makeInvokeOptions());
  assertEquals(dead.output, undefined);
  assertEquals(dead.error, "front died");
  assertEquals(dead.error_category, "stream_stall");
});

Deno.test("FR-E86 capabilities mirror the real adapter unless overridden", () => {
  const real = getRuntimeAdapter("opencode");
  const adapter = createFakeRuntime((call) => call.reply(), {
    capabilities: { mcpInjection: true },
  });

  assertEquals(
    adapter.capabilities.toolFilter,
    real.capabilities.toolFilter,
    "un-overridden capability must track the real adapter",
  );
  assertEquals(adapter.capabilities.mcpInjection, true);

  const realAcp = real.capabilitiesFor?.("acp") ?? real.capabilities;
  const fakeAcp = adapter.capabilitiesFor!("acp");
  assertEquals(fakeAcp.transcript, realAcp.transcript);
  assertEquals(fakeAcp.mcpInjection, true, "override applies per transport");
});

Deno.test("FR-E86 write() resolves artifacts against the invocation cwd", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const adapter = createFakeRuntime(async (call) => {
      await call.write("nested/result.md", "# done\n");
      return call.reply();
    });

    await adapter.invoke(makeInvokeOptions({ cwd: dir }));

    assertEquals(
      await Deno.readTextFile(`${dir}/nested/result.md`),
      "# done\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E86 sleep() rejects the moment the engine aborts the invocation", async () => {
  const controller = new AbortController();
  const adapter = createFakeRuntime(async (call) => {
    await call.sleep(60_000);
    return call.reply();
  });

  const pending = adapter.invoke(makeInvokeOptions({
    signal: controller.signal,
  }));
  controller.abort(new Error("retry budget 1s exceeded"));

  const err = await assertRejects(() => pending, Error);
  assertEquals(err.message, "retry budget 1s exceeded");
});

Deno.test("FR-E86 a throwing handler surfaces as an adapter crash", async () => {
  const adapter = createFakeRuntime(() => {
    throw new Error("front handshake failed");
  });

  const err = await assertRejects(
    () => adapter.invoke(makeInvokeOptions()),
    Error,
  );
  assertEquals(err.message, "front handshake failed");
});
