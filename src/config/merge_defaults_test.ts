import { assertEquals } from "@std/assert";
import { parseConfig } from "./config.ts";

// Guards extractNodeSettings: workflow-only defaults (on_failure_script,
// prepare_command, memory_paths, …) must never leak into per-node settings.
// validateSettings rejects these keys when written in YAML, so leaking them
// through the defaults cascade is inconsistent and pollutes every node.

Deno.test("mergeDefaults — workflow-only defaults do not leak into node settings", () => {
  const yaml = `
name: test
version: "1"
defaults:
  memory_paths: ["memory/**"]
nodes:
  a:
    type: agent
    label: A
    prompt: do it
`;
  const config = parseConfig(yaml);
  const settings = config.nodes.a.settings as Record<string, unknown>;
  assertEquals("on_failure_script" in settings, false);
  assertEquals("prepare_command" in settings, false);
  assertEquals("memory_paths" in settings, false);
  // NodeSettings cascade fields are still present.
  assertEquals(settings.max_continuations, 3);
  assertEquals(settings.timeout_seconds, 1800);
});

Deno.test("mergeDefaults — defaults-level NodeSettings still cascade to nodes", () => {
  const yaml = `
name: test
version: "1"
defaults:
  timeout_seconds: 60
nodes:
  a:
    type: agent
    label: A
    prompt: do it
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.settings!.timeout_seconds, 60);
});
