/**
 * @module
 * Wiring tests for FR-E48 node tool filtering.
 *
 * Verifies that `runAgent` forwards `allowedTools` / `disallowedTools` to the
 * runtime adapter on BOTH initial and resume (continuation) invocations, and
 * that mutex is never violated at the adapter boundary.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { runAgent } from "./agent.ts";
import type {
  RuntimeAdapter,
  RuntimeInvokeOptions,
} from "@korchasa/ai-ide-cli/runtime/types";
import type { NodeConfig, NodeSettings, TemplateContext } from "./types.ts";

function makeSettings(): Required<NodeSettings> {
  return {
    max_continuations: 1,
    timeout_seconds: 60,
    on_error: "fail",
    max_retries: 1,
    retry_delay_seconds: 1,
  };
}

function makeCtx(nodeDir: string): TemplateContext {
  return {
    node_dir: nodeDir,
    run_dir: nodeDir,
    run_id: "test",
    args: {},
    env: {},
    input: {},
  };
}

function makeCapturingAdapter(
  calls: RuntimeInvokeOptions[],
  outputPath: string,
): RuntimeAdapter {
  return {
    id: "opencode",
    capabilities: {
      permissionMode: false,
      hitl: false,
      transcript: false,
      interactive: false,
      toolUseObservation: false,
      session: false,
      capabilityInventory: false,
      toolFilter: false,
    },
    launchInteractive() {
      throw new Error("not implemented");
    },
    invoke: async (opts) => {
      calls.push(opts);
      // Second call writes the output so validation passes and the
      // continuation loop terminates.
      if (calls.length === 2) {
        await Deno.writeTextFile(outputPath, "# done\n");
      }
      return {
        output: {
          runtime: "opencode",
          result: "ok",
          session_id: "sess-x",
          total_cost_usd: 0,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          is_error: false,
        },
      };
    },
  };
}

Deno.test("runAgent — forwards allowedTools on initial and resume invocations", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const outputPath = `${nodeDir}/result.md`;
  const calls: RuntimeInvokeOptions[] = [];
  const adapter = makeCapturingAdapter(calls, outputPath);

  const node: NodeConfig = {
    type: "agent",
    label: "Build",
    prompt: "build",
    validate: [{ type: "file_exists", path: outputPath }],
  };

  const result = await runAgent({
    node,
    ctx: makeCtx(nodeDir),
    settings: makeSettings(),
    runtime: "opencode",
    runtimeAdapter: adapter,
    allowedTools: ["Read", "Grep"],
  });

  assertEquals(result.success, true);
  assertEquals(calls.length, 2, "initial + one continuation");
  assertEquals(calls[0].allowedTools, ["Read", "Grep"]);
  assertEquals(calls[0].disallowedTools, undefined);
  assertEquals(calls[0].resumeSessionId, undefined);
  assertEquals(calls[1].allowedTools, ["Read", "Grep"]);
  assertEquals(calls[1].resumeSessionId, "sess-x");
});

Deno.test("runAgent — forwards disallowedTools on initial and resume invocations", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const outputPath = `${nodeDir}/result.md`;
  const calls: RuntimeInvokeOptions[] = [];
  const adapter = makeCapturingAdapter(calls, outputPath);

  const node: NodeConfig = {
    type: "agent",
    label: "Build",
    prompt: "build",
    validate: [{ type: "file_exists", path: outputPath }],
  };

  const result = await runAgent({
    node,
    ctx: makeCtx(nodeDir),
    settings: makeSettings(),
    runtime: "opencode",
    runtimeAdapter: adapter,
    disallowedTools: ["Write", "Edit"],
  });

  assertEquals(result.success, true);
  assertEquals(calls.length, 2);
  assertEquals(calls[0].disallowedTools, ["Write", "Edit"]);
  assertEquals(calls[0].allowedTools, undefined);
  assertEquals(calls[1].disallowedTools, ["Write", "Edit"]);
});

Deno.test("runAgent — omits tool filter fields when neither is set", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const outputPath = `${nodeDir}/result.md`;
  await Deno.writeTextFile(outputPath, "# already\n");
  const calls: RuntimeInvokeOptions[] = [];
  const adapter = makeCapturingAdapter(calls, outputPath);

  const node: NodeConfig = {
    type: "agent",
    label: "Build",
    prompt: "build",
    validate: [{ type: "file_exists", path: outputPath }],
  };

  await runAgent({
    node,
    ctx: makeCtx(nodeDir),
    settings: makeSettings(),
    runtime: "opencode",
    runtimeAdapter: adapter,
  });

  assertEquals(calls[0].allowedTools, undefined);
  assertEquals(calls[0].disallowedTools, undefined);
});

Deno.test("runAgent — guard: adapter never receives both allowedTools and disallowedTools", async () => {
  // Regression guard: if resolveToolFilter ever returned both fields for the
  // same invocation (violating mutex), this catches it at the boundary.
  const nodeDir = Deno.makeTempDirSync();
  const outputPath = `${nodeDir}/result.md`;
  await Deno.writeTextFile(outputPath, "# already\n");
  const calls: RuntimeInvokeOptions[] = [];
  const adapter = makeCapturingAdapter(calls, outputPath);

  const node: NodeConfig = {
    type: "agent",
    label: "Build",
    prompt: "build",
    validate: [{ type: "file_exists", path: outputPath }],
  };

  await runAgent({
    node,
    ctx: makeCtx(nodeDir),
    settings: makeSettings(),
    runtime: "opencode",
    runtimeAdapter: adapter,
    allowedTools: ["Read"],
  });

  for (const call of calls) {
    const bothSet = call.allowedTools !== undefined &&
      call.disallowedTools !== undefined;
    assertNotEquals(
      bothSet,
      true,
      "allowedTools and disallowedTools must never coexist in a single invocation",
    );
  }
});
