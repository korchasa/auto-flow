/**
 * @module
 * Tests for the absorbed HITL MCP server (Phase 1 of HITL absorption).
 * Covers `normalizeHumanInputRequest` directly + a fork/stdio integration
 * smoke that exercises the full NDJSON JSON-RPC handshake against
 * `runFlowaiHitlMcpServer`.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  buildHitlMcpServerArgv,
  HITL_MCP_SERVER_NAME,
  HITL_TOOL_NAME,
  INTERNAL_HITL_MCP_ARG,
  normalizeHumanInputRequest,
  REQUEST_HUMAN_INPUT_TOOL,
} from "./hitl-mcp-server.ts";

Deno.test("normalizeHumanInputRequest — minimal question only", () => {
  const got = normalizeHumanInputRequest({ question: "Continue?" });
  assertEquals(got.question, "Continue?");
  assertEquals(got.header, undefined);
  assertEquals(got.options, undefined);
  assertEquals(got.multiSelect, undefined);
});

Deno.test("normalizeHumanInputRequest — full payload", () => {
  const got = normalizeHumanInputRequest({
    question: "Pick one",
    header: "Decision",
    options: [
      { label: "yes", description: "go" },
      { label: "no" },
    ],
    multiSelect: false,
  });
  assertEquals(got.question, "Pick one");
  assertEquals(got.header, "Decision");
  assertEquals(got.multiSelect, false);
  assertEquals(got.options?.length, 2);
  assertEquals(got.options?.[0], { label: "yes", description: "go" });
  assertEquals(got.options?.[1], { label: "no", description: undefined });
});

Deno.test("normalizeHumanInputRequest — drops options without label", () => {
  const got = normalizeHumanInputRequest({
    question: "q",
    options: [
      { label: "" },
      { label: "valid" },
      "not-an-object",
      null,
    ] as unknown[],
  });
  assertEquals(got.options?.length, 1);
  assertEquals(got.options?.[0].label, "valid");
});

Deno.test("normalizeHumanInputRequest — empty options array → undefined", () => {
  const got = normalizeHumanInputRequest({ question: "q", options: [] });
  assertEquals(got.options, undefined);
});

Deno.test("normalizeHumanInputRequest — missing question throws", () => {
  assertThrows(
    () => normalizeHumanInputRequest({}),
    Error,
    "request_human_input requires a non-empty question",
  );
});

Deno.test("normalizeHumanInputRequest — whitespace-only question throws", () => {
  assertThrows(
    () => normalizeHumanInputRequest({ question: "   " }),
    Error,
    "request_human_input requires a non-empty question",
  );
});

Deno.test("REQUEST_HUMAN_INPUT_TOOL — schema is stable", () => {
  assertEquals(REQUEST_HUMAN_INPUT_TOOL.name, HITL_TOOL_NAME);
  assertEquals(REQUEST_HUMAN_INPUT_TOOL.name, "request_human_input");
  // Required fields must remain `["question"]` — cross-runtime contract.
  const schema = REQUEST_HUMAN_INPUT_TOOL.inputSchema as {
    required: string[];
    properties: Record<string, unknown>;
  };
  assertEquals(schema.required, ["question"]);
  assertEquals(Object.keys(schema.properties).sort(), [
    "header",
    "multiSelect",
    "options",
    "question",
  ]);
});

Deno.test("HITL_MCP_SERVER_NAME — is the agreed cross-runtime name", () => {
  assertEquals(HITL_MCP_SERVER_NAME, "flowai-workflow-hitl");
});

Deno.test("INTERNAL_HITL_MCP_ARG — is the dispatch flag", () => {
  assertEquals(INTERNAL_HITL_MCP_ARG, "--internal-hitl-mcp");
});

Deno.test("buildHitlMcpServerArgv — argv ends with internal flag", () => {
  const argv = buildHitlMcpServerArgv();
  assertEquals(argv[argv.length - 1], INTERNAL_HITL_MCP_ARG);
});

Deno.test("buildHitlMcpServerArgv — dev mode prepends deno run -A", () => {
  // In test runs, Deno.execPath() points at the deno binary, so we
  // expect the dev-mode branch.
  const argv = buildHitlMcpServerArgv();
  assertEquals(argv[1], "run");
  assertEquals(argv[2], "-A");
  assertEquals(argv[3].endsWith("/cli.ts"), true);
});

// Integration smoke: spawn the engine binary as a sub-process, send
// initialize + tools/list + tools/call via stdin, check stdout responses.
Deno.test({
  name: "runFlowaiHitlMcpServer — initialize/tools/list/tools/call handshake",
  ignore: Deno.env.get("CI") === "true", // requires fork/exec
  async fn() {
    const argv = buildHitlMcpServerArgv();
    const cmd = new Deno.Command(argv[0], {
      args: argv.slice(1),
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const child = cmd.spawn();

    const writer = child.stdin.getWriter();
    const enc = new TextEncoder();

    const send = (msg: Record<string, unknown>) =>
      writer.write(enc.encode(JSON.stringify(msg) + "\n"));

    await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    });
    await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { arguments: { question: "OK?" } },
    });
    await writer.close();

    const out = await child.output();
    const stdout = new TextDecoder().decode(out.stdout);

    const lines = stdout.split("\n").filter((l) => l.trim());
    assertEquals(lines.length, 3);

    const initResp = JSON.parse(lines[0]);
    assertEquals(initResp.id, 1);
    assertEquals(initResp.result.serverInfo.name, HITL_MCP_SERVER_NAME);

    const listResp = JSON.parse(lines[1]);
    assertEquals(listResp.id, 2);
    assertEquals(listResp.result.tools.length, 1);
    assertEquals(listResp.result.tools[0].name, HITL_TOOL_NAME);

    const callResp = JSON.parse(lines[2]);
    assertEquals(callResp.id, 3);
    const payload = JSON.parse(callResp.result.content[0].text);
    assertEquals(payload.ok, true);
    assertEquals(payload.question, "OK?");
  },
});
