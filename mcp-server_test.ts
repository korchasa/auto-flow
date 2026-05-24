/**
 * FR-E73: Embedded MCP server tests. Each test wires an `InMemoryTransport`
 * pair between a `Client` and `runMcpServer`, so the SDK protocol code runs
 * end-to-end without a subprocess.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { applyJsonPointerOp, runMcpServer } from "./mcp-server.ts";
import { RunJournalWriter } from "./run-journal.ts";
import {
  createRunState,
  getNodeDir,
  getRunDir,
  markRunCompleted,
} from "./state.ts";
import { nodeCompleted, nodeStarted } from "./node-lifecycle.ts";
import { defaultLockPath } from "./lock.ts";

// --- Fixture helpers ---

interface Fixture {
  workflowDir: string;
  completedRunId: string;
  cleanup: () => Promise<void>;
}

const FIXTURE_WORKFLOW_YAML = `name: fr-e73-test
version: "1"
nodes:
  build:
    type: agent
    label: Build
    prompt: dummy
`;

async function setupFixtureWorkflow(): Promise<Fixture> {
  const workflowDir = await Deno.makeTempDir({ prefix: "fr-e73-" });
  await Deno.writeTextFile(
    join(workflowDir, "workflow.yaml"),
    FIXTURE_WORKFLOW_YAML,
  );

  const completedRunId = "run-completed";
  const runDir = getRunDir(completedRunId, workflowDir);
  await Deno.mkdir(runDir, { recursive: true });
  const writer = await RunJournalWriter.open(runDir, completedRunId);
  await writer.append({
    kind: "run_started",
    config_path: "workflow.yaml",
    started_at: "2026-05-24T00:00:00.000Z",
    ts: "2026-05-24T00:00:00.000Z",
    args: {},
    env: {},
  });
  await writer.append({
    kind: "workflow_loaded",
    config_path: "workflow.yaml",
    name: "fr-e73-test",
    version: "1",
  });
  await writer.append({
    kind: "node_declared",
    node_id: "build",
    node_type: "agent",
    label: "Build",
  });
  const nodeDir = getNodeDir(completedRunId, "build", workflowDir);
  await Deno.mkdir(nodeDir, { recursive: true });
  await writer.append({
    kind: "node_directory_declared",
    node_id: "build",
    node_dir: nodeDir,
  });
  const state = createRunState(
    completedRunId,
    "workflow.yaml",
    ["build"],
    {},
    {},
  );
  await nodeStarted(state, "build", undefined, writer);
  await nodeCompleted(state, "build", 0.12, "done", undefined, writer);
  markRunCompleted(state);
  await writer.append({
    kind: "run_completed",
    status: "completed",
    completed_at: state.completed_at!,
  });

  // Write a sample artifact for tail_artifacts.
  await Deno.writeTextFile(
    join(nodeDir, "out.log"),
    Array.from({ length: 10 }, (_, i) => `line-${i + 1}`).join("\n") + "\n",
  );

  return {
    workflowDir,
    completedRunId,
    cleanup: () => Deno.remove(workflowDir, { recursive: true }),
  };
}

/** Wire a client to a fresh server instance over linked InMemoryTransport. */
async function startServerWithClient(workflowDir: string): Promise<{
  client: Client;
  shutdown: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport
    .createLinkedPair();
  await runMcpServer(workflowDir, { transport: serverTransport });
  const client = new Client({ name: "fr-e73-test-client", version: "0" });
  await client.connect(clientTransport);
  return {
    client,
    shutdown: () => client.close(),
  };
}

function parseToolJson(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

// --- Tests ---

Deno.test("FR-E73 mcp-server registers all seven tools with expected names", async () => {
  const fixture = await setupFixtureWorkflow();
  try {
    const { client, shutdown } = await startServerWithClient(
      fixture.workflowDir,
    );
    const tools = await client.listTools();
    const names = tools.tools.map((t: { name: string }) => t.name).sort();
    assertEquals(names, [
      "apply_workflow_patch",
      "cancel_run",
      "get_state",
      "get_workflow",
      "list_runs",
      "resume_node",
      "tail_artifacts",
    ]);
    await shutdown();
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("FR-E73 get_workflow returns parsed workflow.yaml", async () => {
  const fixture = await setupFixtureWorkflow();
  try {
    const { client, shutdown } = await startServerWithClient(
      fixture.workflowDir,
    );
    const result = await client.callTool({
      name: "get_workflow",
      arguments: {},
    });
    const parsed = parseToolJson(
      result as { content: Array<{ text: string }> },
    ) as { name: string; version: string };
    assertEquals(parsed.name, "fr-e73-test");
    assertEquals(parsed.version, "1");
    await shutdown();
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("FR-E73 get_state replays journal for the given run_id", async () => {
  const fixture = await setupFixtureWorkflow();
  try {
    const { client, shutdown } = await startServerWithClient(
      fixture.workflowDir,
    );
    const result = await client.callTool({
      name: "get_state",
      arguments: { run_id: fixture.completedRunId },
    });
    const state = parseToolJson(
      result as { content: Array<{ text: string }> },
    ) as { run_id: string; status: string; nodes: Record<string, unknown> };
    assertEquals(state.run_id, fixture.completedRunId);
    assertEquals(state.status, "completed");
    assert("build" in state.nodes);
    await shutdown();
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("FR-E73 list_runs returns one entry per run subdirectory", async () => {
  const fixture = await setupFixtureWorkflow();
  try {
    const { client, shutdown } = await startServerWithClient(
      fixture.workflowDir,
    );
    const result = await client.callTool({ name: "list_runs", arguments: {} });
    const entries = parseToolJson(
      result as { content: Array<{ text: string }> },
    ) as Array<{ run_id: string; status: string; node_count: number }>;
    assertEquals(entries.length, 1);
    assertEquals(entries[0].run_id, fixture.completedRunId);
    assertEquals(entries[0].status, "completed");
    assertEquals(entries[0].node_count, 1);
    await shutdown();
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("FR-E73 tail_artifacts honours `lines` parameter", async () => {
  const fixture = await setupFixtureWorkflow();
  try {
    const { client, shutdown } = await startServerWithClient(
      fixture.workflowDir,
    );
    const result = await client.callTool({
      name: "tail_artifacts",
      arguments: {
        run_id: fixture.completedRunId,
        node_id: "build",
        filename: "out.log",
        lines: 3,
      },
    });
    const payload = parseToolJson(
      result as { content: Array<{ text: string }> },
    ) as { lines: string[] };
    assertEquals(payload.lines, ["line-8", "line-9", "line-10"]);
    await shutdown();
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("FR-E73 resume_node returns an error when no journal is found", async () => {
  // We can't easily drive a real engine run through the MCP surface in a
  // unit test (it'd spawn a Claude CLI subprocess). Instead, exercise the
  // tool's error path: resuming a non-existent run_id surfaces a tool-
  // level error rather than crashing the transport.
  const fixture = await setupFixtureWorkflow();
  try {
    const { client, shutdown } = await startServerWithClient(
      fixture.workflowDir,
    );
    const result = await client.callTool({
      name: "resume_node",
      arguments: { run_id: "nonexistent" },
    }) as { isError?: boolean; content: Array<{ text: string }> };
    assertEquals(result.isError, true);
    assert(result.content[0].text.length > 0);
    await shutdown();
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("FR-E73 cancel_run rejects mismatched run_id", async () => {
  const fixture = await setupFixtureWorkflow();
  try {
    // Plant a lock file pointing at the current Deno process. We never call
    // SIGTERM on ourselves because the run_id is different.
    const lockPath = defaultLockPath(fixture.workflowDir);
    await Deno.mkdir(join(fixture.workflowDir, "runs"), { recursive: true });
    await Deno.writeTextFile(
      lockPath,
      JSON.stringify({
        pid: Deno.pid,
        hostname: "test",
        run_id: "other-run",
        started_at: new Date().toISOString(),
      }),
    );

    const { client, shutdown } = await startServerWithClient(
      fixture.workflowDir,
    );
    const result = await client.callTool({
      name: "cancel_run",
      arguments: { run_id: "wrong-run" },
    }) as { isError?: boolean; content: Array<{ text: string }> };
    assertEquals(result.isError, true);
    assertStringIncludes(result.content[0].text, "no matching active run");
    await shutdown();
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("FR-E73 cancel_run treats already-gone process as success", async () => {
  const fixture = await setupFixtureWorkflow();
  try {
    // Use a PID that is virtually guaranteed not to exist (Int32 max).
    // `Deno.kill(0, …)` would broadcast to the process group on POSIX
    // and TERM the test runner itself.
    const ghostPid = 0x7fffffff;
    const lockPath = defaultLockPath(fixture.workflowDir);
    await Deno.mkdir(join(fixture.workflowDir, "runs"), { recursive: true });
    await Deno.writeTextFile(
      lockPath,
      JSON.stringify({
        pid: ghostPid,
        hostname: "test",
        run_id: "ghost-run",
        started_at: new Date().toISOString(),
      }),
    );

    const { client, shutdown } = await startServerWithClient(
      fixture.workflowDir,
    );
    const result = await client.callTool({
      name: "cancel_run",
      arguments: { run_id: "ghost-run" },
    }) as { content: Array<{ text: string }>; isError?: boolean };
    const payload = JSON.parse(result.content[0].text) as {
      cancelled: boolean;
      pid: number;
      reason?: string;
    };
    assertEquals(payload.cancelled, false);
    assertEquals(payload.pid, ghostPid);
    assertStringIncludes(payload.reason ?? "", "already gone");
    await shutdown();
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("FR-E73 apply_workflow_patch rejects ops on the version key", async () => {
  const fixture = await setupFixtureWorkflow();
  try {
    const { client, shutdown } = await startServerWithClient(
      fixture.workflowDir,
    );
    const result = await client.callTool({
      name: "apply_workflow_patch",
      arguments: {
        operations: [{ op: "remove", path: "/version" }],
      },
    }) as { isError?: boolean; content: Array<{ text: string }> };
    assertEquals(result.isError, true);
    assertStringIncludes(result.content[0].text, "not patchable");
    // workflow.yaml was not modified.
    const text = await Deno.readTextFile(
      join(fixture.workflowDir, "workflow.yaml"),
    );
    const parsed = parseYaml(text) as { version: string };
    assertEquals(parsed.version, "1");
    await shutdown();
  } finally {
    await fixture.cleanup();
  }
});

Deno.test("FR-E73 apply_workflow_patch applies add op and writes back", async () => {
  const fixture = await setupFixtureWorkflow();
  try {
    const { client, shutdown } = await startServerWithClient(
      fixture.workflowDir,
    );
    const result = await client.callTool({
      name: "apply_workflow_patch",
      arguments: {
        operations: [
          { op: "add", path: "/description", value: "test-description" },
        ],
      },
    }) as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0].text) as { applied: number };
    assertEquals(payload.applied, 1);
    const text = await Deno.readTextFile(
      join(fixture.workflowDir, "workflow.yaml"),
    );
    const parsed = parseYaml(text) as { description: string };
    assertEquals(parsed.description, "test-description");
    await shutdown();
  } finally {
    await fixture.cleanup();
  }
});

// --- applyJsonPointerOp unit tests ---

Deno.test("FR-E73 applyJsonPointerOp rejects root pointer", () => {
  const doc: Record<string, unknown> = { foo: 1 };
  let threw = false;
  try {
    applyJsonPointerOp(doc, { op: "replace", path: "/", value: {} });
  } catch (e) {
    threw = true;
    assertStringIncludes((e as Error).message, "root pointer");
  }
  assertEquals(threw, true);
});

Deno.test("FR-E73 applyJsonPointerOp adds nested key", () => {
  const doc: Record<string, unknown> = { nodes: { build: { label: "Build" } } };
  applyJsonPointerOp(doc, {
    op: "add",
    path: "/nodes/build/prompt",
    value: "do it",
  });
  assertEquals(
    (doc.nodes as Record<string, Record<string, unknown>>).build.prompt,
    "do it",
  );
});

Deno.test("FR-E73 applyJsonPointerOp removes existing key", () => {
  const doc: Record<string, unknown> = { foo: 1, bar: 2 };
  applyJsonPointerOp(doc, { op: "remove", path: "/foo" });
  assertEquals("foo" in doc, false);
  assertEquals(doc.bar, 2);
});

Deno.test(
  "FR-E74 server starts in no-workflow mode and surfaces missing-workflow error on tool call",
  async () => {
    const [clientTransport, serverTransport] = InMemoryTransport
      .createLinkedPair();
    await runMcpServer(undefined, {
      transport: serverTransport,
      noWorkflow: true,
    });
    const client = new Client({ name: "fr-e74-test-client", version: "0" });
    await client.connect(clientTransport);
    try {
      // All seven tools must still be advertised so the MCP handshake
      // completes; otherwise Claude Code shows an opaque "server crashed"
      // diagnostic instead of the missing-workflow message.
      const tools = await client.listTools();
      assertEquals(tools.tools.length, 7);

      const result = await client.callTool({
        name: "get_workflow",
        arguments: {},
      });
      // Tool call surfaces the structured no-workflow error.
      const r = result as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };
      assertEquals(r.isError, true);
      const text = r.content[0].text;
      // Must point the user at the actionable next step.
      if (!/init/i.test(text) || !/flowai-workflow/i.test(text)) {
        throw new Error(
          `expected missing-workflow error mentioning init+flowai-workflow; got: ${text}`,
        );
      }
    } finally {
      await client.close();
    }
  },
);
