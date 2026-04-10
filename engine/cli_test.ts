import { assertEquals } from "@std/assert";
import {
  extractCliFlags,
  getVersionString,
  parseArgs,
  VERSION,
} from "./cli.ts";

Deno.test("parseArgs — --prompt sets args.prompt", async () => {
  const opts = await parseArgs(["--prompt", "Fix the login bug"]);
  assertEquals(opts.args.prompt, "Fix the login bug");
});

Deno.test("parseArgs — no flags produces empty args", async () => {
  const opts = await parseArgs([]);
  assertEquals(opts.args.prompt, undefined);
  assertEquals(opts.config_path, ".flowai-workflow/workflow.yaml");
});

Deno.test("parseArgs — --prompt combined with --config and -v", async () => {
  const opts = await parseArgs([
    "--config",
    "custom.yaml",
    "--prompt",
    "Refactor auth module",
    "-v",
  ]);
  assertEquals(opts.config_path, "custom.yaml");
  assertEquals(opts.args.prompt, "Refactor auth module");
  assertEquals(opts.verbosity, "verbose");
});

Deno.test("parseArgs — --resume sets resume and run_id", async () => {
  const opts = await parseArgs(["--resume", "20260308T143022"]);
  assertEquals(opts.resume, true);
  assertEquals(opts.run_id, "20260308T143022");
});

Deno.test("parseArgs — --dry-run", async () => {
  const opts = await parseArgs(["--dry-run"]);
  assertEquals(opts.dry_run, true);
});

Deno.test("parseArgs — --skip and --only", async () => {
  const opts = await parseArgs([
    "--skip",
    "meta-agent",
    "--only",
    "pm,tech-lead",
  ]);
  assertEquals(opts.skip_nodes, ["meta-agent"]);
  assertEquals(opts.only_nodes, ["pm", "tech-lead"]);
});

Deno.test("parseArgs — --env sets env_overrides", async () => {
  const opts = await parseArgs(["--env", "DEBUG=true"]);
  assertEquals(opts.env_overrides.DEBUG, "true");
});

Deno.test("parseArgs — --env without = rejects", async () => {
  try {
    await parseArgs(["--env", "INVALID"]);
    throw new Error("should have thrown");
  } catch (e) {
    assertEquals((e as Error).message.includes("Invalid --env format"), true);
  }
});

Deno.test("parseArgs — unknown flag rejects", async () => {
  try {
    await parseArgs(["badarg"]);
    throw new Error("should have thrown");
  } catch (e) {
    assertEquals((e as Error).message.includes("Unknown argument"), true);
  }
});

Deno.test("parseArgs — generic --key value arg", async () => {
  const opts = await parseArgs(["--foo", "bar"]);
  assertEquals(opts.args.foo, "bar");
});

Deno.test("parseArgs — -s sets semi-verbose", async () => {
  const opts = await parseArgs(["-s"]);
  assertEquals(opts.verbosity, "semi-verbose");
});

Deno.test("parseArgs — --semi-verbose sets semi-verbose", async () => {
  const opts = await parseArgs(["--semi-verbose"]);
  assertEquals(opts.verbosity, "semi-verbose");
});

Deno.test("parseArgs — -s combined with other flags", async () => {
  const opts = await parseArgs(["-s", "--prompt", "Do something"]);
  assertEquals(opts.verbosity, "semi-verbose");
  assertEquals(opts.args.prompt, "Do something");
});

Deno.test("parseArgs — default verbosity is normal", async () => {
  const opts = await parseArgs([]);
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
    "--config",
    "x.yaml",
    "--skip-update-check",
    "-v",
  ]);
  assertEquals(skipUpdateCheck, true);
  assertEquals(remaining, ["--config", "x.yaml", "-v"]);
});

Deno.test("extractCliFlags — output passes through parseArgs cleanly", () => {
  const { skipUpdateCheck, remaining } = extractCliFlags([
    "--skip-update-check",
    "--prompt",
    "Ship it",
    "-q",
  ]);
  assertEquals(skipUpdateCheck, true);
  const opts = parseArgs(remaining);
  assertEquals(opts.args.prompt, "Ship it");
  assertEquals(opts.verbosity, "quiet");
});
