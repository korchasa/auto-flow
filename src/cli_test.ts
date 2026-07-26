// FR-E47: budget controls — `--budget` CLI flag, `budget.max_turns`,
// per-node and workflow-level enforcement. Covered below by parseArgs
// and budget-related assertions.
import { assertEquals, assertThrows } from "@std/assert";
import {
  extractCliFlags,
  getVersionString,
  normalizeWorkflowDir,
  parseAnswerArgs,
  parseArgs,
  resolveActiveWorkflow,
  VERSION,
} from "./cli.ts";

Deno.test("parseArgs — --prompt sets args.prompt", () => {
  const opts = parseArgs(["--prompt", "Fix the login bug"]);
  assertEquals(opts.args.prompt, "Fix the login bug");
});

Deno.test("FR-E84 parseArgs — --run-id pins a fresh run id without resume", () => {
  const opts = parseArgs(["wf", "--run-id", "run-xyz"]);
  assertEquals(opts.run_id, "run-xyz");
  assertEquals(opts.resume, false);
});

Deno.test("parseArgs — no args leaves config_path empty (runEngine enforces)", () => {
  const opts = parseArgs([]);
  assertEquals(opts.args.prompt, undefined);
  assertEquals(opts.config_path, "");
});

Deno.test("parseArgs — positional workflow sets config_path to <dir>/workflow.yaml", () => {
  const opts = parseArgs([
    ".flowai-workflow/github-inbox",
    "--prompt",
    "Refactor auth module",
    "-v",
  ]);
  assertEquals(
    opts.config_path,
    ".flowai-workflow/github-inbox/workflow.yaml",
  );
  assertEquals(opts.args.prompt, "Refactor auth module");
  assertEquals(opts.verbosity, "verbose");
});

Deno.test("parseArgs — positional accepted after flags", () => {
  const opts = parseArgs([
    "--prompt",
    "Refactor auth",
    "-v",
    ".flowai-workflow/github-inbox",
  ]);
  assertEquals(
    opts.config_path,
    ".flowai-workflow/github-inbox/workflow.yaml",
  );
});

Deno.test("parseArgs — trailing slash on positional is normalized", () => {
  const opts = parseArgs([".flowai-workflow/github-inbox/"]);
  assertEquals(
    opts.config_path,
    ".flowai-workflow/github-inbox/workflow.yaml",
  );
});

Deno.test("parseArgs — second positional rejects", () => {
  assertThrows(
    () => parseArgs([".flowai-workflow/a", ".flowai-workflow/b"]),
    Error,
    "Unexpected positional",
  );
});

Deno.test("parseArgs — --config flag rejected with positional hint (FR-E53)", () => {
  assertThrows(
    () => parseArgs(["--config", "x.yaml"]),
    Error,
    "positional argument",
  );
});

Deno.test("parseArgs — --workflow flag rejected with positional hint (FR-E53)", () => {
  assertThrows(
    () => parseArgs(["--workflow", ".flowai-workflow/x"]),
    Error,
    "positional argument",
  );
});

Deno.test("parseArgs — --resume sets resume and run_id", () => {
  const opts = parseArgs(["--resume", "20260308T143022"]);
  assertEquals(opts.resume, true);
  assertEquals(opts.run_id, "20260308T143022");
});

Deno.test("parseArgs — --dry-run", () => {
  const opts = parseArgs(["--dry-run"]);
  assertEquals(opts.dry_run, true);
});

Deno.test("parseArgs — --skip and --only", () => {
  const opts = parseArgs([
    "--skip",
    "meta-agent",
    "--only",
    "pm,tech-lead",
  ]);
  assertEquals(opts.skip_nodes, ["meta-agent"]);
  assertEquals(opts.only_nodes, ["pm", "tech-lead"]);
});

Deno.test("parseArgs — --env sets env_overrides", () => {
  const opts = parseArgs(["--env", "DEBUG=true"]);
  assertEquals(opts.env_overrides.DEBUG, "true");
});

Deno.test("parseArgs — --env without = rejects", () => {
  assertThrows(
    () => parseArgs(["--env", "INVALID"]),
    Error,
    "Invalid --env format",
  );
});

Deno.test("parseArgs — generic --key=value passthrough", () => {
  const opts = parseArgs(["--foo=bar"]);
  assertEquals(opts.args.foo, "bar");
});

Deno.test("parseArgs — --key=value keeps '=' inside the value", () => {
  const opts = parseArgs(["--filter=a=b"]);
  assertEquals(opts.args.filter, "a=b");
});

Deno.test("parseArgs — unknown detached flag is rejected", () => {
  // The detached form used to be a silent catch-all: a mistyped engine flag
  // became a workflow argument and swallowed the following token.
  assertThrows(
    () => parseArgs(["--dryrun", "x"]),
    Error,
    "Unknown flag: --dryrun",
  );
  assertThrows(
    () => parseArgs([".flowai-workflow/wf", "--validate"]),
    Error,
    "Unknown flag: --validate",
  );
});

Deno.test("parseArgs — -s sets semi-verbose", () => {
  const opts = parseArgs(["-s"]);
  assertEquals(opts.verbosity, "semi-verbose");
});

Deno.test("parseArgs — --semi-verbose sets semi-verbose", () => {
  const opts = parseArgs(["--semi-verbose"]);
  assertEquals(opts.verbosity, "semi-verbose");
});

Deno.test("parseArgs — -s combined with other flags", () => {
  const opts = parseArgs(["-s", "--prompt", "Do something"]);
  assertEquals(opts.verbosity, "semi-verbose");
  assertEquals(opts.args.prompt, "Do something");
});

Deno.test("parseArgs — default verbosity is normal", () => {
  const opts = parseArgs([]);
  assertEquals(opts.verbosity, "normal");
});

Deno.test("VERSION — is a non-empty string", () => {
  assertEquals(typeof VERSION, "string");
  assertEquals(VERSION.length > 0, true);
});

Deno.test("getVersionString — format is 'flowai-workflow v<version>'", () => {
  assertEquals(getVersionString(), `flowai-workflow v${VERSION}`);
});

Deno.test("extractCliFlags — absent flag keeps args intact", () => {
  const { skipUpdateCheck, remaining } = extractCliFlags([
    "--prompt",
    "Fix",
    "-v",
  ]);
  assertEquals(skipUpdateCheck, false);
  assertEquals(remaining, ["--prompt", "Fix", "-v"]);
});

Deno.test("extractCliFlags — --skip-update-check is stripped and flag set", () => {
  const { skipUpdateCheck, remaining } = extractCliFlags([
    "--skip-update-check",
    "--prompt",
    "Fix",
  ]);
  assertEquals(skipUpdateCheck, true);
  assertEquals(remaining, ["--prompt", "Fix"]);
});

Deno.test("extractCliFlags — --skip-update-check can appear anywhere", () => {
  const { skipUpdateCheck, remaining } = extractCliFlags([
    ".flowai-workflow/x",
    "--skip-update-check",
    "-v",
  ]);
  assertEquals(skipUpdateCheck, true);
  assertEquals(remaining, [".flowai-workflow/x", "-v"]);
});

Deno.test("FR-E65 extractCliFlags — cycles defaults to 1 when --cycles is absent", () => {
  const { cycles, remaining } = extractCliFlags(["--prompt", "Fix"]);
  assertEquals(cycles, 1);
  assertEquals(remaining, ["--prompt", "Fix"]);
});

Deno.test("FR-E65 extractCliFlags — --cycles is stripped and parsed as integer", () => {
  const { cycles, remaining } = extractCliFlags([
    ".flowai-workflow/x",
    "--cycles",
    "3",
    "-v",
  ]);
  assertEquals(cycles, 3);
  assertEquals(remaining, [".flowai-workflow/x", "-v"]);
});

Deno.test("FR-E65 extractCliFlags — --cycles rejects non-positive or non-integer values", () => {
  assertThrows(
    () => extractCliFlags(["--cycles", "0"]),
    Error,
    "Invalid --cycles value",
  );
  assertThrows(
    () => extractCliFlags(["--cycles", "-1"]),
    Error,
    "Invalid --cycles value",
  );
  assertThrows(
    () => extractCliFlags(["--cycles", "1.5"]),
    Error,
    "Invalid --cycles value",
  );
  assertThrows(
    () => extractCliFlags(["--cycles", "abc"]),
    Error,
    "Invalid --cycles value",
  );
});

Deno.test("extractCliFlags — output passes through parseArgs cleanly", () => {
  const { skipUpdateCheck, remaining } = extractCliFlags([
    "--skip-update-check",
    ".flowai-workflow/x",
    "--prompt",
    "Ship it",
    "-q",
  ]);
  assertEquals(skipUpdateCheck, true);
  const opts = parseArgs(remaining);
  assertEquals(opts.config_path, ".flowai-workflow/x/workflow.yaml");
  assertEquals(opts.args.prompt, "Ship it");
  assertEquals(opts.verbosity, "quiet");
});

Deno.test("parseArgs — --budget sets budget_usd as float", () => {
  const opts = parseArgs(["--budget", "12.5"]);
  assertEquals(opts.budget_usd, 12.5);
});

Deno.test("parseArgs — --budget integer accepted", () => {
  const opts = parseArgs(["--budget", "50"]);
  assertEquals(opts.budget_usd, 50);
});

Deno.test("parseArgs — missing --budget leaves budget_usd undefined", () => {
  const opts = parseArgs([]);
  assertEquals(opts.budget_usd, undefined);
});

Deno.test("parseArgs — --budget 0 rejects", () => {
  assertThrows(
    () => parseArgs(["--budget", "0"]),
    Error,
    "Invalid --budget",
  );
});

Deno.test("parseArgs — --budget negative rejects", () => {
  assertThrows(
    () => parseArgs(["--budget", "-1"]),
    Error,
    "Invalid --budget",
  );
});

Deno.test("parseArgs — --budget non-numeric rejects", () => {
  assertThrows(
    () => parseArgs(["--budget", "abc"]),
    Error,
    "Invalid --budget",
  );
});

Deno.test("FR-E73 normalizeWorkflowDir strips trailing slashes", () => {
  assertEquals(
    normalizeWorkflowDir(".flowai-workflow/x"),
    ".flowai-workflow/x",
  );
  assertEquals(
    normalizeWorkflowDir(".flowai-workflow/x/"),
    ".flowai-workflow/x",
  );
  assertEquals(
    normalizeWorkflowDir(".flowai-workflow/x///"),
    ".flowai-workflow/x",
  );
});

// --- FR-E75: `answer` subcommand argument parsing ---

Deno.test("FR-E78 parseAnswerArgs — workflow auto-resolved when --workflow omitted", () => {
  const a = parseAnswerArgs([
    "20260529T094727",
    "--node",
    "specification",
    "монетизация",
  ]);
  assertEquals(a.workflowDir, undefined);
  assertEquals(a.runId, "20260529T094727");
  assertEquals(a.nodeId, "specification");
  assertEquals(a.text, "монетизация");
});

Deno.test("FR-E75 parseAnswerArgs — explicit --workflow normalises trailing slash", () => {
  const a = parseAnswerArgs([
    "--workflow",
    ".flowai-workflow/x/",
    "r1",
    "--node",
    "n",
    "hi",
  ]);
  assertEquals(a.workflowDir, ".flowai-workflow/x");
  assertEquals(a.runId, "r1");
});

Deno.test("FR-E75 parseAnswerArgs — joins multi-word unquoted text", () => {
  const a = parseAnswerArgs([
    "r1",
    "--node",
    "n",
    "go",
    "with",
    "monetization",
  ]);
  assertEquals(a.text, "go with monetization");
});

Deno.test("FR-E75 parseAnswerArgs — --node=value form accepted", () => {
  const a = parseAnswerArgs([
    "r1",
    "--node=spec",
    "hi",
  ]);
  assertEquals(a.nodeId, "spec");
  assertEquals(a.text, "hi");
});

Deno.test("FR-E75 parseAnswerArgs — --workflow=value form accepted", () => {
  const a = parseAnswerArgs([
    "--workflow=.flowai-workflow/x",
    "r1",
    "--node",
    "n",
    "hi",
  ]);
  assertEquals(a.workflowDir, ".flowai-workflow/x");
});

Deno.test("FR-E75 parseAnswerArgs — missing --node rejects", () => {
  assertThrows(
    () => parseAnswerArgs(["r1", "answer-text"]),
    Error,
    "--node",
  );
});

Deno.test("FR-E75 parseAnswerArgs — missing text rejects", () => {
  assertThrows(
    () => parseAnswerArgs(["r1", "--node", "n"]),
    Error,
    "text",
  );
});

Deno.test("FR-E75 parseAnswerArgs — missing run-id rejects", () => {
  assertThrows(
    () => parseAnswerArgs(["--node", "n"]),
    Error,
    "run-id",
  );
});

Deno.test("FR-E78 resolveActiveWorkflow returns FLOWAI_WORKFLOW when set", async () => {
  const dir = await Deno.makeTempDir({ prefix: "mcp-resolve-explicit-" });
  try {
    const result = await resolveActiveWorkflow({
      env: { FLOWAI_WORKFLOW: "/explicit/path" },
      cwd: dir,
    });
    assertEquals(result, "/explicit/path");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E78 resolveActiveWorkflow picks the single workflow under .flowai-workflow/", async () => {
  const root = await Deno.makeTempDir({ prefix: "mcp-resolve-single-" });
  try {
    const wf = `${root}/.flowai-workflow/only-one`;
    await Deno.mkdir(wf, { recursive: true });
    await Deno.writeTextFile(`${wf}/workflow.yaml`, "nodes: []\n");
    const result = await resolveActiveWorkflow({ env: {}, cwd: root });
    assertEquals(result, wf);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("FR-E78 resolveActiveWorkflow prefers github-inbox when multiple exist", async () => {
  const root = await Deno.makeTempDir({ prefix: "mcp-resolve-default-" });
  try {
    for (const name of ["github-inbox", "other"]) {
      const wf = `${root}/.flowai-workflow/${name}`;
      await Deno.mkdir(wf, { recursive: true });
      await Deno.writeTextFile(`${wf}/workflow.yaml`, "nodes: []\n");
    }
    const result = await resolveActiveWorkflow({ env: {}, cwd: root });
    assertEquals(result, `${root}/.flowai-workflow/github-inbox`);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("FR-E78 resolveActiveWorkflow returns null when no bundle exists", async () => {
  const root = await Deno.makeTempDir({ prefix: "mcp-resolve-empty-" });
  try {
    const result = await resolveActiveWorkflow({ env: {}, cwd: root });
    assertEquals(result, null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("FR-E78 resolveActiveWorkflow ignores CLAUDE_PROJECT_DIR (host-agnostic)", async () => {
  const cwdRoot = await Deno.makeTempDir({ prefix: "mcp-resolve-cwd-" });
  const elsewhere = await Deno.makeTempDir({ prefix: "mcp-resolve-other-" });
  try {
    // Engine MUST NOT consult host-specific env (CLAUDE_PROJECT_DIR is
    // Claude-only); the .mcp.json contract pins cwd to the project
    // root for every host, so only cwd is relevant.
    const wfElsewhere = `${elsewhere}/.flowai-workflow/single`;
    await Deno.mkdir(wfElsewhere, { recursive: true });
    await Deno.writeTextFile(`${wfElsewhere}/workflow.yaml`, "nodes: []\n");
    // No workflow folder under cwd → null even though CLAUDE_PROJECT_DIR
    // points at a valid one.
    const result = await resolveActiveWorkflow({
      env: { CLAUDE_PROJECT_DIR: elsewhere },
      cwd: cwdRoot,
    });
    assertEquals(result, null);
  } finally {
    await Deno.remove(cwdRoot, { recursive: true });
    await Deno.remove(elsewhere, { recursive: true });
  }
});

Deno.test("FR-E73 mcp subcommand parses the same workflow path shape as run", () => {
  // `run <workflow>` resolves the positional to `<workflow>/workflow.yaml`
  // via parseArgs; `mcp <workflow>` only normalises the trailing slash and
  // passes the directory through. Both code paths must agree on the
  // normalisation rule so `mcp` and `run` see the same workflow folder.
  const runWorkflowYaml =
    parseArgs([".flowai-workflow/github-inbox/"]).config_path;
  const mcpWorkflowDir = normalizeWorkflowDir(".flowai-workflow/github-inbox/");
  assertEquals(runWorkflowYaml, `${mcpWorkflowDir}/workflow.yaml`);
});
