// FR-E47: budget controls — `--budget` CLI flag, `budget.max_turns`,
// per-node and workflow-level enforcement. Covered below by parseArgs
// and budget-related assertions.
import { assertEquals, assertThrows } from "@std/assert";
import {
  extractCliFlags,
  getVersionString,
  parseArgs,
  VERSION,
} from "./cli.ts";

Deno.test("parseArgs — --prompt sets args.prompt", () => {
  const opts = parseArgs(["--prompt", "Fix the login bug"]);
  assertEquals(opts.args.prompt, "Fix the login bug");
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

Deno.test("parseArgs — generic --key value passthrough", () => {
  const opts = parseArgs(["--foo", "bar"]);
  assertEquals(opts.args.foo, "bar");
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
