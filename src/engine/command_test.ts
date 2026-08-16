import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { runCommandNode } from "./command.ts";
import { runLoop } from "./loop.ts";
import { createRunState } from "../state/state.ts";
import type {
  NodeConfig,
  ResolvedNodeSettings,
  TemplateContext,
  WorkflowConfig,
} from "../types.ts";

function settings(
  overrides: Partial<ResolvedNodeSettings> = {},
): ResolvedNodeSettings {
  return {
    max_continuations: 3,
    timeout_seconds: 30,
    on_error: "fail",
    max_retries: 3,
    retry_delay_seconds: 5,
    ...overrides,
  };
}

function node(command: string): NodeConfig {
  return { type: "command", label: "Run it", command };
}

async function withNodeDir<T>(
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

Deno.test("FR-E88 runCommandNode — exit 0 succeeds", async () => {
  await withNodeDir(async (ctx) => {
    const result = await runCommandNode(node("true"), ctx, settings());
    assertEquals(result.success, true);
    assertEquals(result.code, 0);
    assertEquals(result.error, undefined);
  });
});

Deno.test("FR-E88 runCommandNode — non-zero exit fails with command_failed", async () => {
  await withNodeDir(async (ctx) => {
    const result = await runCommandNode(node("exit 7"), ctx, settings());
    assertEquals(result.success, false);
    assertEquals(result.code, 7);
    assertEquals(result.error_category, "command_failed");
    assertStringIncludes(result.error ?? "", "exit 7");
  });
});

Deno.test("FR-E88 runCommandNode — persists stdout, stderr and exit code as artifacts", async () => {
  await withNodeDir(async (ctx, dir) => {
    await runCommandNode(
      node("echo out; echo err >&2; exit 2"),
      ctx,
      settings(),
    );
    assertEquals((await Deno.readTextFile(`${dir}/stdout.txt`)).trim(), "out");
    assertEquals((await Deno.readTextFile(`${dir}/stderr.txt`)).trim(), "err");
    assertEquals((await Deno.readTextFile(`${dir}/exit_code.txt`)).trim(), "2");
  });
});

Deno.test("FR-E88 runCommandNode — interpolates template variables", async () => {
  await withNodeDir(async (ctx, dir) => {
    const result = await runCommandNode(
      node('echo "{{run_id}}" > "{{node_dir}}/stamp.txt"'),
      ctx,
      settings(),
    );
    assertEquals(result.success, true);
    assertEquals((await Deno.readTextFile(`${dir}/stamp.txt`)).trim(), "r1");
  });
});

Deno.test("FR-E88 runCommandNode — runs in the supplied cwd", async () => {
  await withNodeDir(async (ctx) => {
    const cwd = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(`${cwd}/here.txt`, "x");
      const inside = await runCommandNode(
        node("test -f here.txt"),
        ctx,
        settings(),
        cwd,
      );
      assertEquals(inside.success, true);
    } finally {
      await Deno.remove(cwd, { recursive: true });
    }
  });
});

Deno.test("FR-E88 runCommandNode — exceeding timeout_seconds fails as timeout", async () => {
  await withNodeDir(async (ctx) => {
    const result = await runCommandNode(
      node("sleep 30"),
      ctx,
      settings({ timeout_seconds: 1 }),
    );
    assertEquals(result.success, false);
    assertEquals(result.error_category, "timeout");
    assertStringIncludes(result.error ?? "", "1s");
  });
});

Deno.test("FR-E88 runCommandNode — unresolved template variable fails fast", async () => {
  await withNodeDir(async (ctx) => {
    await assertRejects(
      () => runCommandNode(node("echo {{args.nope}}"), ctx, settings()),
      Error,
      "Unknown CLI argument",
    );
  });
});

Deno.test("FR-E88 runCommandNode — rejects a node that is not a command node", async () => {
  await withNodeDir(async (ctx) => {
    await assertRejects(
      () =>
        runCommandNode(
          { type: "agent", label: "a", prompt: "p" },
          ctx,
          settings(),
        ),
      Error,
      "not a command node",
    );
  });
});

// --- Loop-body integration (FR-E88) ---------------------------------------

Deno.test("FR-E88 a command body node drives a loop to its until-exit", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const settings: ResolvedNodeSettings = {
      max_continuations: 1,
      timeout_seconds: 30,
      on_error: "fail",
      max_retries: 1,
      retry_delay_seconds: 1,
    };
    const config: WorkflowConfig = {
      name: "cmd-loop",
      version: "1",
      nodes: {
        "fix-loop": {
          type: "loop",
          label: "Fix Loop",
          // Exits once the body has appended three marks to the counter file.
          until: `test $(wc -l < "${tmpDir}/counter.txt") -ge 3`,
          max_iterations: 5,
          nodes: {
            bump: {
              type: "command",
              label: "Bump",
              command: `echo mark >> "${tmpDir}/counter.txt"`,
              settings,
            } as NodeConfig,
          },
        } as NodeConfig,
      },
    };
    const state = createRunState(
      "run-cmd-loop",
      "cfg.yaml",
      ["fix-loop", "bump"],
      {},
      {},
    );

    const result = await runLoop({
      loopNodeId: "fix-loop",
      config,
      state,
      buildCtx: (nodeId, iteration) => {
        const nodeDir = `${tmpDir}/${nodeId}-${iteration}`;
        Deno.mkdirSync(nodeDir, { recursive: true });
        return {
          node_dir: nodeDir,
          run_dir: tmpDir,
          run_id: "run-cmd-loop",
          workDir: ".",
          args: {},
          env: {},
          input: {},
        };
      },
    });

    assertEquals(result.success, true);
    assertEquals(result.iterations, 3);
    assertEquals(result.exit_reason, "until_satisfied");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("FR-E88 a failing command body node fails the loop", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const settings: ResolvedNodeSettings = {
      max_continuations: 1,
      timeout_seconds: 30,
      on_error: "fail",
      max_retries: 1,
      retry_delay_seconds: 1,
    };
    const config: WorkflowConfig = {
      name: "cmd-loop-fail",
      version: "1",
      nodes: {
        "fix-loop": {
          type: "loop",
          label: "Fix Loop",
          until: "true",
          max_iterations: 2,
          nodes: {
            bump: {
              type: "command",
              label: "Bump",
              command: "exit 4",
              settings,
            } as NodeConfig,
          },
        } as NodeConfig,
      },
    };
    const state = createRunState(
      "run-cmd-loop-fail",
      "cfg.yaml",
      ["fix-loop", "bump"],
      {},
      {},
    );

    const result = await runLoop({
      loopNodeId: "fix-loop",
      config,
      state,
      buildCtx: (nodeId, iteration) => {
        const nodeDir = `${tmpDir}/${nodeId}-${iteration}`;
        Deno.mkdirSync(nodeDir, { recursive: true });
        return {
          node_dir: nodeDir,
          run_dir: tmpDir,
          run_id: "run-cmd-loop-fail",
          workDir: ".",
          args: {},
          env: {},
          input: {},
        };
      },
    });

    assertEquals(result.success, false);
    assertEquals(result.error_category, "command_failed");
    assertEquals(state.nodes.bump.status, "failed");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
