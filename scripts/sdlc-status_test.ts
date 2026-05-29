import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import {
  formatStatusText,
  loadWorkflowStatus,
  pidAlive,
} from "./sdlc-status.ts";

async function withTempDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "sdlc-status-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("pidAlive returns false for impossible pid", () => {
  assertEquals(pidAlive(2_147_483_646), false);
});

Deno.test("pidAlive returns true for current process", () => {
  assertEquals(pidAlive(Deno.pid), true);
});

Deno.test("loadWorkflowStatus returns null lock and null run for empty workflow", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "runs"), { recursive: true });
    const status = await loadWorkflowStatus(dir);
    assertEquals(status.workflow, dir);
    assertEquals(status.lock, null);
    assertEquals(status.run, null);
  });
});

Deno.test("loadWorkflowStatus parses lock and state.json", async () => {
  await withTempDir(async (dir) => {
    const runId = "20260527T115419";
    const runDir = join(dir, "runs", runId);
    await Deno.mkdir(runDir, { recursive: true });
    await Deno.writeTextFile(
      join(dir, "runs", ".lock"),
      JSON.stringify({
        pid: Deno.pid,
        hostname: "test",
        run_id: runId,
        started_at: "2026-05-27T11:54:19.000Z",
      }),
    );
    await Deno.writeTextFile(
      join(runDir, "state.json"),
      JSON.stringify({
        run_id: runId,
        config_path: "workflow.yaml",
        started_at: "2026-05-27T11:54:19.000Z",
        status: "running",
        args: {},
        env: {},
        nodes: {
          specification: { status: "completed" },
          design: { status: "running", started_at: "2026-05-27T11:58:00Z" },
        },
      }),
    );
    const status = await loadWorkflowStatus(dir);
    assertExists(status.lock);
    assertEquals(status.lock?.pid, Deno.pid);
    assertEquals(status.lock?.run_id, runId);
    assertEquals(status.lock?.alive, true);
    assertExists(status.run);
    assertEquals(status.run?.id, runId);
    assertEquals(status.run?.status, "running");
    assertEquals(status.run?.current_node, "design");
    assertEquals(status.run?.nodes.specification, "completed");
  });
});

Deno.test("loadWorkflowStatus picks newest run when lock is missing", async () => {
  await withTempDir(async (dir) => {
    const older = join(dir, "runs", "20260101T000000");
    const newer = join(dir, "runs", "20260601T000000");
    await Deno.mkdir(older, { recursive: true });
    await Deno.mkdir(newer, { recursive: true });
    await Deno.writeTextFile(
      join(older, "state.json"),
      JSON.stringify({
        run_id: "20260101T000000",
        config_path: "x",
        started_at: "2026-01-01T00:00:00Z",
        status: "completed",
        args: {},
        env: {},
        nodes: {},
      }),
    );
    await Deno.writeTextFile(
      join(newer, "state.json"),
      JSON.stringify({
        run_id: "20260601T000000",
        config_path: "x",
        started_at: "2026-06-01T00:00:00Z",
        status: "failed",
        args: {},
        env: {},
        nodes: { build: { status: "failed", error: "boom" } },
      }),
    );
    const status = await loadWorkflowStatus(dir);
    assertEquals(status.lock, null);
    assertEquals(status.run?.id, "20260601T000000");
    assertEquals(status.run?.status, "failed");
    assertEquals(status.run?.error, "boom");
  });
});

Deno.test("loadWorkflowStatus honors explicit run id", async () => {
  await withTempDir(async (dir) => {
    const a = join(dir, "runs", "20260101T000000");
    const b = join(dir, "runs", "20260601T000000");
    await Deno.mkdir(a, { recursive: true });
    await Deno.mkdir(b, { recursive: true });
    for (const [d, id] of [[a, "20260101T000000"], [b, "20260601T000000"]]) {
      await Deno.writeTextFile(
        join(d, "state.json"),
        JSON.stringify({
          run_id: id,
          config_path: "x",
          started_at: "2026-01-01T00:00:00Z",
          status: "completed",
          args: {},
          env: {},
          nodes: {},
        }),
      );
    }
    const status = await loadWorkflowStatus(dir, "20260101T000000");
    assertEquals(status.run?.id, "20260101T000000");
  });
});

Deno.test("loadWorkflowStatus reads journal tail when present", async () => {
  await withTempDir(async (dir) => {
    const runId = "20260527T115419";
    const runDir = join(dir, "runs", runId);
    await Deno.mkdir(runDir, { recursive: true });
    await Deno.writeTextFile(
      join(runDir, "state.json"),
      JSON.stringify({
        run_id: runId,
        config_path: "x",
        started_at: "2026-05-27T11:54:19Z",
        status: "running",
        args: {},
        env: {},
        nodes: {},
      }),
    );
    const lines = Array.from(
      { length: 10 },
      (_, i) =>
        JSON.stringify({ ts: `2026-05-27T11:54:${20 + i}Z`, event: `e${i}` }),
    ).join("\n");
    await Deno.writeTextFile(join(runDir, "journal.jsonl"), lines + "\n");
    const status = await loadWorkflowStatus(dir, undefined, { journalTail: 3 });
    assertEquals(status.run?.journal_tail?.length, 3);
    assertEquals(status.run?.journal_tail?.[2].event, "e9");
  });
});

Deno.test("formatStatusText prints headers and key fields", () => {
  const text = formatStatusText({
    workflow: ".flowai-workflow/x",
    lock: {
      pid: 1234,
      run_id: "20260527T115419",
      alive: true,
      hostname: "h",
      started_at: "t",
    },
    run: {
      id: "20260527T115419",
      status: "running",
      started_at: "2026-05-27T11:54:19Z",
      current_node: "design",
      nodes: { specification: "completed", design: "running" },
    },
  });
  if (!text.includes(".flowai-workflow/x")) throw new Error("missing workflow");
  if (!text.includes("pid=1234")) throw new Error("missing pid");
  if (!text.includes("current=design")) throw new Error("missing current node");
  if (!text.includes("status=running")) throw new Error("missing run status");
});
