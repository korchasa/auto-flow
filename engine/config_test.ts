import { assertEquals, assertThrows } from "@std/assert";
import { DEFAULT_SETTINGS, parseConfig } from "./config.ts";

const MINIMAL_AGENT = `
name: test-pipeline
version: "1"
nodes:
  spec:
    type: agent
    label: "Write spec"
    prompt: "agents/pm/SKILL.md"
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
  assertEquals(
    settings.retry_delay_seconds,
    DEFAULT_SETTINGS.retry_delay_seconds,
  );
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

Deno.test("parseConfig — loop node with inline nodes", () => {
  const yaml = `
name: test
version: "1"
nodes:
  impl-loop:
    type: loop
    label: Implementation loop
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    max_iterations: 3
    nodes:
      executor:
        type: agent
        label: Executor
        task_template: "implement"
      qa:
        type: agent
        label: QA
        task_template: "verify"
        inputs: [executor]
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes["impl-loop"].type, "loop");
  assertEquals(config.nodes["impl-loop"].nodes != null, true);
  assertEquals(Object.keys(config.nodes["impl-loop"].nodes!).length, 2);
  assertEquals(config.nodes["impl-loop"].nodes!.executor.type, "agent");
  assertEquals(config.nodes["impl-loop"].nodes!.qa.inputs, ["executor"]);
  assertEquals(config.nodes["impl-loop"].condition_node, "qa");
  assertEquals(config.nodes["impl-loop"].exit_value, "PASS");
});

Deno.test("parseConfig — loop node single body node (no inputs required)", () => {
  const yaml = `
name: test
version: "1"
nodes:
  my-loop:
    type: loop
    label: Single body loop
    condition_node: worker
    condition_field: status
    exit_value: DONE
    nodes:
      worker:
        type: agent
        label: Worker
        task_template: "do work"
`;
  const config = parseConfig(yaml);
  assertEquals(Object.keys(config.nodes["my-loop"].nodes!).length, 1);
});

Deno.test("parseConfig — loop body node inputs reference external top-level node", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    task_template: "write spec"
  impl-loop:
    type: loop
    label: Impl loop
    inputs: [spec]
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    nodes:
      executor:
        type: agent
        label: Executor
        task_template: "implement"
        inputs: [spec]
      qa:
        type: agent
        label: QA
        task_template: "verify"
        inputs: [executor]
`;
  // Should not throw — body node inputs referencing external top-level nodes are valid
  const config = parseConfig(yaml);
  assertEquals(config.nodes["impl-loop"].nodes!.executor.inputs, ["spec"]);
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
    () =>
      parseConfig(
        `version: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    task_template: x`,
      ),
    Error,
    "non-empty 'name'",
  );
});

Deno.test("parseConfig — wrong version throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "2"\nnodes:\n  a:\n    type: agent\n    label: A\n    task_template: x`,
      ),
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
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: invalid\n    label: A`,
      ),
    Error,
    "invalid type 'invalid'",
  );
});

Deno.test("parseConfig — missing label throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    task_template: x`,
      ),
    Error,
    "non-empty 'label'",
  );
});

Deno.test("parseConfig — agent without prompt or task_template throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A`,
      ),
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

Deno.test("parseConfig — loop without nodes throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: loop\n    label: L\n    condition_node: x\n    condition_field: f\n    exit_value: v`,
      ),
    Error,
    "non-empty 'nodes'",
  );
});

Deno.test("parseConfig — loop condition_node not in nodes throws", () => {
  const yaml = `
name: test
version: "1"
nodes:
  loop:
    type: loop
    label: L
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    nodes:
      executor:
        type: agent
        label: E
        task_template: x
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "must be a key in 'nodes'",
  );
});

Deno.test("parseConfig — loop multiple body nodes without inputs ordering throws", () => {
  const yaml = `
name: test
version: "1"
nodes:
  loop:
    type: loop
    label: L
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    nodes:
      executor:
        type: agent
        label: E
        task_template: x
      qa:
        type: agent
        label: Q
        task_template: x
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "at least one body node must declare",
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

// --- run_on validation tests ---

Deno.test("parseConfig — run_on: 'always' is valid", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    task_template: "do something"
    run_on: always
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.run_on, "always");
});

Deno.test("parseConfig — run_on: 'success' is valid", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    task_template: "do something"
    run_on: success
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.run_on, "success");
});

Deno.test("parseConfig — run_on: 'failure' is valid", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    task_template: "do something"
    run_on: failure
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.run_on, "failure");
});

Deno.test("parseConfig — invalid run_on value throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    task_template: x\n    run_on: sometimes`,
      ),
    Error,
    "invalid run_on value 'sometimes'. Must be one of: always, success, failure",
  );
});

Deno.test("parseConfig — run_on absent is valid (undefined)", () => {
  const config = parseConfig(MINIMAL_AGENT);
  assertEquals(config.nodes.spec.run_on, undefined);
});

// --- run_always → run_on normalization tests ---

Deno.test("parseConfig — run_always: true normalized to run_on: 'always'", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    task_template: "do something"
    run_always: true
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.run_on, "always");
  assertEquals(config.nodes.a.run_always, undefined);
});

Deno.test("parseConfig — run_always: false normalized (no run_on set)", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    task_template: "do something"
    run_always: false
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.run_on, undefined);
  assertEquals(config.nodes.a.run_always, undefined);
});

Deno.test("parseConfig — run_on wins over run_always when both present", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    task_template: "do something"
    run_always: true
    run_on: success
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.run_on, "success");
  assertEquals(config.nodes.a.run_always, undefined);
});

Deno.test("parseConfig — run_always absent leaves no run_on", () => {
  const config = parseConfig(MINIMAL_AGENT);
  assertEquals(config.nodes.spec.run_on, undefined);
  assertEquals(config.nodes.spec.run_always, undefined);
});

// --- phases validation tests ---

Deno.test("parseConfig — phases referencing valid nodes passes", () => {
  const yaml = `
name: test
version: "1"
phases:
  plan: [a]
  impl: [b]
nodes:
  a:
    type: agent
    label: A
    task_template: "do A"
  b:
    type: agent
    label: B
    task_template: "do B"
    inputs: [a]
`;
  const config = parseConfig(yaml);
  assertEquals(config.phases!.plan, ["a"]);
});

Deno.test("parseConfig — phases referencing unknown node throws", () => {
  const yaml = `
name: test
version: "1"
phases:
  plan: [a, nonexistent]
nodes:
  a:
    type: agent
    label: A
    task_template: "do A"
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "Phase 'plan' references unknown node 'nonexistent'",
  );
});

Deno.test("parseConfig — phases with duplicate node across phases throws", () => {
  const yaml = `
name: test
version: "1"
phases:
  plan: [a]
  impl: [a]
nodes:
  a:
    type: agent
    label: A
    task_template: "do A"
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "Node 'a' appears in multiple phases",
  );
});

// --- validatePromptPaths tests (FR-31) ---

Deno.test("parseConfig — missing prompt file throws with file path", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: nonexistent/SKILL.md
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "nonexistent/SKILL.md",
  );
});

Deno.test("parseConfig — existing prompt file passes without error", () => {
  const config = parseConfig(MINIMAL_AGENT);
  assertEquals(config.nodes.spec.prompt, "agents/pm/SKILL.md");
});

Deno.test("parseConfig — existing prompt file has prompt_content populated", () => {
  const config = parseConfig(MINIMAL_AGENT);
  const content = Deno.readTextFileSync("agents/pm/SKILL.md");
  assertEquals(config.nodes.spec.prompt_content, content);
});

Deno.test("parseConfig — template prompt path has no prompt_content", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: "{{env.AGENTS_DIR}}/SKILL.md"
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.prompt_content, undefined);
});

Deno.test("parseConfig — loop body node prompt_content populated", () => {
  const yaml = `
name: test
version: "1"
nodes:
  impl-loop:
    type: loop
    label: Implementation loop
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    nodes:
      executor:
        type: agent
        label: Executor
        prompt: agents/pm/SKILL.md
      qa:
        type: agent
        label: QA
        task_template: "verify"
        inputs: [executor]
`;
  const config = parseConfig(yaml);
  const content = Deno.readTextFileSync("agents/pm/SKILL.md");
  assertEquals(
    config.nodes["impl-loop"].nodes!.executor.prompt_content,
    content,
  );
  assertEquals(config.nodes["impl-loop"].nodes!.qa.prompt_content, undefined);
});

Deno.test("parseConfig — template prompt path skipped (no filesystem check)", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: "{{env.AGENTS_DIR}}/SKILL.md"
`;
  // Must not throw — template paths are unresolvable at load time, skipped
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.prompt, "{{env.AGENTS_DIR}}/SKILL.md");
});

Deno.test("parseConfig — multiple missing prompt files → single error listing all paths", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: missing/a/SKILL.md
  b:
    type: agent
    label: B
    inputs: [a]
    prompt: missing/b/SKILL.md
`;
  let caught: Error | undefined;
  try {
    parseConfig(yaml);
  } catch (e) {
    caught = e as Error;
  }
  assertEquals(caught !== undefined, true);
  assertEquals(caught!.message.includes("missing/a/SKILL.md"), true);
  assertEquals(caught!.message.includes("missing/b/SKILL.md"), true);
});

Deno.test("parseConfig — loop body node with missing prompt throws", () => {
  const yaml = `
name: test
version: "1"
nodes:
  impl-loop:
    type: loop
    label: Implementation loop
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    nodes:
      executor:
        type: agent
        label: Executor
        prompt: nonexistent/executor/SKILL.md
      qa:
        type: agent
        label: QA
        task_template: "verify"
        inputs: [executor]
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "nonexistent/executor/SKILL.md",
  );
});
