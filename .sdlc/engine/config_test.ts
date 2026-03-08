import { assertEquals, assertThrows } from "jsr:@std/assert";
import { DEFAULT_SETTINGS, parseConfig } from "./config.ts";

const MINIMAL_AGENT = `
name: test-pipeline
version: "1"
nodes:
  spec:
    type: agent
    label: "Write spec"
    prompt: ".sdlc/agents/pm.md"
    task_template: "Write a spec for issue #{{args.issue}}"
`;

const MINIMAL_HUMAN = `
name: test-pipeline
version: "1"
nodes:
  review:
    type: human
    label: "Review output"
    question: "Approve the spec?"
    options: ["approve", "reject"]
`;

Deno.test("parseConfig — minimal agent node", () => {
  const config = parseConfig(MINIMAL_AGENT);
  assertEquals(config.name, "test-pipeline");
  assertEquals(config.version, "1");
  assertEquals(Object.keys(config.nodes).length, 1);
  assertEquals(config.nodes.spec.type, "agent");
  assertEquals(config.nodes.spec.label, "Write spec");
});

Deno.test("parseConfig — defaults are merged into node settings", () => {
  const config = parseConfig(MINIMAL_AGENT);
  const settings = config.nodes.spec.settings!;
  assertEquals(settings.max_continuations, DEFAULT_SETTINGS.max_continuations);
  assertEquals(settings.timeout_seconds, DEFAULT_SETTINGS.timeout_seconds);
  assertEquals(settings.on_error, DEFAULT_SETTINGS.on_error);
  assertEquals(settings.max_retries, DEFAULT_SETTINGS.max_retries);
  assertEquals(settings.retry_delay_seconds, DEFAULT_SETTINGS.retry_delay_seconds);
});

Deno.test("parseConfig — pipeline defaults override global defaults", () => {
  const yaml = `
name: test
version: "1"
defaults:
  max_continuations: 5
  max_parallel: 3
nodes:
  a:
    type: agent
    label: A
    task_template: "do something"
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.settings!.max_continuations, 5);
  assertEquals(config.defaults!.max_parallel, 3);
});

Deno.test("parseConfig — node settings override pipeline defaults", () => {
  const yaml = `
name: test
version: "1"
defaults:
  max_continuations: 5
nodes:
  a:
    type: agent
    label: A
    task_template: "do something"
    settings:
      max_continuations: 10
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.settings!.max_continuations, 10);
});

Deno.test("parseConfig — loop node with body", () => {
  const yaml = `
name: test
version: "1"
nodes:
  executor:
    type: agent
    label: Executor
    task_template: "implement"
  qa:
    type: agent
    label: QA
    task_template: "verify"
  impl-loop:
    type: loop
    label: Implementation loop
    body: [executor, qa]
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    max_iterations: 3
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes["impl-loop"].type, "loop");
  assertEquals(config.nodes["impl-loop"].body, ["executor", "qa"]);
  assertEquals(config.nodes["impl-loop"].condition_node, "qa");
  assertEquals(config.nodes["impl-loop"].exit_value, "PASS");
});

Deno.test("parseConfig — human node", () => {
  const config = parseConfig(MINIMAL_HUMAN);
  assertEquals(config.nodes.review.type, "human");
  assertEquals(config.nodes.review.question, "Approve the spec?");
  assertEquals(config.nodes.review.options, ["approve", "reject"]);
});

Deno.test("parseConfig — merge node", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    task_template: "do A"
  b:
    type: agent
    label: B
    task_template: "do B"
  combined:
    type: merge
    label: Combine results
    inputs: [a, b]
    merge_strategy: copy_all
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.combined.type, "merge");
  assertEquals(config.nodes.combined.inputs, ["a", "b"]);
});

Deno.test("parseConfig — validation rules", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    task_template: "write spec"
    validate:
      - type: file_exists
        path: "{{node_dir}}/01-spec.md"
      - type: file_not_empty
        path: "{{node_dir}}/01-spec.md"
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.spec.validate!.length, 2);
  assertEquals(config.nodes.spec.validate![0].type, "file_exists");
});

Deno.test("parseConfig — env vars", () => {
  const yaml = `
name: test
version: "1"
env:
  API_KEY: test-key
nodes:
  a:
    type: agent
    label: A
    task_template: "use {{env.API_KEY}}"
`;
  const config = parseConfig(yaml);
  assertEquals(config.env!.API_KEY, "test-key");
});

Deno.test("parseConfig — hooks (before/after)", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    task_template: "do something"
    before: "git pull"
    after: "deno task check"
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.before, "git pull");
  assertEquals(config.nodes.a.after, "deno task check");
});

// --- Error cases ---

Deno.test("parseConfig — missing name throws", () => {
  assertThrows(
    () => parseConfig(`version: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    task_template: x`),
    Error,
    "non-empty 'name'",
  );
});

Deno.test("parseConfig — wrong version throws", () => {
  assertThrows(
    () => parseConfig(`name: test\nversion: "2"\nnodes:\n  a:\n    type: agent\n    label: A\n    task_template: x`),
    Error,
    "Unsupported pipeline config version",
  );
});

Deno.test("parseConfig — missing nodes throws", () => {
  assertThrows(
    () => parseConfig(`name: test\nversion: "1"`),
    Error,
    "requires a 'nodes' object",
  );
});

Deno.test("parseConfig — empty nodes throws", () => {
  assertThrows(
    () => parseConfig(`name: test\nversion: "1"\nnodes: {}`),
    Error,
    "at least one node",
  );
});

Deno.test("parseConfig — invalid node type throws", () => {
  assertThrows(
    () => parseConfig(`name: test\nversion: "1"\nnodes:\n  a:\n    type: invalid\n    label: A`),
    Error,
    "invalid type 'invalid'",
  );
});

Deno.test("parseConfig — missing label throws", () => {
  assertThrows(
    () => parseConfig(`name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    task_template: x`),
    Error,
    "non-empty 'label'",
  );
});

Deno.test("parseConfig — agent without prompt or task_template throws", () => {
  assertThrows(
    () => parseConfig(`name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A`),
    Error,
    "requires at least 'prompt' or 'task_template'",
  );
});

Deno.test("parseConfig — input referencing unknown node throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    task_template: x\n    inputs: [nonexistent]`,
      ),
    Error,
    "unknown input node 'nonexistent'",
  );
});

Deno.test("parseConfig — self-referencing input throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    task_template: x\n    inputs: [a]`,
      ),
    Error,
    "cannot reference itself",
  );
});

Deno.test("parseConfig — loop without body throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: loop\n    label: L\n    condition_node: x\n    condition_field: f\n    exit_value: v`,
      ),
    Error,
    "non-empty 'body'",
  );
});

Deno.test("parseConfig — loop condition_node not in body throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  executor:\n    type: agent\n    label: E\n    task_template: x\n  qa:\n    type: agent\n    label: Q\n    task_template: x\n  loop:\n    type: loop\n    label: L\n    body: [executor]\n    condition_node: qa\n    condition_field: verdict\n    exit_value: PASS`,
      ),
    Error,
    "must be in body",
  );
});

Deno.test("parseConfig — human without question throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: human\n    label: H`,
      ),
    Error,
    "non-empty 'question'",
  );
});

Deno.test("parseConfig — invalid validation rule type throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    task_template: x\n    validate:\n      - type: invalid\n        path: foo`,
      ),
    Error,
    "invalid type 'invalid'",
  );
});

Deno.test("parseConfig — invalid on_error throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    task_template: x\n    settings:\n      on_error: maybe`,
      ),
    Error,
    'on_error must be "fail" or "continue"',
  );
});
