import { assertEquals } from "@std/assert";
import { runHuman } from "./human.ts";
import type { UserInput } from "./human.ts";
import type { NodeConfig, TemplateContext } from "./types.ts";

function makeCtx(): TemplateContext {
  return {
    node_dir: "/tmp/test-human-node",
    run_dir: "/tmp/test-run",
    run_id: "test-run",
    workDir: ".",
    args: { prompt: "fix login" },
    env: {},
    input: { spec: "/tmp/test-run/spec" },
  };
}

function mockInput(response: string): UserInput {
  return {
    prompt: (_msg: string) => Promise.resolve(response),
  };
}

Deno.test("runHuman — approve option", async () => {
  const node: NodeConfig = {
    type: "human",
    label: "Review",
    question: "Approve changes for prompt '{{args.prompt}}'?",
    options: ["approve", "reject"],
    abort_on: ["reject"],
  };

  const result = await runHuman(node, makeCtx(), mockInput("1"));

  assertEquals(result.success, true);
  assertEquals(result.response, "approve");
  assertEquals(result.aborted, false);
});

Deno.test("runHuman — reject option triggers abort", async () => {
  const node: NodeConfig = {
    type: "human",
    label: "Review",
    question: "Approve changes?",
    options: ["approve", "reject"],
    abort_on: ["reject"],
  };

  const result = await runHuman(node, makeCtx(), mockInput("2"));

  assertEquals(result.success, false);
  assertEquals(result.response, "reject");
  assertEquals(result.aborted, true);
});

Deno.test("runHuman — free text response (no options)", async () => {
  const node: NodeConfig = {
    type: "human",
    label: "Feedback",
    question: "Any feedback on the spec?",
  };

  const result = await runHuman(node, makeCtx(), mockInput("Looks good to me"));

  assertEquals(result.success, true);
  assertEquals(result.response, "Looks good to me");
  assertEquals(result.aborted, false);
});

Deno.test("runHuman — free text with options (non-numeric input)", async () => {
  const node: NodeConfig = {
    type: "human",
    label: "Review",
    question: "Approve?",
    options: ["approve", "reject"],
    abort_on: ["reject"],
  };

  const result = await runHuman(node, makeCtx(), mockInput("custom response"));

  assertEquals(result.success, true);
  assertEquals(result.response, "custom response");
  assertEquals(result.aborted, false);
});

Deno.test("runHuman — no abort_on configured", async () => {
  const node: NodeConfig = {
    type: "human",
    label: "Input",
    question: "Enter value:",
    options: ["yes", "no"],
  };

  const result = await runHuman(node, makeCtx(), mockInput("2"));

  assertEquals(result.success, true);
  assertEquals(result.response, "no");
  assertEquals(result.aborted, false);
});

Deno.test("runHuman — template variables in question", async () => {
  let capturedMessage = "";
  const input: UserInput = {
    prompt: (msg: string) => {
      capturedMessage = msg;
      return Promise.resolve("approve");
    },
  };

  const node: NodeConfig = {
    type: "human",
    label: "Review",
    question:
      "Review spec at {{input.spec}}/01-spec.md for prompt '{{args.prompt}}'?",
    options: ["approve", "reject"],
    abort_on: ["reject"],
  };

  await runHuman(node, makeCtx(), input);

  assertEquals(
    capturedMessage.includes("/tmp/test-run/spec/01-spec.md"),
    true,
  );
  assertEquals(capturedMessage.includes("fix login"), true);
});

Deno.test("runHuman — option index out of range uses raw input", async () => {
  const node: NodeConfig = {
    type: "human",
    label: "Review",
    question: "Choose:",
    options: ["a", "b"],
    abort_on: [],
  };

  const result = await runHuman(node, makeCtx(), mockInput("5"));

  // Index 5 is out of range (only 2 options), so raw input "5" is used
  assertEquals(result.response, "5");
});
