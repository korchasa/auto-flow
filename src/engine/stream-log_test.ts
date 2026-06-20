import { assertEquals } from "@std/assert";
import {
  createStreamLogWriter,
  FileReadTracker,
  stampLines,
  tsPrefix,
} from "./stream-log.ts";

Deno.test("FR-E18 stampLines prefixes non-empty lines and passes empty lines through", () => {
  // Fixed clock for deterministic assertion (avoid Date.now in the test body).
  const at = new Date(2026, 5, 21, 9, 7, 3);
  assertEquals(tsPrefix(at), "[09:07:03]");

  const out = stampLines("line1\n\nline2", at);
  assertEquals(out, "[09:07:03] line1\n\n[09:07:03] line2");

  // Single non-empty line.
  assertEquals(stampLines("solo", at), "[09:07:03] solo");
  // Pure empty line passes through unprefixed.
  assertEquals(stampLines("", at), "");
});

Deno.test("FR-E20 FileReadTracker warns after more than 2 reads of same path", () => {
  const tracker = new FileReadTracker();
  assertEquals(tracker.track("a.md"), null); // 1
  assertEquals(tracker.track("a.md"), null); // 2
  assertEquals(
    tracker.track("a.md"),
    "[WARN] repeated file read: a.md (3 times)",
  ); // 3
  assertEquals(
    tracker.track("a.md"),
    "[WARN] repeated file read: a.md (4 times)",
  ); // 4
  // Per-path independence: a different path starts its own counter.
  assertEquals(tracker.track("b.md"), null);
});

Deno.test("FR-E18 formats ACP session/update params into text and tool lines", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/stream.log`;
  const writer = createStreamLogWriter(path);

  // ACP `session/update` params — top-level `sessionUpdate` (real invoke-path
  // wire shape, mirrored by the library's own onEvent call site).
  writer.handleEvent({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "hello from agent" },
  });
  writer.handleEvent({
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    title: "Read",
    rawInput: { file_path: "/repo/a.md" },
  });
  // Third+ Read of the same path triggers the FR-E20 warning line.
  writer.handleEvent({
    sessionUpdate: "tool_call_update",
    toolCallId: "t2",
    title: "Read",
    rawInput: { file_path: "/repo/a.md" },
  });
  writer.handleEvent({
    sessionUpdate: "tool_call_update",
    toolCallId: "t3",
    title: "Read",
    rawInput: { file_path: "/repo/a.md" },
  });
  // Unknown variant produces no line.
  writer.handleEvent({ sessionUpdate: "plan", entries: [] });

  await writer.close();
  assertEquals(writer.takeWriteError(), null);

  const content = await Deno.readTextFile(path);
  const lines = content.split("\n").filter((l) => l.length > 0);

  // Every persisted line is timestamped.
  for (const line of lines) {
    assertEquals(
      /^\[\d{2}:\d{2}:\d{2}\] /.test(line),
      true,
      `line not timestamped: ${line}`,
    );
  }

  assertEquals(content.includes("[stream] text: hello from agent"), true);
  assertEquals(content.includes("[stream] tool: Read"), true);
  assertEquals(content.includes('"file_path":"/repo/a.md"'), true);
  assertEquals(
    content.includes("[WARN] repeated file read: /repo/a.md (3 times)"),
    true,
  );
  assertEquals(content.includes("--- end ---"), true);
});

Deno.test("FR-E18 createStreamLogWriter open failure throws (mapped to cli_crash by runAgent)", async () => {
  const dir = await Deno.makeTempDir();
  // Parent is a regular file → opening a child path fails (ENOTDIR).
  await Deno.writeTextFile(`${dir}/blocker`, "not a dir");
  let threw = false;
  try {
    createStreamLogWriter(`${dir}/blocker/stream.log`);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("FR-E18 close is idempotent", async () => {
  const dir = await Deno.makeTempDir();
  const writer = createStreamLogWriter(`${dir}/stream.log`);
  await writer.close();
  await writer.close(); // second close must not throw
  assertEquals(writer.takeWriteError(), null);
});
