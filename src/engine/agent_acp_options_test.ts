/**
 * @module
 * FR-E98: the engine drives `@korchasa/ai-ide-cli` over ACP only, and the ACP
 * wire cannot carry every field of `RuntimeInvokeOptions`. The library rejects
 * the ones it cannot encode with `AcpUnsupportedOptionError` instead of
 * dropping them silently, so any such field reaching `adapter.invoke()` kills
 * the node.
 *
 * The forbidden set is read from the library itself
 * (`ACP_UNSUPPORTED_INVOKE_OPTIONS`) rather than restated here — a field added
 * upstream then fails these tests instead of passing them.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { collectUnsupportedOptions } from "@korchasa/ai-ide-cli";
import type {
  RuntimeAdapter,
  RuntimeInvokeOptions,
} from "@korchasa/ai-ide-cli/runtime/types";
import { runAgent } from "./agent.ts";
import { OutputManager } from "../output.ts";
import type {
  NodeConfig,
  ResolvedNodeSettings,
  TemplateContext,
} from "../types.ts";

function makeSettings(): ResolvedNodeSettings {
  return {
    max_continuations: 2,
    timeout_seconds: 30,
    on_error: "fail",
    max_retries: 1,
    retry_delay_seconds: 1,
  };
}

function makeCtx(nodeDir: string): TemplateContext {
  return {
    node_dir: nodeDir,
    run_dir: nodeDir,
    run_id: "test-run",
    workDir: ".",
    args: {},
    env: {},
    input: {},
  };
}

/** Adapter that records every invoke and answers success. `onSecondCall`
 * lets a test satisfy validation only on the continuation. */
function makeAdapter(
  calls: RuntimeInvokeOptions[],
  onCall?: (n: number) => Promise<void> | void,
): RuntimeAdapter {
  return {
    id: "claude",
    capabilities: {
      permissionMode: false,
      mcpInjection: false,
      transcript: false,
      interactive: false,
      toolUseObservation: false,
      session: false,
      capabilityInventory: false,
      commandsFastChannel: false,
      toolFilter: false,
      reasoningEffort: false,
    },
    launchInteractive() {
      throw new Error("not implemented");
    },
    invoke: async (opts) => {
      calls.push(opts);
      await onCall?.(calls.length);
      return {
        output: {
          runtime: "claude",
          result: "done",
          session_id: "ses_test",
          total_cost_usd: 0.01,
          duration_ms: 100,
          duration_api_ms: 100,
          num_turns: 1,
          is_error: false,
        },
      };
    },
  };
}

Deno.test("FR-E98 the initial ACP invoke carries no option the transport rejects", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const calls: RuntimeInvokeOptions[] = [];

  const result = await runAgent({
    node: { type: "agent", label: "Build", prompt: "build" } as NodeConfig,
    ctx: makeCtx(nodeDir),
    settings: makeSettings(),
    runtime: "claude",
    runtimeAdapter: makeAdapter(calls),
    // The combination a real CLI run always produces: a live OutputManager,
    // a node id to tag its lines with, and a verbosity dial.
    output: new OutputManager("verbose", () => {}),
    nodeId: "build",
    verbosity: "verbose",
  });

  assertEquals(result.success, true);
  assertEquals(calls.length, 1);
  assertEquals(
    collectUnsupportedOptions(
      "invoke",
      calls[0] as unknown as Record<string, unknown>,
    ),
    [],
  );
});

Deno.test("FR-E98 a continuation invoke carries no option the transport rejects", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const outputPath = `${nodeDir}/result.md`;
  const calls: RuntimeInvokeOptions[] = [];

  // Validation fails on the first pass and passes on the second, forcing one
  // continuation through the second invoke site.
  const adapter = makeAdapter(calls, async (n) => {
    if (n === 2) await Deno.writeTextFile(outputPath, "# done\n");
  });

  const result = await runAgent({
    node: {
      type: "agent",
      label: "Build",
      prompt: "build",
      validate: [{ type: "file_exists", path: outputPath }],
    } as NodeConfig,
    ctx: makeCtx(nodeDir),
    settings: makeSettings(),
    runtime: "claude",
    runtimeAdapter: adapter,
    output: new OutputManager("verbose", () => {}),
    nodeId: "build",
    verbosity: "verbose",
  });

  assertEquals(result.success, true);
  assertEquals(calls.length, 2);
  assertEquals(
    collectUnsupportedOptions(
      "invoke",
      calls[1] as unknown as Record<string, unknown>,
    ),
    [],
  );
});

Deno.test("FR-E98 per-node terminal output survives without onOutput", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const calls: RuntimeInvokeOptions[] = [];
  const written: string[] = [];

  // Feed one ACP text event back through the engine's own event sink.
  const adapter = makeAdapter(calls, () => {
    calls[0].onEvent?.({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hello from the agent" },
    });
  });

  const result = await runAgent({
    node: { type: "agent", label: "Build", prompt: "build" } as NodeConfig,
    ctx: makeCtx(nodeDir),
    settings: makeSettings(),
    runtime: "claude",
    runtimeAdapter: adapter,
    output: new OutputManager("verbose", (text) => written.push(text)),
    nodeId: "build",
    verbosity: "verbose",
  });

  assertEquals(result.success, true);
  assertStringIncludes(written.join(""), "hello from the agent");
});

Deno.test("FR-E98 a node that sets `agent` fails with a named engine error", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const calls: RuntimeInvokeOptions[] = [];

  const result = await runAgent({
    node: {
      type: "agent",
      label: "Build",
      prompt: "build",
      agent: "reviewer",
    } as NodeConfig,
    ctx: makeCtx(nodeDir),
    settings: makeSettings(),
    runtime: "claude",
    runtimeAdapter: makeAdapter(calls),
  });

  assertEquals(result.success, false);
  assertEquals(calls.length, 0, "the invoke must not be attempted");
  assertStringIncludes(result.error ?? "", "agent");
});

Deno.test("FR-E98 runtime_args on the ACP path fail with a named engine error", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const calls: RuntimeInvokeOptions[] = [];

  const result = await runAgent({
    node: { type: "agent", label: "Build", prompt: "build" } as NodeConfig,
    ctx: makeCtx(nodeDir),
    settings: makeSettings(),
    runtime: "claude",
    runtimeArgs: { "--foo": "bar" },
    runtimeAdapter: makeAdapter(calls),
  });

  assertEquals(result.success, false);
  assertEquals(calls.length, 0, "the invoke must not be attempted");
  assertStringIncludes(result.error ?? "", "runtime_args");
});
