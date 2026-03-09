import { assertEquals, assertThrows } from "@std/assert";
import { parseArgs } from "./cli.ts";

Deno.test("parseArgs — --task sets args.task and args.task_id from stem", () => {
  const opts = parseArgs(["--task", ".sdlc/tasks/my-feature.md"]);
  assertEquals(opts.args.task, ".sdlc/tasks/my-feature.md");
  assertEquals(opts.args.task_id, "my-feature");
});

Deno.test("parseArgs — --task with no extension uses full basename", () => {
  const opts = parseArgs(["--task", ".sdlc/tasks/my-feature"]);
  assertEquals(opts.args.task, ".sdlc/tasks/my-feature");
  assertEquals(opts.args.task_id, "my-feature");
});

Deno.test("parseArgs — --task with nested path extracts basename stem", () => {
  const opts = parseArgs(["--task", "a/b/c/foo.md"]);
  assertEquals(opts.args.task_id, "foo");
});

Deno.test("parseArgs — --task and --issue together throws", () => {
  assertThrows(
    () => parseArgs(["--task", "task.md", "--issue", "42"]),
    Error,
    "--task and --issue",
  );
});

Deno.test("parseArgs — --issue does not set task", () => {
  const opts = parseArgs(["--issue", "42"]);
  assertEquals(opts.args.issue, "42");
  assertEquals(opts.args.task, undefined);
});

Deno.test("parseArgs — --task does not set issue", () => {
  const opts = parseArgs(["--task", "task.md"]);
  assertEquals(opts.args.issue, undefined);
});

Deno.test("parseArgs — --task combined with --config and -v", () => {
  const opts = parseArgs([
    "--config",
    ".sdlc/pipeline-task.yaml",
    "--task",
    ".sdlc/tasks/refactor.md",
    "-v",
  ]);
  assertEquals(opts.config_path, ".sdlc/pipeline-task.yaml");
  assertEquals(opts.args.task, ".sdlc/tasks/refactor.md");
  assertEquals(opts.args.task_id, "refactor");
  assertEquals(opts.verbosity, "verbose");
});
