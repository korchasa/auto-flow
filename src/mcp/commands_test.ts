/**
 * FR-E75: unified run-control command layer (`commands.ts`).
 * Covers `deliverHumanAnswer` (waiting-validation, atomic inbox write,
 * liveness reporting) and `resumeRun` (single engine-resume construction).
 * Both MCP (`provide_human_input`/`resume_node`) and CLI (`answer`/`run
 * --resume`) delegate here — these tests pin the shared core's contract.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";

import {
  buildEngineRunCommand,
  deliverHumanAnswer,
  resumeRun,
  resumeRunBackground,
  startRun,
} from "./commands.ts";
import type { LockInfo } from "../state/lock.ts";
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

// --- startRun (FR-E84) ---

Deno.test("FR-E84 startRun wait:true — surfaces an error when the workflow is missing (fresh engine path)", async () => {
  // Empty temp dir → no workflow.yaml → loadConfig inside the engine fails.
  // Proves the blocking Engine({resume:false}) construction + error envelope.
  const workflowDir = await Deno.makeTempDir({ prefix: "fr-e84-wait-" });
  try {
    await assertRejects(() => startRun({ workflowDir, wait: true }));
  } finally {
    await Deno.remove(workflowDir, { recursive: true });
  }
});

Deno.test("FR-E84 startRun wait:false — rejects when a run already holds the lock", async () => {
  const workflowDir = await Deno.makeTempDir({ prefix: "fr-e84-locked-" });
  try {
    await Deno.writeTextFile(join(workflowDir, "workflow.yaml"), WORKFLOW_YAML);
    await Deno.mkdir(join(workflowDir, "runs"), { recursive: true });
    const held: LockInfo = {
      pid: Deno.pid, // alive by definition
      hostname: Deno.hostname(),
      run_id: "run-already",
      started_at: "2026-06-21T00:00:00.000Z",
    };
    await Deno.writeTextFile(
      join(workflowDir, "runs", ".lock"),
      JSON.stringify(held),
    );
    await assertRejects(
      () => startRun({ workflowDir, wait: false }),
      Error,
      "already active",
    );
  } finally {
    await Deno.remove(workflowDir, { recursive: true });
  }
});

Deno.test("FR-E84 startRun wait:false — returns a run_id + pid without blocking (detached spawn)", async () => {
  const workflowDir = await Deno.makeTempDir({ prefix: "fr-e84-bg-" });
  try {
    await Deno.writeTextFile(join(workflowDir, "workflow.yaml"), WORKFLOW_YAML);
    const res = await startRun({ workflowDir, wait: false });
    assertEquals(res.wait, false);
    assertEquals(typeof res.run_id, "string");
    assertEquals(res.run_id.length > 0, true);
    assertEquals(typeof res.pid, "number");
    // Reap the detached child (it fails fast on the non-git temp worktree;
    // killing it deterministically avoids a stray process in the suite).
    try {
      Deno.kill(res.pid!, "SIGKILL");
    } catch {
      // Already exited — fine.
    }
  } finally {
    await Deno.remove(workflowDir, { recursive: true });
  }
});

Deno.test("FR-E84 buildEngineRunCommand — dev path re-execs cli.ts with --run-id", () => {
  // Tests run under `deno run` → VERSION === "dev".
  const { exec, args } = buildEngineRunCommand("/tmp/wf", "run-xyz", {
    prompt: "hello",
  });
  assertEquals(exec, Deno.execPath());
  assertEquals(args[0], "run");
  assertEquals(args.includes("--run-id"), true);
  assertEquals(args[args.indexOf("--run-id") + 1], "run-xyz");
  assertEquals(args.includes("--prompt"), true);
  assertEquals(args[args.indexOf("--prompt") + 1], "hello");
  // Positional workflow dir is forwarded to the `run` subcommand.
  assertEquals(args.includes("/tmp/wf"), true);
});

// --- resumeRunBackground (FR-E85) ---

Deno.test("FR-E85 buildEngineRunCommand — resume mode emits --resume, not --run-id", () => {
  const { args } = buildEngineRunCommand("/tmp/wf", "run-abc", {
    resume: true,
  });
  assertEquals(args.includes("--resume"), true);
  assertEquals(args[args.indexOf("--resume") + 1], "run-abc");
  assertEquals(args.includes("--run-id"), false);
  // Resume inherits the journal's prompt — no --prompt forwarded.
  assertEquals(args.includes("--prompt"), false);
});

Deno.test("FR-E85 resumeRunBackground — returns run_id + pid without blocking (detached spawn)", async () => {
  const workflowDir = await Deno.makeTempDir({ prefix: "fr-e85-bg-" });
  try {
    await Deno.writeTextFile(join(workflowDir, "workflow.yaml"), WORKFLOW_YAML);
    const res = await resumeRunBackground({
      workflowDir,
      runId: "run-resume-1",
    });
    assertEquals(res.wait, false);
    assertEquals(res.run_id, "run-resume-1");
    assertEquals(typeof res.pid, "number");
    // Reap the detached child (it fails fast resuming a nonexistent journal).
    try {
      Deno.kill(res.pid, "SIGKILL");
    } catch {
      // Already exited — fine.
    }
  } finally {
    await Deno.remove(workflowDir, { recursive: true });
  }
});

Deno.test("FR-E85 resumeRunBackground — rejects when the run is already live (attach, not resume)", async () => {
  const workflowDir = await Deno.makeTempDir({ prefix: "fr-e85-live-" });
  try {
    await Deno.writeTextFile(join(workflowDir, "workflow.yaml"), WORKFLOW_YAML);
    await Deno.mkdir(join(workflowDir, "runs"), { recursive: true });
    const held: LockInfo = {
      pid: Deno.pid, // alive by definition
      hostname: Deno.hostname(),
      run_id: "run-live-1",
      started_at: "2026-06-22T00:00:00.000Z",
    };
    await Deno.writeTextFile(
      join(workflowDir, "runs", ".lock"),
      JSON.stringify(held),
    );
    await assertRejects(
      () => resumeRunBackground({ workflowDir, runId: "run-live-1" }),
      Error,
      "already live",
    );
  } finally {
    await Deno.remove(workflowDir, { recursive: true });
  }
});
