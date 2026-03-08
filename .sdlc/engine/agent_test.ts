import { assertEquals } from "jsr:@std/assert";
import type { AgentRunOptions } from "./agent.ts";
import type { NodeConfig, NodeSettings, TemplateContext } from "./types.ts";

// Note: Full integration tests for runAgent require a real claude CLI.
// These tests verify the module's helpers and data structures.
// Integration tests will be added when running with claude CLI available.

function makeSettings(): Required<NodeSettings> {
  return {
    max_continuations: 3,
    timeout_seconds: 1800,
    on_error: "fail",
    max_retries: 3,
    retry_delay_seconds: 5,
  };
}

function makeCtx(): TemplateContext {
  return {
    node_dir: "/tmp/test-node",
    run_dir: "/tmp/test-run",
    run_id: "test-run",
    args: { issue: "42" },
    env: {},
    input: {},
  };
}

Deno.test("AgentRunOptions — type structure compiles", () => {
  const node: NodeConfig = {
    type: "agent",
    label: "Test agent",
    prompt: ".sdlc/agents/test.md",
    task_template: "Do task for issue #{{args.issue}}",
    validate: [
      { type: "file_exists", path: "{{node_dir}}/output.md" },
    ],
    before: "echo before",
    after: "echo after",
  };

  const opts: AgentRunOptions = {
    node,
    ctx: makeCtx(),
    settings: makeSettings(),
    onOutput: (line: string) => console.log(line),
  };

  assertEquals(opts.node.type, "agent");
  assertEquals(opts.settings.max_continuations, 3);
});

Deno.test("AgentRunOptions — task_template interpolation structure", () => {
  const node: NodeConfig = {
    type: "agent",
    label: "Test",
    task_template:
      "Read {{input.spec}}/spec.md and implement changes. Output to {{node_dir}}/",
  };

  const ctx: TemplateContext = {
    ...makeCtx(),
    input: { spec: "/runs/test/spec" },
  };

  const opts: AgentRunOptions = {
    node,
    ctx,
    settings: makeSettings(),
  };

  assertEquals(opts.node.task_template!.includes("{{input.spec}}"), true);
  assertEquals(opts.ctx.input.spec, "/runs/test/spec");
});

Deno.test("AgentRunOptions — loop context available", () => {
  const ctx: TemplateContext = {
    ...makeCtx(),
    loop: { iteration: 2 },
  };

  assertEquals(ctx.loop!.iteration, 2);
});

Deno.test("settings — default values", () => {
  const settings = makeSettings();
  assertEquals(settings.max_continuations, 3);
  assertEquals(settings.timeout_seconds, 1800);
  assertEquals(settings.on_error, "fail");
  assertEquals(settings.max_retries, 3);
  assertEquals(settings.retry_delay_seconds, 5);
});
