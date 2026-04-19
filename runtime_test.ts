import { assertEquals, assertThrows } from "@std/assert";
import { parseConfig } from "./config.ts";
import {
  getRuntimeAdapter,
  resolveRuntimeConfig,
} from "@korchasa/ai-ide-cli/runtime";
import type { NodeConfig, WorkflowDefaults } from "./types.ts";

Deno.test("parseConfig — defaults.runtime opencode accepts permission_mode bypassPermissions", () => {
  const yaml = `
name: test
version: "1"
defaults:
  runtime: opencode
  permission_mode: bypassPermissions
nodes:
  spec:
    type: agent
    label: Spec
    prompt: "write spec"
`;

  const config = parseConfig(yaml);
  assertEquals(config.defaults?.permission_mode, "bypassPermissions");
});

Deno.test("parseConfig — defaults.runtime opencode rejects unsupported permission_mode", () => {
  const yaml = `
name: test
version: "1"
defaults:
  runtime: opencode
  permission_mode: plan
nodes:
  spec:
    type: agent
    label: Spec
    prompt: "write spec"
`;

  assertThrows(
    () => parseConfig(yaml),
    Error,
    "only 'bypassPermissions' is supported",
  );
});

Deno.test("parseConfig — per-node opencode runtime accepts bypassPermissions", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: "write spec"
    runtime: opencode
    permission_mode: bypassPermissions
`;

  const config = parseConfig(yaml);
  assertEquals(config.nodes.spec.permission_mode, "bypassPermissions");
});

Deno.test("parseConfig — per-node opencode runtime rejects acceptEdits", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: "write spec"
    runtime: opencode
    permission_mode: acceptEdits
`;

  assertThrows(
    () => parseConfig(yaml),
    Error,
    "only 'bypassPermissions' is supported",
  );
});

Deno.test("parseConfig — defaults.hitl is allowed for opencode runtime nodes", () => {
  const yaml = `
name: test
version: "1"
defaults:
  hitl:
    ask_script: ask.sh
    check_script: check.sh
    poll_interval: 60
    timeout: 120
nodes:
  spec:
    type: agent
    label: Spec
    runtime: opencode
    prompt: "write spec"
`;

  parseConfig(yaml);
});

Deno.test("resolveRuntimeConfig — top-level claude runtime merges runtime_args", () => {
  const defaults: WorkflowDefaults = {
    runtime: "claude",
    runtime_args: { "--allowedTools": "Bash", "--verbose": "" },
    model: "claude-sonnet-4-6",
    permission_mode: "bypassPermissions",
  };
  const node: NodeConfig = {
    type: "agent",
    label: "Spec",
    prompt: "write spec",
  };

  const resolved = resolveRuntimeConfig({ defaults, node });

  assertEquals(resolved.runtime, "claude");
  assertEquals(resolved.args, {
    "--allowedTools": "Bash",
    "--verbose": "",
  });
  assertEquals(resolved.model, "claude-sonnet-4-6");
  assertEquals(resolved.permissionMode, "bypassPermissions");
});

Deno.test("resolveRuntimeConfig — body node overrides loop and defaults", () => {
  const defaults: WorkflowDefaults = {
    runtime: "claude",
    runtime_args: { "--thinking": "" },
    model: "claude-sonnet-4-6",
  };
  const loopNode: NodeConfig = {
    type: "loop",
    label: "Loop",
    runtime: "opencode",
    runtime_args: { "--variant": "high" },
    model: "anthropic/claude-sonnet-4-5",
  };
  const bodyNode: NodeConfig = {
    type: "agent",
    label: "Build",
    prompt: "build",
    runtime_args: { "--share": "" },
  };

  const resolved = resolveRuntimeConfig({
    defaults,
    node: bodyNode,
    parent: loopNode,
  });

  assertEquals(resolved.runtime, "opencode");
  assertEquals(resolved.args, {
    "--thinking": "",
    "--variant": "high",
    "--share": "",
  });
  assertEquals(resolved.model, "anthropic/claude-sonnet-4-5");
  assertEquals(resolved.permissionMode, undefined);
});

Deno.test("getRuntimeAdapter — opencode adapter declares HITL and permissionMode support", () => {
  const adapter = getRuntimeAdapter("opencode");
  assertEquals(adapter.id, "opencode");
  assertEquals(adapter.capabilities.hitl, true);
  assertEquals(adapter.capabilities.permissionMode, true);
});
