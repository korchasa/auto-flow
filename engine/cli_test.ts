import { assertEquals, assertThrows } from "@std/assert";
import { getVersionString, parseArgs, VERSION } from "./cli.ts";

Deno.test("parseArgs — --prompt sets args.prompt", () => {
  const opts = parseArgs(["--prompt", "Fix the login bug"]);
  assertEquals(opts.args.prompt, "Fix the login bug");
});

Deno.test("parseArgs — no flags produces empty args", () => {
  const opts = parseArgs([]);
  assertEquals(opts.args.prompt, undefined);
  assertEquals(opts.config_path, ".auto-flow/pipeline.yaml");
});

Deno.test("parseArgs — --prompt combined with --config and -v", () => {
  const opts = parseArgs([
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
  const opts = parseArgs(["--skip", "meta-agent", "--only", "pm,tech-lead"]);
  assertEquals(opts.skip_nodes, ["meta-agent"]);
  assertEquals(opts.only_nodes, ["pm", "tech-lead"]);
});

Deno.test("parseArgs — --env sets env_overrides", () => {
  const opts = parseArgs(["--env", "DEBUG=true"]);
  assertEquals(opts.env_overrides.DEBUG, "true");
});

Deno.test("parseArgs — --env without = throws", () => {
  assertThrows(
    () => parseArgs(["--env", "INVALID"]),
    Error,
    "Invalid --env format",
  );
});

Deno.test("parseArgs — unknown flag throws", () => {
  assertThrows(
    () => parseArgs(["badarg"]),
    Error,
    "Unknown argument",
  );
});

Deno.test("parseArgs — generic --key value arg", () => {
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

Deno.test("getVersionString — format is 'auto-flow v<version>'", () => {
  assertEquals(getVersionString(), `auto-flow v${VERSION}`);
});
