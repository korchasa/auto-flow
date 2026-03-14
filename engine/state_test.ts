import { assertEquals, assertThrows } from "@std/assert";
import {
  createRunState,
  generateRunId,
  getNodeDir,
  getNodesByStatus,
  getResumableNodes,
  getRunDir,
  getStatePath,
  isNodeCompleted,
  markNodeCompleted,
  markNodeFailed,
  markNodeSkipped,
  markNodeStarted,
  markNodeWaiting,
  markRunAborted,
  markRunCompleted,
  markRunFailed,
  updateNodeState,
  updateRunCost,
} from "./state.ts";

Deno.test("generateRunId — format YYYYMMDDTHHMMSS without label", () => {
  const id = generateRunId();
  assertEquals(id.length, 15); // YYYYMMDDTHHMMSS
  assertEquals(id[8], "T");
  assertEquals(/^\d{8}T\d{6}$/.test(id), true);
});

Deno.test("generateRunId — appends label as slug", () => {
  const id = generateRunId("fr-18-verbose-output");
  assertEquals(/^\d{8}T\d{6}-fr-18-verbose-output$/.test(id), true);
});

Deno.test("generateRunId — sanitizes label", () => {
  const id = generateRunId("My Feature!!!  spaces");
  assertEquals(/^\d{8}T\d{6}-my-feature-spaces$/.test(id), true);
});

Deno.test("generateRunId — issue number label", () => {
  const id = generateRunId("42");
  assertEquals(/^\d{8}T\d{6}-42$/.test(id), true);
});

Deno.test("generateRunId — empty label ignored", () => {
  const id = generateRunId("");
  assertEquals(/^\d{8}T\d{6}$/.test(id), true);
});

Deno.test("createRunState — initializes all nodes as pending", () => {
  const state = createRunState(
    "20260308T143022",
    ".sdlc/pipeline.yaml",
    ["spec", "plan", "developer"],
    { issue: "42" },
    { API_KEY: "test" },
  );

  assertEquals(state.run_id, "20260308T143022");
  assertEquals(state.config_path, ".sdlc/pipeline.yaml");
  assertEquals(state.status, "running");
  assertEquals(state.args, { issue: "42" });
  assertEquals(state.env, { API_KEY: "test" });
  assertEquals(Object.keys(state.nodes).length, 3);
  assertEquals(state.nodes.spec.status, "pending");
  assertEquals(state.nodes.plan.status, "pending");
  assertEquals(state.nodes.developer.status, "pending");
});

Deno.test("getRunDir / getNodeDir / getStatePath", () => {
  assertEquals(getRunDir("20260308T143022"), ".sdlc/runs/20260308T143022");
  assertEquals(
    getNodeDir("20260308T143022", "spec"),
    ".sdlc/runs/20260308T143022/spec",
  );
  assertEquals(
    getStatePath("20260308T143022"),
    ".sdlc/runs/20260308T143022/state.json",
  );
});

Deno.test("markNodeStarted — sets status and started_at", () => {
  const state = createRunState("test", "cfg.yaml", ["a"], {}, {});
  markNodeStarted(state, "a");

  assertEquals(state.nodes.a.status, "running");
  assertEquals(typeof state.nodes.a.started_at, "string");
});

Deno.test("markNodeCompleted — sets status, completed_at, duration_ms", () => {
  const state = createRunState("test", "cfg.yaml", ["a"], {}, {});
  markNodeStarted(state, "a");
  markNodeCompleted(state, "a");

  assertEquals(state.nodes.a.status, "completed");
  assertEquals(typeof state.nodes.a.completed_at, "string");
  assertEquals(typeof state.nodes.a.duration_ms, "number");
});

Deno.test("markNodeFailed — sets error message", () => {
  const state = createRunState("test", "cfg.yaml", ["a"], {}, {});
  markNodeStarted(state, "a");
  markNodeFailed(state, "a", "validation failed");

  assertEquals(state.nodes.a.status, "failed");
  assertEquals(state.nodes.a.error, "validation failed");
  assertEquals(state.nodes.a.error_category, undefined);
});

Deno.test("markNodeFailed — sets error_category when provided", () => {
  const state = createRunState("test", "cfg.yaml", ["a"], {}, {});
  markNodeStarted(state, "a");
  markNodeFailed(state, "a", "limit reached", "continuations_exhausted");

  assertEquals(state.nodes.a.status, "failed");
  assertEquals(state.nodes.a.error, "limit reached");
  assertEquals(state.nodes.a.error_category, "continuations_exhausted");
});

Deno.test("markNodeFailed — all error categories are valid", () => {
  const categories = [
    "continuations_exhausted",
    "timeout",
    "cli_crash",
    "hook_failure",
    "hitl_timeout",
    "aborted",
    "unknown",
  ] as const;

  for (const cat of categories) {
    const state = createRunState("test", "cfg.yaml", ["a"], {}, {});
    markNodeStarted(state, "a");
    markNodeFailed(state, "a", `error: ${cat}`, cat);
    assertEquals(state.nodes.a.error_category, cat);
  }
});

Deno.test("markNodeSkipped — sets status to skipped", () => {
  const state = createRunState("test", "cfg.yaml", ["a"], {}, {});
  markNodeSkipped(state, "a");

  assertEquals(state.nodes.a.status, "skipped");
});

Deno.test("updateNodeState — unknown node throws", () => {
  const state = createRunState("test", "cfg.yaml", ["a"], {}, {});
  assertThrows(
    () => updateNodeState(state, "nonexistent", { status: "running" }),
    Error,
    "not found",
  );
});

Deno.test("markRunCompleted / markRunFailed / markRunAborted", () => {
  const state = createRunState("test", "cfg.yaml", ["a"], {}, {});

  markRunCompleted(state);
  assertEquals(state.status, "completed");
  assertEquals(typeof state.completed_at, "string");

  const state2 = createRunState("test2", "cfg.yaml", ["a"], {}, {});
  markRunFailed(state2);
  assertEquals(state2.status, "failed");

  const state3 = createRunState("test3", "cfg.yaml", ["a"], {}, {});
  markRunAborted(state3);
  assertEquals(state3.status, "aborted");
});

Deno.test("getNodesByStatus — filters correctly", () => {
  const state = createRunState("test", "cfg.yaml", ["a", "b", "c"], {}, {});
  markNodeStarted(state, "a");
  markNodeCompleted(state, "a");
  markNodeStarted(state, "b");
  // c stays pending

  assertEquals(getNodesByStatus(state, "completed"), ["a"]);
  assertEquals(getNodesByStatus(state, "running"), ["b"]);
  assertEquals(getNodesByStatus(state, "pending"), ["c"]);
});

Deno.test("isNodeCompleted — returns correct boolean", () => {
  const state = createRunState("test", "cfg.yaml", ["a", "b"], {}, {});
  markNodeStarted(state, "a");
  markNodeCompleted(state, "a");

  assertEquals(isNodeCompleted(state, "a"), true);
  assertEquals(isNodeCompleted(state, "b"), false);
});

Deno.test("getResumableNodes — returns non-completed, non-skipped", () => {
  const state = createRunState(
    "test",
    "cfg.yaml",
    ["a", "b", "c", "d"],
    {},
    {},
  );
  markNodeCompleted(
    (() => {
      markNodeStarted(state, "a");
      return state;
    })(),
    "a",
  );
  markNodeSkipped(state, "b");
  markNodeFailed(
    (() => {
      markNodeStarted(state, "c");
      return state;
    })(),
    "c",
    "error",
  );
  // d stays pending

  const resumable = getResumableNodes(state);
  assertEquals(resumable.sort(), ["c", "d"]);
});

Deno.test("saveState + loadState — roundtrip", async () => {
  const tmpRunId = `test-${Date.now()}`;
  const state = createRunState(
    tmpRunId,
    "cfg.yaml",
    ["a", "b"],
    { issue: "1" },
    {},
  );
  markNodeStarted(state, "a");
  markNodeCompleted(state, "a");

  // Override getRunDir path to use temp location
  const tmpDir = await Deno.makeTempDir();
  const statePath = `${tmpDir}/state.json`;
  await Deno.writeTextFile(statePath, JSON.stringify(state, null, 2) + "\n");

  const loaded = JSON.parse(await Deno.readTextFile(statePath));

  assertEquals(loaded.run_id, tmpRunId);
  assertEquals(loaded.nodes.a.status, "completed");
  assertEquals(loaded.nodes.b.status, "pending");
  assertEquals(loaded.args.issue, "1");

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("markNodeWaiting — sets status, session_id, question_json", () => {
  const state = createRunState("test", "cfg.yaml", ["a"], {}, {});
  markNodeStarted(state, "a");
  markNodeWaiting(state, "a", "sess-123", '{"question":"Which language?"}');

  assertEquals(state.nodes.a.status, "waiting");
  assertEquals(state.nodes.a.session_id, "sess-123");
  assertEquals(state.nodes.a.question_json, '{"question":"Which language?"}');
});

Deno.test("getResumableNodes — includes waiting nodes", () => {
  const state = createRunState("test", "cfg.yaml", ["a", "b", "c"], {}, {});
  markNodeStarted(state, "a");
  markNodeCompleted(state, "a");
  markNodeStarted(state, "b");
  markNodeWaiting(state, "b", "sess-1", "{}");
  // c stays pending

  const resumable = getResumableNodes(state);
  assertEquals(resumable.sort(), ["b", "c"]);
});

Deno.test("createRunState — tracks nested body node IDs from flat list", () => {
  // Engine passes flattened IDs including loop body nodes to createRunState
  const allIds = ["pm", "impl-loop", "developer", "qa"];
  const state = createRunState("test", "cfg.yaml", allIds, {}, {});
  assertEquals(Object.keys(state.nodes).length, 4);
  assertEquals(state.nodes.developer.status, "pending");
  assertEquals(state.nodes.qa.status, "pending");
  assertEquals(state.nodes["impl-loop"].status, "pending");
  assertEquals(state.nodes.pm.status, "pending");
});

// --- FR-32: Cost tracking tests ---

Deno.test("markNodeCompleted — with costUsd sets node.cost_usd", () => {
  const state = createRunState("test", "cfg.yaml", ["a"], {}, {});
  markNodeStarted(state, "a");
  markNodeCompleted(state, "a", 0.0042);

  assertEquals(state.nodes.a.status, "completed");
  assertEquals(state.nodes.a.cost_usd, 0.0042);
});

Deno.test("markNodeCompleted — without costUsd leaves cost_usd undefined", () => {
  const state = createRunState("test", "cfg.yaml", ["a"], {}, {});
  markNodeStarted(state, "a");
  markNodeCompleted(state, "a");

  assertEquals(state.nodes.a.cost_usd, undefined);
  assertEquals(state.total_cost_usd, undefined);
});

Deno.test("markNodeCompleted — with costUsd updates state.total_cost_usd", () => {
  const state = createRunState("test", "cfg.yaml", ["a", "b"], {}, {});
  markNodeStarted(state, "a");
  markNodeCompleted(state, "a", 0.005);
  assertEquals(state.total_cost_usd, 0.005);

  markNodeStarted(state, "b");
  markNodeCompleted(state, "b", 0.003);
  assertEquals(state.total_cost_usd, 0.008);
});

Deno.test("updateRunCost — sums cost_usd across nodes, skips undefined", () => {
  const state = createRunState("test", "cfg.yaml", ["a", "b", "c"], {}, {});
  state.nodes.a.cost_usd = 0.01;
  state.nodes.b.cost_usd = 0.02;
  // c has no cost_usd
  updateRunCost(state);

  assertEquals(state.total_cost_usd, 0.03);
});

Deno.test("updateRunCost — total is 0 when no nodes have cost", () => {
  const state = createRunState("test", "cfg.yaml", ["a"], {}, {});
  updateRunCost(state);

  assertEquals(state.total_cost_usd, 0);
});
