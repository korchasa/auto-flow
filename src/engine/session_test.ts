import { assertEquals } from "@std/assert";
import { resolveSessionToContinue } from "./session.ts";
import { createRunState } from "../state/state.ts";
import type { RunState } from "../types.ts";

function stateWith(nodes: RunState["nodes"]): RunState {
  const state = createRunState("run-s", "wf.yaml", Object.keys(nodes), {}, {});
  for (const [id, node] of Object.entries(nodes)) state.nodes[id] = node;
  return state;
}

Deno.test("FR-E100 resolveSessionToContinue — fresh never resolves a session", () => {
  const state = stateWith({
    build: { status: "completed", session_id: "ses-1" },
  });
  assertEquals(resolveSessionToContinue(state, "build", "fresh"), {
    fresh: true,
  });
});

Deno.test("FR-E100 resolveSessionToContinue — continue picks the node's own completed session", () => {
  const state = stateWith({
    build: { status: "completed", session_id: "ses-1" },
  });
  assertEquals(resolveSessionToContinue(state, "build", "continue"), {
    sessionId: "ses-1",
    owner: "build",
  });
});

Deno.test("FR-E100 resolveSessionToContinue — continue with nothing recorded is a fresh start", () => {
  const state = stateWith({ build: { status: "pending" } });
  assertEquals(resolveSessionToContinue(state, "build", "continue"), {
    fresh: true,
  });
});

Deno.test("FR-E100 resolveSessionToContinue — a replayed failed attempt is never continued", () => {
  const state = stateWith({
    build: { status: "failed", session_id: "ses-1", error: "boom" },
    fix: { status: "pending" },
  });
  assertEquals(resolveSessionToContinue(state, "build", "continue"), {
    fresh: true,
  });
  const target = resolveSessionToContinue(state, "fix", "build");
  assertEquals("error" in target, true);
  if ("error" in target) {
    assertEquals(
      target.error,
      "Node 'fix' asks to continue the session of 'build' (session: build), but 'build' has no completed attempt that recorded one",
    );
  }
});

Deno.test("FR-E100 resolveSessionToContinue — a node id resolves the target's completed session", () => {
  const state = stateWith({
    write: { status: "completed", session_id: "ses-w" },
    revise: { status: "pending" },
  });
  assertEquals(resolveSessionToContinue(state, "revise", "write"), {
    sessionId: "ses-w",
    owner: "write",
  });
});

Deno.test("FR-E100 resolveSessionToContinue — a branch key reads the target's branch session", () => {
  const state = stateWith({
    write: {
      status: "completed",
      session_id: "ses-last",
      branch_sessions: { a: "ses-a", b: "ses-b" },
    },
    revise: { status: "pending" },
  });
  assertEquals(resolveSessionToContinue(state, "revise", "write", "b"), {
    sessionId: "ses-b",
    owner: "write[b]",
  });
  const missing = resolveSessionToContinue(state, "revise", "write", "c");
  assertEquals("error" in missing, true);
  if ("error" in missing) {
    assertEquals(
      missing.error,
      "Node 'revise' asks to continue the session of 'write' for branch 'c' (session: write), but no completed attempt of 'write' recorded one for that branch",
    );
  }
});

Deno.test("FR-E100 resolveSessionToContinue — continue inside a branch uses the node's own branch session", () => {
  const state = stateWith({
    build: { status: "running", branch_sessions: { k: "ses-k" } },
  });
  assertEquals(resolveSessionToContinue(state, "build", "continue", "k"), {
    sessionId: "ses-k",
    owner: "build[k]",
  });
  assertEquals(resolveSessionToContinue(state, "build", "continue", "z"), {
    fresh: true,
  });
});
