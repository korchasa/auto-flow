import { assertEquals } from "@std/assert";
import { saveAgentLog } from "./log.ts";
import type { ClaudeCliOutput } from "./types.ts";

/** Create a temp directory structure simulating a run. */
async function withTempRunDir(
  fn: (runDir: string) => Promise<void>,
): Promise<void> {
  const tmp = await Deno.makeTempDir({ prefix: "log-test-" });
  try {
    await fn(tmp);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

function makeSampleOutput(): ClaudeCliOutput {
  return {
    result: "Task completed successfully.",
    session_id: "abc-123-def",
    total_cost_usd: 0.05,
    duration_ms: 12000,
    duration_api_ms: 10000,
    num_turns: 3,
    is_error: false,
  };
}

Deno.test("saveAgentLog — writes JSON log file", async () => {
  await withTempRunDir(async (runDir) => {
    const output = makeSampleOutput();
    await saveAgentLog(runDir, "pm", output);

    const jsonPath = `${runDir}/logs/pm.json`;
    const content = await Deno.readTextFile(jsonPath);
    const parsed = JSON.parse(content) as ClaudeCliOutput;

    assertEquals(parsed.session_id, "abc-123-def");
    assertEquals(parsed.result, "Task completed successfully.");
    assertEquals(parsed.total_cost_usd, 0.05);
    assertEquals(parsed.is_error, false);
  });
});

Deno.test("saveAgentLog — copies JSONL transcript when found", async () => {
  await withTempRunDir(async (runDir) => {
    // Create a fake claude projects dir with a session transcript
    const claudeDir = `${runDir}/_fake_claude_projects/proj-hash`;
    await Deno.mkdir(claudeDir, { recursive: true });
    const transcriptContent = '{"type":"init"}\n{"type":"message"}\n';
    await Deno.writeTextFile(
      `${claudeDir}/abc-123-def.jsonl`,
      transcriptContent,
    );

    const output = makeSampleOutput();
    await saveAgentLog(
      runDir,
      "tech-lead",
      output,
      `${runDir}/_fake_claude_projects`,
    );

    // JSON log exists
    const jsonPath = `${runDir}/logs/tech-lead.json`;
    const json = JSON.parse(await Deno.readTextFile(jsonPath));
    assertEquals(json.session_id, "abc-123-def");

    // JSONL transcript copied
    const jsonlPath = `${runDir}/logs/tech-lead.jsonl`;
    const jsonl = await Deno.readTextFile(jsonlPath);
    assertEquals(jsonl, transcriptContent);
  });
});

Deno.test("saveAgentLog — no error when JSONL transcript not found", async () => {
  await withTempRunDir(async (runDir) => {
    const output = makeSampleOutput();
    // Pass a non-existent claude dir — should not throw
    await saveAgentLog(runDir, "qa", output, "/nonexistent/path");

    // JSON log still written
    const jsonPath = `${runDir}/logs/qa.json`;
    const content = await Deno.readTextFile(jsonPath);
    const parsed = JSON.parse(content);
    assertEquals(parsed.session_id, "abc-123-def");
  });
});

Deno.test("saveAgentLog — creates logs directory if missing", async () => {
  await withTempRunDir(async (runDir) => {
    const output = makeSampleOutput();
    await saveAgentLog(runDir, "developer", output);

    const jsonPath = `${runDir}/logs/developer.json`;
    const stat = await Deno.stat(jsonPath);
    assertEquals(stat.isFile, true);
  });
});

Deno.test("saveAgentLog — finds transcript in nested project dirs", async () => {
  await withTempRunDir(async (runDir) => {
    // Create nested dirs simulating ~/.claude/projects/<hash>/
    const projDir = `${runDir}/_fake_projects`;
    const hashDir1 = `${projDir}/hash-aaa`;
    const hashDir2 = `${projDir}/hash-bbb`;
    await Deno.mkdir(hashDir1, { recursive: true });
    await Deno.mkdir(hashDir2, { recursive: true });

    // Put transcript in second dir
    const transcriptData = '{"role":"user"}\n';
    await Deno.writeTextFile(
      `${hashDir2}/session-abc-123-def-log.jsonl`,
      transcriptData,
    );

    const output = makeSampleOutput();
    await saveAgentLog(runDir, "reviewer", output, projDir);

    const jsonlPath = `${runDir}/logs/reviewer.jsonl`;
    const content = await Deno.readTextFile(jsonlPath);
    assertEquals(content, transcriptData);
  });
});
