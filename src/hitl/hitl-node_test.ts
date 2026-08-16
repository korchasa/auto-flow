import { assertEquals, assertStringIncludes } from "@std/assert";
import { runHitlNode } from "./hitl-node.ts";
import type { HitlConfig, NodeConfig, TemplateContext } from "../types.ts";
import type { ScriptRunner } from "./hitl.ts";

function hitlConfig(overrides: Partial<HitlConfig> = {}): HitlConfig {
  return {
    ask_script: "ask.sh",
    check_script: "check.sh",
    poll_interval: 0,
    timeout: 5,
    ...overrides,
  };
}

function node(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return {
    type: "hitl",
    label: "Approve",
    question: "Approve the plan?",
    ...overrides,
  };
}

async function withCtx<T>(
  fn: (ctx: TemplateContext, dir: string) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir();
  try {
    return await fn({
      node_dir: dir,
      run_dir: dir,
      run_id: "r1",
      workDir: ".",
      args: {},
      env: {},
      input: {},
    }, dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Script runner that answers on the Nth check call and records every call. */
function scriptedRunner(
  reply: string,
  answerOnCall = 1,
): { runner: ScriptRunner; calls: { path: string; args: string[] }[] } {
  const calls: { path: string; args: string[] }[] = [];
  let checks = 0;
  const runner: ScriptRunner = (path, args) => {
    calls.push({ path, args });
    if (path.includes("check")) {
      checks++;
      return Promise.resolve({
        exitCode: 0,
        stdout: checks >= answerOnCall ? reply : "",
      });
    }
    return Promise.resolve({ exitCode: 0, stdout: "" });
  };
  return { runner, calls };
}

Deno.test("FR-E93 runHitlNode — delivers the question and returns the reply", async () => {
  await withCtx(async (ctx, dir) => {
    const { runner, calls } = scriptedRunner("approve");
    const result = await runHitlNode(node(), ctx, hitlConfig(), {
      nodeId: "approve",
      runDir: dir,
      scriptRunner: runner,
    });

    assertEquals(result.success, true);
    assertEquals(result.response, "approve");
    assertEquals(result.aborted, false);
    assertEquals(
      (await Deno.readTextFile(`${dir}/response.txt`)).trim(),
      "approve",
    );

    const ask = calls.find((c) => c.path === "ask.sh");
    assertEquals(ask !== undefined, true);
    const questionJson = ask!.args[ask!.args.indexOf("--question-json") + 1];
    assertStringIncludes(questionJson, "Approve the plan?");
  });
});

Deno.test("FR-E93 runHitlNode — interpolates the question before delivering it", async () => {
  await withCtx(async (ctx, dir) => {
    const { runner, calls } = scriptedRunner("ok");
    await runHitlNode(
      node({ question: "Ship {{args.version}}?" }),
      { ...ctx, args: { version: "1.2.3" } },
      hitlConfig(),
      { nodeId: "ship", runDir: dir, scriptRunner: runner },
    );

    const ask = calls.find((c) => c.path === "ask.sh")!;
    assertStringIncludes(
      ask.args[ask.args.indexOf("--question-json") + 1],
      "Ship 1.2.3?",
    );
  });
});

Deno.test("FR-E93 runHitlNode — a reply in abort_on aborts the run", async () => {
  await withCtx(async (ctx, dir) => {
    const { runner } = scriptedRunner("reject");
    const result = await runHitlNode(
      node({ options: ["approve", "reject"], abort_on: ["reject"] }),
      ctx,
      hitlConfig(),
      { nodeId: "approve", runDir: dir, scriptRunner: runner },
    );

    assertEquals(result.aborted, true);
    assertEquals(result.success, false);
  });
});

Deno.test("FR-E93 runHitlNode — an option number resolves to the option text", async () => {
  await withCtx(async (ctx, dir) => {
    const { runner } = scriptedRunner("2");
    const result = await runHitlNode(
      node({ options: ["approve", "reject"] }),
      ctx,
      hitlConfig(),
      { nodeId: "approve", runDir: dir, scriptRunner: runner },
    );

    assertEquals(result.response, "reject");
  });
});

Deno.test("FR-E93 runHitlNode — keeps polling until an answer arrives", async () => {
  await withCtx(async (ctx, dir) => {
    const { runner, calls } = scriptedRunner("later", 3);
    const result = await runHitlNode(node(), ctx, hitlConfig(), {
      nodeId: "approve",
      runDir: dir,
      scriptRunner: runner,
    });

    assertEquals(result.response, "later");
    assertEquals(calls.filter((c) => c.path === "check.sh").length, 3);
  });
});

Deno.test("FR-E93 runHitlNode — a local inbox reply wins over the transport", async () => {
  await withCtx(async (ctx, dir) => {
    await Deno.mkdir(`${dir}/.hitl-inbox`, { recursive: true });
    await Deno.writeTextFile(`${dir}/.hitl-inbox/approve.txt`, "from-inbox\n");

    const { runner, calls } = scriptedRunner("from-transport");
    const result = await runHitlNode(node(), ctx, hitlConfig(), {
      nodeId: "approve",
      runDir: dir,
      scriptRunner: runner,
    });

    assertEquals(result.response, "from-inbox");
    assertEquals(calls.filter((c) => c.path === "check.sh").length, 0);
  });
});

Deno.test("FR-E93 runHitlNode — no answer within the timeout fails as hitl_timeout", async () => {
  await withCtx(async (ctx, dir) => {
    const { runner } = scriptedRunner("never", 1000);
    const result = await runHitlNode(
      node(),
      ctx,
      hitlConfig({ timeout: 0 }),
      { nodeId: "approve", runDir: dir, scriptRunner: runner },
    );

    assertEquals(result.success, false);
    assertEquals(result.error_category, "hitl_timeout");
  });
});

Deno.test("FR-E93 runHitlNode — a failing ask_script fails the node with its stderr", async () => {
  await withCtx(async (ctx, dir) => {
    const runner: ScriptRunner = (path) =>
      Promise.resolve(
        path === "ask.sh"
          ? { exitCode: 3, stdout: "", stderr: "telegram unreachable" }
          : { exitCode: 0, stdout: "" },
      );
    const result = await runHitlNode(node(), ctx, hitlConfig(), {
      nodeId: "approve",
      runDir: dir,
      scriptRunner: runner,
    });

    assertEquals(result.success, false);
    assertStringIncludes(result.error ?? "", "telegram unreachable");
  });
});

Deno.test("FR-E93 runHitlNode — unconfigured HITL scripts fail with a clear message", async () => {
  await withCtx(async (ctx, dir) => {
    const result = await runHitlNode(
      node(),
      ctx,
      hitlConfig({ ask_script: "" }),
      { nodeId: "approve", runDir: dir },
    );

    assertEquals(result.success, false);
    assertStringIncludes(result.error ?? "", "defaults.hitl");
  });
});

Deno.test("FR-E93 runHitlNode — records the exchange in the node's hitl.jsonl", async () => {
  await withCtx(async (ctx, dir) => {
    const { runner } = scriptedRunner("approve");
    await runHitlNode(node(), ctx, hitlConfig(), {
      nodeId: "approve",
      runDir: dir,
      scriptRunner: runner,
    });

    const audit = JSON.parse(
      (await Deno.readTextFile(`${dir}/hitl.jsonl`)).trim(),
    );
    assertEquals(audit.reply, "approve");
    assertStringIncludes(JSON.stringify(audit.question), "Approve the plan?");
  });
});
