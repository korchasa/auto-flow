/**
 * FR-E75: unified run-control command layer (`commands.ts`).
 * Covers `deliverHumanAnswer` (waiting-validation, atomic inbox write,
 * liveness reporting) and `resumeRun` (single engine-resume construction).
 * Both MCP (`provide_human_input`/`resume_node`) and CLI (`answer`/`run
 * --resume`) delegate here — these tests pin the shared core's contract.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";

import { deliverHumanAnswer, resumeRun } from "./commands.ts";
import { RunJournalWriter } from "../state/run-journal.ts";
import { createRunState, getHitlInboxPath, getRunDir } from "../state/state.ts";
import {
  nodeCompleted,
  nodeStarted,
  nodeWaiting,
} from "../engine/node-lifecycle.ts";
import { defaultLockPath } from "../state/lock.ts";

const WORKFLOW_YAML = `name: fr-e75-cmd
version: "1"
nodes:
  pm:
    type: agent
    label: PM
    prompt: dummy
`;

interface Fixture {
  workflowDir: string;
  runId: string;
  cleanup: () => Promise<void>;
}

/** Build a run whose single node "pm" is either `waiting` or `completed`. */
async function setupRun(
  nodeStatus: "waiting" | "completed",
): Promise<Fixture> {
  const workflowDir = await Deno.makeTempDir({ prefix: "fr-e75-cmd-" });
  await Deno.writeTextFile(join(workflowDir, "workflow.yaml"), WORKFLOW_YAML);
  const runId = "run-1";
  const runDir = getRunDir(runId, workflowDir);
  await Deno.mkdir(runDir, { recursive: true });
  const writer = await RunJournalWriter.open(runDir, runId);
  await writer.append({
    kind: "run_started",
    config_path: "workflow.yaml",
    started_at: "2026-05-30T00:00:00.000Z",
    ts: "2026-05-30T00:00:00.000Z",
    args: {},
    env: {},
  });
  await writer.append({
    kind: "node_declared",
    node_id: "pm",
    node_type: "agent",
    label: "PM",
  });
  const state = createRunState(runId, "workflow.yaml", ["pm"], {}, {});
  await nodeStarted(state, "pm", undefined, writer);
  if (nodeStatus === "completed") {
    await nodeCompleted(state, "pm", 0, "done", undefined, writer);
  } else {
    await nodeWaiting(
      state,
      "pm",
      "sess-1",
      JSON.stringify({ question: "Pick a direction" }),
      undefined,
      writer,
    );
  }
  return {
    workflowDir,
    runId,
    cleanup: () => Deno.remove(workflowDir, { recursive: true }),
  };
}

// --- deliverHumanAnswer ---

Deno.test("FR-E75 deliverHumanAnswer — rejects a node that is not waiting", async () => {
  const fx = await setupRun("completed");
  try {
    await assertRejects(
      () =>
        deliverHumanAnswer({
          workflowDir: fx.workflowDir,
          runId: fx.runId,
          nodeId: "pm",
          text: "монетизация",
        }),
      Error,
      "waiting",
    );
    // No inbox file written on rejection.
    const inboxPath = getHitlInboxPath(
      getRunDir(fx.runId, fx.workflowDir),
      "pm",
    );
    let exists = true;
    try {
      await Deno.stat(inboxPath);
    } catch {
      exists = false;
    }
    assertEquals(exists, false);
  } finally {
    await fx.cleanup();
  }
});

Deno.test("FR-E75 deliverHumanAnswer — rejects an unknown node", async () => {
  const fx = await setupRun("waiting");
  try {
    await assertRejects(
      () =>
        deliverHumanAnswer({
          workflowDir: fx.workflowDir,
          runId: fx.runId,
          nodeId: "ghost",
          text: "x",
        }),
      Error,
      "ghost",
    );
  } finally {
    await fx.cleanup();
  }
});

Deno.test("FR-E75 deliverHumanAnswer — rejects empty text", async () => {
  const fx = await setupRun("waiting");
  try {
    await assertRejects(
      () =>
        deliverHumanAnswer({
          workflowDir: fx.workflowDir,
          runId: fx.runId,
          nodeId: "pm",
          text: "   ",
        }),
      Error,
      "empty",
    );
  } finally {
    await fx.cleanup();
  }
});

Deno.test("FR-E75 deliverHumanAnswer — writes inbox verbatim, live=false with no lock holder", async () => {
  const fx = await setupRun("waiting");
  try {
    const res = await deliverHumanAnswer({
      workflowDir: fx.workflowDir,
      runId: fx.runId,
      nodeId: "pm",
      text: "монетизация",
    });
    const expectedPath = getHitlInboxPath(
      getRunDir(fx.runId, fx.workflowDir),
      "pm",
    );
    assertEquals(res.inboxPath, expectedPath);
    assertEquals(res.live, false); // no engine holds the run lock
    assertEquals(await Deno.readTextFile(expectedPath), "монетизация");
  } finally {
    await fx.cleanup();
  }
});

Deno.test("FR-E75 deliverHumanAnswer — reports live=true when the run lock is held by a live PID", async () => {
  const fx = await setupRun("waiting");
  try {
    // Plant a lock owned by the current (alive) process for this run.
    const lockPath = defaultLockPath(fx.workflowDir);
    await Deno.mkdir(join(fx.workflowDir, "runs"), { recursive: true });
    await Deno.writeTextFile(
      lockPath,
      JSON.stringify({
        pid: Deno.pid,
        hostname: "test",
        run_id: fx.runId,
        started_at: new Date().toISOString(),
      }),
    );
    const res = await deliverHumanAnswer({
      workflowDir: fx.workflowDir,
      runId: fx.runId,
      nodeId: "pm",
      text: "answer",
    });
    assertEquals(res.live, true);
  } finally {
    await fx.cleanup();
  }
});

// --- resumeRun ---

Deno.test("FR-E75 resumeRun — surfaces an error for a nonexistent run (engine-resume path)", async () => {
  const fx = await setupRun("waiting");
  try {
    // No journal for this run id → journal replay inside Engine resume fails.
    await assertRejects(() =>
      resumeRun({ workflowDir: fx.workflowDir, runId: "does-not-exist" })
    );
  } finally {
    await fx.cleanup();
  }
});
