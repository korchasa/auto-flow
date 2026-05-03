/**
 * @module
 * Tests for the engine's HITL MCP injection + observer-based detection
 * (FR-L35; ADR-0013).
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  buildHitlMcpServers,
  createHitlObserver,
  hitlToolNameFor,
} from "./hitl-injection.ts";
import {
  HITL_MCP_SERVER_NAME,
  HITL_TOOL_NAME,
  INTERNAL_HITL_MCP_ARG,
} from "./hitl-mcp-server.ts";

Deno.test("buildHitlMcpServers — registers stdio entry under canonical name", () => {
  const servers = buildHitlMcpServers();
  const entry = servers[HITL_MCP_SERVER_NAME];
  assertNotEquals(entry, undefined);
  assertEquals(entry.type, "stdio");
  if (entry.type !== "stdio") throw new Error("expected stdio entry");
  // The argv ends with the internal flag — that's the dispatch contract.
  const tail = (entry.args ?? [])[(entry.args ?? []).length - 1];
  assertEquals(tail, INTERNAL_HITL_MCP_ARG);
});

Deno.test("hitlToolNameFor — Claude prefix", () => {
  assertEquals(
    hitlToolNameFor("claude"),
    `mcp__${HITL_MCP_SERVER_NAME}__${HITL_TOOL_NAME}`,
  );
});

Deno.test("hitlToolNameFor — OpenCode prefix", () => {
  assertEquals(
    hitlToolNameFor("opencode"),
    `${HITL_MCP_SERVER_NAME}_${HITL_TOOL_NAME}`,
  );
});

Deno.test("hitlToolNameFor — Codex prefix", () => {
  assertEquals(
    hitlToolNameFor("codex"),
    `${HITL_MCP_SERVER_NAME}.${HITL_TOOL_NAME}`,
  );
});

Deno.test("createHitlObserver — captures matching tool call and aborts", () => {
  const obs = createHitlObserver("claude");
  assertEquals(obs.getQuestion(), null);
  const decision = obs.observer({
    runtime: "claude",
    id: "tool-1",
    name: hitlToolNameFor("claude"),
    input: { question: "Continue?" },
    turn: 1,
  });
  assertEquals(decision, "abort");
  const q = obs.getQuestion();
  assertEquals(q?.question, "Continue?");
});

Deno.test("createHitlObserver — ignores unrelated tool calls", () => {
  const obs = createHitlObserver("opencode");
  const decision = obs.observer({
    runtime: "opencode",
    id: "tool-1",
    name: "Bash",
    input: { command: "ls" },
    turn: 1,
  });
  assertEquals(decision, "allow");
  assertEquals(obs.getQuestion(), null);
});

Deno.test("createHitlObserver — only captures FIRST match per instance", () => {
  const obs = createHitlObserver("codex");
  obs.observer({
    runtime: "codex",
    id: "t1",
    name: hitlToolNameFor("codex"),
    input: { question: "First?" },
    turn: 1,
  });
  const decision2 = obs.observer({
    runtime: "codex",
    id: "t2",
    name: hitlToolNameFor("codex"),
    input: { question: "Second?" },
    turn: 2,
  });
  assertEquals(decision2, "allow");
  assertEquals(obs.getQuestion()?.question, "First?");
});

Deno.test("createHitlObserver — reset clears stash", () => {
  const obs = createHitlObserver("claude");
  obs.observer({
    runtime: "claude",
    id: "t",
    name: hitlToolNameFor("claude"),
    input: { question: "Q" },
    turn: 1,
  });
  assertEquals(obs.getQuestion()?.question, "Q");
  obs.reset();
  assertEquals(obs.getQuestion(), null);
});

Deno.test("createHitlObserver — malformed input does not capture, returns allow", () => {
  const obs = createHitlObserver("claude");
  const decision = obs.observer({
    runtime: "claude",
    id: "t",
    name: hitlToolNameFor("claude"),
    input: {}, // missing required `question` → normalize throws
    turn: 1,
  });
  assertEquals(decision, "allow");
  assertEquals(obs.getQuestion(), null);
});
