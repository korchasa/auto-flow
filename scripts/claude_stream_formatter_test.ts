import { assertEquals } from "@std/assert";
import { formatStreamEvent, processStream } from "./claude_stream_formatter.ts";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

Deno.test("formatStreamEvent — system init", () => {
  const event = {
    type: "system",
    subtype: "init",
    model: "claude-opus-4-6",
    tools: ["Bash", "Read", "Edit"],
  };
  const out = formatStreamEvent(event);
  assertEquals(
    out,
    `${DIM}[init]${RESET} model=${CYAN}claude-opus-4-6${RESET} tools=3`,
  );
});

Deno.test("formatStreamEvent — assistant text", () => {
  const event = {
    type: "assistant",
    message: { content: [{ type: "text", text: "Hello world" }] },
  };
  const out = formatStreamEvent(event);
  assertEquals(out, `${GREEN}▍${RESET} Hello world`);
});

Deno.test("formatStreamEvent — assistant tool_use Bash", () => {
  const event = {
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Bash",
        input: { command: "echo hi" },
      }],
    },
  };
  const out = formatStreamEvent(event);
  assertEquals(out, `${YELLOW}⚡ Bash${RESET} ${DIM}echo hi${RESET}`);
});

Deno.test("formatStreamEvent — assistant tool_use Read", () => {
  const event = {
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Read",
        input: { file_path: "/tmp/foo.ts" },
      }],
    },
  };
  const out = formatStreamEvent(event);
  assertEquals(out, `${YELLOW}⚡ Read${RESET} ${DIM}/tmp/foo.ts${RESET}`);
});

Deno.test("formatStreamEvent — assistant mixed text + tool", () => {
  const event = {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Running command" },
        { type: "tool_use", name: "Bash", input: { command: "ls" } },
      ],
    },
  };
  const out = formatStreamEvent(event);
  const lines = out.split("\n");
  assertEquals(lines.length, 2);
  assertEquals(lines[0], `${GREEN}▍${RESET} Running command`);
  assertEquals(lines[1], `${YELLOW}⚡ Bash${RESET} ${DIM}ls${RESET}`);
});

Deno.test("formatStreamEvent — user tool_result ok", () => {
  const event = {
    type: "user",
    message: {
      content: [{
        type: "tool_result",
        is_error: false,
        content: "file contents here",
      }],
    },
  };
  const out = formatStreamEvent(event);
  assertEquals(out, `${DIM}  ↳ ok: file contents here${RESET}`);
});

Deno.test("formatStreamEvent — user tool_result error", () => {
  const event = {
    type: "user",
    message: {
      content: [{
        type: "tool_result",
        is_error: true,
        content: "not found",
      }],
    },
  };
  const out = formatStreamEvent(event);
  assertEquals(
    out,
    `${DIM}  ↳ ${RED}error${RESET}: not found${RESET}`,
  );
});

Deno.test("formatStreamEvent — result success", () => {
  const event = {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5000,
    total_cost_usd: 0.1234,
    num_turns: 3,
  };
  const out = formatStreamEvent(event);
  assertEquals(
    out,
    `${GREEN}✓${RESET} ${BOLD}success${RESET} ${DIM}(5.0s)${RESET} ${DIM}$0.1234${RESET} turns=3`,
  );
});

Deno.test("formatStreamEvent — result error", () => {
  const event = {
    type: "result",
    subtype: "error",
    is_error: true,
    duration_ms: 1200,
    total_cost_usd: 0.05,
    num_turns: 1,
  };
  const out = formatStreamEvent(event);
  assertEquals(
    out,
    `${RED}✗${RESET} ${BOLD}error${RESET} ${DIM}(1.2s)${RESET} ${DIM}$0.0500${RESET} turns=1`,
  );
});

Deno.test("formatStreamEvent — skips rate_limit_event", () => {
  const event = { type: "rate_limit_event" };
  assertEquals(formatStreamEvent(event), "");
});

Deno.test("formatStreamEvent — skips unknown type", () => {
  const event = { type: "something_else" };
  assertEquals(formatStreamEvent(event), "");
});

Deno.test("formatStreamEvent — tool_use Grep", () => {
  const event = {
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Grep",
        input: { pattern: "TODO", path: "src/" },
      }],
    },
  };
  const out = formatStreamEvent(event);
  assertEquals(out, `${YELLOW}⚡ Grep${RESET} ${DIM}/TODO/ src/${RESET}`);
});

Deno.test("formatStreamEvent — tool_use TodoWrite", () => {
  const event = {
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "TodoWrite",
        input: { todos: [{ content: "a" }, { content: "b" }] },
      }],
    },
  };
  const out = formatStreamEvent(event);
  assertEquals(
    out,
    `${YELLOW}⚡ TodoWrite${RESET} ${DIM}2 item(s)${RESET}`,
  );
});

Deno.test("formatStreamEvent — user tool_result array content", () => {
  const event = {
    type: "user",
    message: {
      content: [{
        type: "tool_result",
        is_error: false,
        content: [{ type: "text", text: "line1" }, {
          type: "text",
          text: "line2",
        }],
      }],
    },
  };
  const out = formatStreamEvent(event);
  assertEquals(out, `${DIM}  ↳ ok: line1 line2${RESET}`);
});

Deno.test("processStream — processes newline-delimited JSON", async () => {
  const events = [
    JSON.stringify({
      type: "system",
      subtype: "init",
      model: "test",
      tools: ["A"],
    }),
    JSON.stringify({ type: "rate_limit_event" }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 100,
      total_cost_usd: 0.01,
      num_turns: 1,
    }),
  ];
  const data = events.join("\n") + "\n";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(data));
      controller.close();
    },
  });

  const output: string[] = [];
  const result = await processStream(stream, (s) => output.push(s));

  assertEquals(output.length, 3); // init, assistant text, result (rate_limit skipped)
  assertEquals(output[0].includes("test"), true);
  assertEquals(output[1].includes("hi"), true);
  assertEquals(output[2].includes("success"), true);
  assertEquals(result.completed, true);
  assertEquals(result.success, true);
});

Deno.test("processStream — returns not completed when no result event", async () => {
  const data = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "partial" }] },
  }) + "\n";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(data));
      controller.close();
    },
  });
  const result = await processStream(stream, () => {});
  assertEquals(result.completed, false);
  assertEquals(result.success, false);
});

Deno.test("processStream — returns failure on error result", async () => {
  const data = JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    duration_ms: 500,
  }) + "\n";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(data));
      controller.close();
    },
  });
  const result = await processStream(stream, () => {});
  assertEquals(result.completed, true);
  assertEquals(result.success, false);
});

Deno.test("formatStreamEvent — duration formatting minutes", () => {
  const event = {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 125000,
    total_cost_usd: 1.0,
    num_turns: 5,
  };
  const out = formatStreamEvent(event);
  assertEquals(out.includes("2m5s"), true);
});

Deno.test("formatStreamEvent — long command truncated", () => {
  const longCmd = "x".repeat(200);
  const event = {
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Bash",
        input: { command: longCmd },
      }],
    },
  };
  const out = formatStreamEvent(event);
  assertEquals(out.includes("…"), true);
  // truncated to 120 + "…"
  assertEquals(out.includes("x".repeat(120)), true);
  assertEquals(out.includes("x".repeat(121)), false);
});
