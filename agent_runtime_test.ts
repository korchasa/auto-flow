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
      mcpInjection: false,
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

Deno.test("runAgent — registers HITL MCP server when hitlConfig + capabilities.mcpInjection", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const calls: RuntimeInvokeOptions[] = [];

  const runtimeAdapter: RuntimeAdapter = {
    id: "opencode",
    capabilities: {
      permissionMode: false,
      mcpInjection: true,
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
  // FR-L35 / ADR-0013: engine renders hitlConfig into the typed
  // mcpServers field plus an onToolUseObserved hook; the library
  // routes them to the runtime's native MCP injection. The legacy
  // hitlConfig / hitlMcpCommandBuilder fields no longer exist.
  const servers = calls[0].mcpServers;
  assertEquals(servers !== undefined, true);
  const entry = servers?.["flowai-workflow-hitl"];
  assertEquals(entry?.type, "stdio");
  assertEquals(typeof calls[0].onToolUseObserved, "function");
});

Deno.test(
  "runAgent — HITL question captured by observer breaks continuation loop early",
  async () => {
    // Regression: when the observer captures a HITL question on the first
    // invoke, runAgent must NOT enter the validation/continuation loop.
    // Previously the loop kept resuming, the resumed agent re-called the
    // HITL tool, the observer's `if (captured !== null) return "allow"`
    // guard let the second call through, the agent saw `{ok:true}` and
    // continued, the spec was never written, validation kept failing, and
    // the run exhausted max_continuations without ever surfacing the
    // captured question to handleAgentHitl.
    const nodeDir = Deno.makeTempDirSync();
    const outputPath = `${nodeDir}/01-spec.md`;
    const calls: RuntimeInvokeOptions[] = [];

    const runtimeAdapter: RuntimeAdapter = {
      id: "opencode",
      capabilities: {
        permissionMode: false,
        mcpInjection: true,
        transcript: false,
        interactive: false,
        toolUseObservation: true,
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
        // Simulate OpenCode observing the agent's MCP HITL tool call:
        // adapter routes the tool_use event through the engine's
        // `onToolUseObserved`. Returning "abort" must be honoured by
        // runAgent — the captured question is the run's terminal state.
        await opts.onToolUseObserved?.({
          runtime: "opencode",
          id: `tool-${calls.length}`,
          name: "flowai-workflow-hitl_request_human_input",
          input: {
            header: "Pick the next task",
            question: "Reply with a number 1-3.",
            options: [
              { label: "a", description: "S1" },
              { label: "b", description: "S2" },
              { label: "c", description: "S3" },
            ],
          },
          turn: 1,
        });
        return {
          output: {
            runtime: "opencode",
            result: "aborted by observer",
            session_id: "ses_test",
            total_cost_usd: 0.01,
            duration_ms: 100,
            duration_api_ms: 100,
            num_turns: 1,
            is_error: true,
            permission_denials: [
              {
                tool_name: "flowai-workflow-hitl_request_human_input",
                tool_use_id: `tool-${calls.length}`,
                tool_input: {},
              },
            ],
          },
        };
      },
    };

    const result = await runAgent({
      node: {
        type: "agent",
        label: "Spec",
        prompt: "write spec",
        // Validation that cannot pass without user input — exactly the
        // PM-stage scenario where the spec needs an HITL pick first.
        validate: [{ type: "file_exists", path: outputPath }],
      } as NodeConfig,
      ctx: makeCtx(nodeDir),
      settings: { ...makeSettings(), max_continuations: 5 },
      runtime: "opencode",
      runtimeAdapter,
      hitlConfig: {
        ask_script: "ask.sh",
        check_script: "check.sh",
        poll_interval: 60,
        timeout: 120,
      },
    });

    // Observer captured the question on the first invoke — the engine
    // MUST hand it back to the caller (node-dispatch routes it to
    // handleAgentHitl). Spinning the continuation loop would (a) waste
    // turns/budget, (b) corrupt the captured-once observer state on
    // resume, and (c) eventually fail with `continuations_exhausted`,
    // hiding the real reason from the caller.
    assertEquals(
      calls.length,
      1,
      `runAgent must invoke the adapter exactly once when HITL is captured; got ${calls.length}`,
    );
    assertEquals(result.hitl_question?.question, "Reply with a number 1-3.");
    assertEquals(result.hitl_question?.options?.length, 3);
    assertEquals(result.error_category, undefined);
  },
);
