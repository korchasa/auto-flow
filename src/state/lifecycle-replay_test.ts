import { assert, assertEquals, assertRejects } from "@std/assert";
import { Engine } from "../engine/engine.ts";
import {
  nodeCompleted,
  nodeFailed,
  nodeStarted,
} from "../engine/node-lifecycle.ts";
import {
  getJournalPath,
  loadStateFromJournal,
  replayRunJournal,
  RunJournalWriter,
} from "./run-journal.ts";
import { createRunState, markRunCompleted } from "./state.ts";
import type { NodeLifecycleEvent, RunJournalEvent } from "../types.ts";

async function appendRunStart(
  writer: RunJournalWriter,
  runId: string,
): Promise<void> {
  await writer.append({
    kind: "run_started",
    config_path: "workflow.yaml",
    started_at: "2026-05-17T00:00:00.000Z",
    ts: "2026-05-17T00:00:00.000Z",
    args: { issue: "218" },
    env: { MODE: "test" },
  });
  await writer.append({
    kind: "workflow_loaded",
    config_path: "workflow.yaml",
    name: "test-workflow",
    version: "1",
  });
  await writer.append({
    kind: "node_declared",
    node_id: "build",
    node_type: "agent",
    label: "Build",
  });
  await writer.append({
    kind: "node_directory_declared",
    node_id: "build",
    node_dir: `runs/${runId}/build`,
  });
}

Deno.test("lifecycle replay — persists ordered run and node lifecycle records", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = await RunJournalWriter.open(dir, "run-1");
    await appendRunStart(writer, "run-1");
    const state = createRunState("run-1", "workflow.yaml", ["build"], {}, {});
    await nodeStarted(state, "build", undefined, writer);
    await nodeCompleted(state, "build", 0.12, "done", undefined, writer);
    markRunCompleted(state);
    await writer.append({
      kind: "run_completed",
      status: "completed",
      completed_at: state.completed_at!,
    });

    const lines = (await Deno.readTextFile(getJournalPath(dir))).trim().split(
      "\n",
    );
    const events = lines.map((line) => JSON.parse(line)) as RunJournalEvent[];
    assertEquals(events.map((event) => event.seq), [1, 2, 3, 4, 5, 6, 7]);
    assertEquals(events.map((event) => event.kind), [
      "run_started",
      "workflow_loaded",
      "node_declared",
      "node_directory_declared",
      "node_started",
      "node_completed",
      "run_completed",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lifecycle replay — replay deduplicates records and ignores partial tail", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = await RunJournalWriter.open(dir, "run-2");
    await appendRunStart(writer, "run-2");
    const state = createRunState("run-2", "workflow.yaml", ["build"], {}, {});
    await nodeStarted(state, "build", undefined, writer);

    const lines = (await Deno.readTextFile(getJournalPath(dir))).trim().split(
      "\n",
    );
    await Deno.writeTextFile(getJournalPath(dir), `${lines.at(-1)}\n`, {
      append: true,
    });
    await Deno.writeTextFile(getJournalPath(dir), '{"schema_version":1', {
      append: true,
    });

    const replay = await replayRunJournal(dir);
    assertEquals(replay.ignored_duplicate_event_ids, 1);
    assertEquals(replay.ignored_partial_tail, true);
    assertEquals(replay.state.nodes.build.status, "running");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lifecycle replay — malformed non-tail journal record fails replay", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      getJournalPath(dir),
      '{"schema_version":1\n{"schema_version":1}\n',
    );
    await assertRejects(
      () => replayRunJournal(dir),
      Error,
      "Malformed journal record",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lifecycle replay — writer truncates partial tail before append", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = await RunJournalWriter.open(dir, "run-tail");
    await appendRunStart(writer, "run-tail");
    await Deno.writeTextFile(getJournalPath(dir), '{"schema_version":1', {
      append: true,
    });

    const resumedWriter = await RunJournalWriter.open(dir, "run-tail");
    await resumedWriter.append({
      kind: "run_completed",
      status: "completed",
      completed_at: "2026-05-17T00:01:00.000Z",
    });

    const replay = await replayRunJournal(dir);
    assertEquals(replay.state.status, "completed");
    assertEquals(replay.ignored_partial_tail, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lifecycle replay — mixed run ids fail clearly", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = await RunJournalWriter.open(dir, "run-a");
    await appendRunStart(writer, "run-a");
    await Deno.writeTextFile(
      getJournalPath(dir),
      JSON.stringify({
        schema_version: 1,
        run_id: "run-b",
        seq: 99,
        event_id: "run-b:99:run_completed",
        kind: "run_completed",
        ts: "2026-05-17T00:01:00.000Z",
        status: "completed",
        completed_at: "2026-05-17T00:01:00.000Z",
      }) + "\n",
      { append: true },
    );

    await assertRejects(
      () => replayRunJournal(dir),
      Error,
      "Cannot replay mixed-run journal",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lifecycle replay — durable node records mirror live lifecycle semantics", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = await RunJournalWriter.open(dir, "run-3");
    await appendRunStart(writer, "run-3");
    const live: NodeLifecycleEvent[] = [];
    const state = createRunState("run-3", "workflow.yaml", ["build"], {}, {});

    await nodeStarted(
      state,
      "build",
      (event) => {
        live.push(event);
      },
      writer,
    );
    await nodeCompleted(
      state,
      "build",
      0.2,
      "result",
      (event) => {
        live.push(event);
      },
      writer,
    );

    const replay = await replayRunJournal(dir);
    const durable = replay.events.find((event) =>
      event.kind === "node_completed"
    );
    assert(durable?.kind === "node_completed");
    assertEquals(durable.node, live[1].node);
    assertEquals(durable.metadata, live[1].metadata);
    assertEquals(durable.cost_usd, live[1].cost_usd);
    assertEquals(durable.result, live[1].result);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lifecycle replay — replay reconstructs host recovery snapshot", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = await RunJournalWriter.open(dir, "run-4");
    await appendRunStart(writer, "run-4");
    await writer.append({
      kind: "loop_iteration_started",
      loop_node_id: "build",
      iteration: 1,
      max_iterations: 2,
    });
    await writer.append({
      kind: "attempt_started",
      node_id: "build",
      iteration: 1,
    });
    const state = createRunState("run-4", "workflow.yaml", ["build"], {}, {});
    state.nodes.build.iteration = 1;
    state.nodes.build.session_id = "sess-1";
    state.nodes.build.continuations = 1;
    await nodeStarted(state, "build", undefined, writer);
    await nodeCompleted(state, "build", 0.33, "done", undefined, writer);
    await writer.append({
      kind: "attempt_completed",
      node_id: "build",
      iteration: 1,
      session_id: "sess-1",
      continuations: 1,
      cost_usd: 0.33,
      result: "done",
      success: true,
    });
    await writer.append({
      kind: "loop_iteration_completed",
      loop_node_id: "build",
      iteration: 1,
    });
    markRunCompleted(state);
    await writer.append({
      kind: "run_completed",
      status: "completed",
      completed_at: state.completed_at!,
    });

    const replay = await replayRunJournal(dir);
    assertEquals(replay.state.status, "completed");
    assertEquals(replay.state.args, { issue: "218" });
    assertEquals(replay.state.env, { MODE: "test" });
    assertEquals(replay.state.nodes.build.status, "completed");
    assertEquals(replay.state.nodes.build.iteration, 1);
    assertEquals(replay.state.nodes.build.session_id, "sess-1");
    assertEquals(replay.state.nodes.build.continuations, 1);
    assertEquals(replay.state.nodes.build.cost_usd, 0.33);
    assertEquals(replay.state.total_cost_usd, 0.33);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lifecycle replay — resume state is reconstructed from journal only", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = await RunJournalWriter.open(dir, "run-5");
    await appendRunStart(writer, "run-5");
    const state = createRunState("run-5", "workflow.yaml", ["build"], {}, {});
    await nodeStarted(state, "build", undefined, writer);
    await nodeFailed(state, "build", "boom", "unknown", undefined, writer);

    const recovered = await loadStateFromJournal(dir);
    assertEquals(recovered.nodes.build.status, "failed");
    assertEquals(recovered.nodes.build.error, "boom");

    let stateJsonExists = true;
    try {
      await Deno.stat(`${dir}/state.json`);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) stateJsonExists = false;
      else throw error;
    }
    assertEquals(stateJsonExists, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lifecycle replay — terminal workflow record wins over stale running snapshot", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = await RunJournalWriter.open(dir, "run-6");
    await appendRunStart(writer, "run-6");
    await writer.append({
      kind: "run_failed",
      status: "failed",
      completed_at: "2026-05-17T00:01:00.000Z",
    });
    await writer.append({
      kind: "run_started",
      config_path: "workflow.yaml",
      started_at: "2026-05-17T00:00:00.000Z",
      args: {},
      env: {},
    });

    const replay = await replayRunJournal(dir);
    assertEquals(replay.state.status, "failed");
    assertEquals(replay.state.completed_at, "2026-05-17T00:01:00.000Z");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lifecycle replay — replay uses only run directory lifecycle data", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const writer = await RunJournalWriter.open(dir, "run-7");
    await appendRunStart(writer, "run-7");
    const replay = await replayRunJournal(dir);
    assertEquals(replay.state.run_id, "run-7");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lifecycle replay — Engine.run writes journal and no state json", async () => {
  const tmpDir = await Deno.makeTempDir();
  const origCwd = Deno.cwd();
  try {
    await Deno.writeTextFile(
      `${tmpDir}/workflow.yaml`,
      [
        "name: journal-engine",
        "version: '1'",
        "defaults:",
        "  worktree_disabled: true",
        "nodes:",
        "  merge:",
        "    type: merge",
        "    label: Merge",
        "    merge_strategy: copy_all",
        "",
      ].join("\n"),
    );
    Deno.chdir(tmpDir);

    const engine = new Engine({
      config_path: "workflow.yaml",
      run_id: "run-engine",
      verbosity: "quiet",
      args: {},
      env_overrides: {},
      lock_path: "test.lock",
    });
    const state = await engine.run();
    assertEquals(state.status, "completed");

    const replay = await replayRunJournal("runs/run-engine");
    assertEquals(replay.state.status, "completed");
    assertEquals(replay.state.nodes.merge.status, "completed");

    let stateJsonExists = true;
    try {
      await Deno.stat("runs/run-engine/state.json");
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) stateJsonExists = false;
      else throw error;
    }
    assertEquals(stateJsonExists, false);
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(tmpDir, { recursive: true });
  }
});
