import { assertEquals } from "@std/assert";
import { runAgent } from "./agent.ts";
import type {
  RuntimeAdapter,
  RuntimeInvokeOptions,
} from "@korchasa/ai-ide-cli/runtime/types";
import type { NodeConfig, NodeSettings, TemplateContext } from "./types.ts";

function makeSettings(): Required<NodeSettings> {
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

Deno.test("runAgent — continuation uses runtime adapter resume session", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const outputPath = `${nodeDir}/result.md`;
  const calls: RuntimeInvokeOptions[] = [];

  const runtimeAdapter: RuntimeAdapter = {
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
      if (calls.length === 2) {
        await Deno.writeTextFile(outputPath, "# done\n");
      }
      return {
        output: {
          runtime: "opencode",
          result: calls.length === 1 ? "first pass" : "fixed pass",
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

  const result = await runAgent({
    node: {
      type: "agent",
      label: "Build",
      prompt: "build",
      validate: [{ type: "file_exists", path: outputPath }],
    } as NodeConfig,
    ctx: makeCtx(nodeDir),
    settings: makeSettings(),
    runtime: "opencode",
    runtimeAdapter,
  });

  assertEquals(result.success, true);
  assertEquals(calls.length, 2);
  assertEquals(calls[0].resumeSessionId, undefined);
  assertEquals(calls[1].resumeSessionId, "ses_test");
});

Deno.test("runAgent — forwards hitlConfig to runtime adapter", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const calls: RuntimeInvokeOptions[] = [];

  const runtimeAdapter: RuntimeAdapter = {
    id: "opencode",
    capabilities: {
      permissionMode: false,
      hitl: true,
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
    invoke: (opts) => {
      calls.push(opts);
      return Promise.resolve({
        output: {
          runtime: "opencode",
          result: "done",
          session_id: "ses_test",
          total_cost_usd: 0.01,
          duration_ms: 100,
          duration_api_ms: 100,
          num_turns: 1,
          is_error: false,
        },
      });
    },
  };

  const result = await runAgent({
    node: {
      type: "agent",
      label: "Build",
      prompt: "build",
    } as NodeConfig,
    ctx: makeCtx(nodeDir),
    settings: makeSettings(),
    runtime: "opencode",
    runtimeAdapter,
    hitlConfig: {
      ask_script: "ask.sh",
      check_script: "check.sh",
      poll_interval: 60,
      timeout: 120,
    },
  });

  assertEquals(result.success, true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].hitlConfig?.ask_script, "ask.sh");
  assertEquals(calls[0].hitlConfig?.check_script, "check.sh");
});
