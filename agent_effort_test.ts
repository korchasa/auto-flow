/**
 * @module
 * Wiring tests for FR-E42 per-node reasoning-effort.
 *
 * Verifies that:
 * - `runAgent` forwards `reasoningEffort` to the runtime adapter on BOTH
 *   initial and resume (continuation) invocations. The library itself
 *   filters `--effort` from the resume argv (Claude only); the engine just
 *   passes the typed field through.
 * - `resolveRuntimeConfig` cascades `effort` node → parent (loop) → defaults
 *   when fed engine `WorkflowDefaults` / `NodeConfig` shapes directly.
 */

import { assertEquals } from "@std/assert";
import { runAgent } from "./agent.ts";
import { resolveRuntimeConfig } from "@korchasa/ai-ide-cli/runtime";
import type {
  RuntimeAdapter,
  RuntimeInvokeOptions,
} from "@korchasa/ai-ide-cli/runtime/types";
import type {
  NodeConfig,
  NodeSettings,
  TemplateContext,
  WorkflowDefaults,
} from "./types.ts";

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
    workDir: ".",
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
      reasoningEffort: false,
    },
    launchInteractive() {
      throw new Error("not implemented");
    },
    invoke: async (opts) => {
      calls.push(opts);
      // Second call writes the output so validation passes.
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

Deno.test("runAgent — forwards reasoningEffort on initial and continuation invocations", async () => {
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
    reasoningEffort: "high",
  });

  assertEquals(result.success, true);
  assertEquals(calls.length, 2, "initial + one continuation");
  assertEquals(calls[0].reasoningEffort, "high");
  assertEquals(calls[0].resumeSessionId, undefined);
  // Continuation also receives the typed field — library filters --effort
  // from argv when resumeSessionId is set; engine just forwards.
  assertEquals(calls[1].reasoningEffort, "high");
  assertEquals(calls[1].resumeSessionId, "sess-x");
});

Deno.test("runAgent — omits reasoningEffort when not set", async () => {
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

  assertEquals(calls[0].reasoningEffort, undefined);
});

Deno.test("resolveRuntimeConfig — cascades effort: defaults → node override", () => {
  const defaults: WorkflowDefaults = { effort: "low" };
  const node: NodeConfig = {
    type: "agent",
    label: "x",
    effort: "high",
  };
  const resolved = resolveRuntimeConfig({ defaults, node });
  assertEquals(resolved.reasoningEffort, "high");
});

Deno.test("resolveRuntimeConfig — cascades effort: defaults only", () => {
  const defaults: WorkflowDefaults = { effort: "medium" };
  const node: NodeConfig = { type: "agent", label: "x" };
  const resolved = resolveRuntimeConfig({ defaults, node });
  assertEquals(resolved.reasoningEffort, "medium");
});

Deno.test("resolveRuntimeConfig — loop body inherits parent effort", () => {
  const defaults: WorkflowDefaults = { effort: "low" };
  const parent: NodeConfig = { type: "loop", label: "loop", effort: "high" };
  const node: NodeConfig = { type: "agent", label: "body" };
  const resolved = resolveRuntimeConfig({ defaults, node, parent });
  assertEquals(resolved.reasoningEffort, "high");
});

Deno.test("resolveRuntimeConfig — node override beats loop parent", () => {
  const defaults: WorkflowDefaults = { effort: "low" };
  const parent: NodeConfig = { type: "loop", label: "loop", effort: "medium" };
  const node: NodeConfig = { type: "agent", label: "body", effort: "high" };
  const resolved = resolveRuntimeConfig({ defaults, node, parent });
  assertEquals(resolved.reasoningEffort, "high");
});

Deno.test("resolveRuntimeConfig — undefined when nothing set", () => {
  const defaults: WorkflowDefaults = {};
  const node: NodeConfig = { type: "agent", label: "x" };
  const resolved = resolveRuntimeConfig({ defaults, node });
  assertEquals(resolved.reasoningEffort, undefined);
});
