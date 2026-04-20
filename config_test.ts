import { assertEquals, assertThrows } from "@std/assert";
import {
  DEFAULT_SETTINGS,
  extractWorktreeDisabled,
  parseConfig,
} from "./config.ts";
import type { NodeConfig } from "./types.ts";

const MINIMAL_AGENT = `
name: test-workflow
version: "1"
nodes:
  spec:
    type: agent
    label: "Write spec"
    agent: agent-pm
    prompt: "Write a spec for issue #{{args.issue}}"
`;

const MINIMAL_HUMAN = `
name: test-workflow
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
  assertEquals(config.name, "test-workflow");
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

Deno.test("parseConfig — workflow defaults override global defaults", () => {
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
    prompt: "do something"
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.settings!.max_continuations, 5);
  assertEquals(config.defaults!.max_parallel, 3);
});

Deno.test("parseConfig — node settings override workflow defaults", () => {
  const yaml = `
name: test
version: "1"
defaults:
  max_continuations: 5
nodes:
  a:
    type: agent
    label: A
    prompt: "do something"
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
      developer:
        type: agent
        label: Developer
        prompt: "implement"
      qa:
        type: agent
        label: QA
        prompt: "verify"
        inputs: [developer]
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes["impl-loop"].type, "loop");
  assertEquals(config.nodes["impl-loop"].nodes != null, true);
  assertEquals(Object.keys(config.nodes["impl-loop"].nodes!).length, 2);
  assertEquals(config.nodes["impl-loop"].nodes!.developer.type, "agent");
  assertEquals(config.nodes["impl-loop"].nodes!.qa.inputs, ["developer"]);
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
        prompt: "do work"
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
    prompt: "write spec"
  impl-loop:
    type: loop
    label: Impl loop
    inputs: [spec]
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    nodes:
      developer:
        type: agent
        label: Developer
        prompt: "implement"
        inputs: [spec]
      qa:
        type: agent
        label: QA
        prompt: "verify"
        inputs: [developer]
`;
  // Should not throw — body node inputs referencing external top-level nodes are valid
  const config = parseConfig(yaml);
  assertEquals(config.nodes["impl-loop"].nodes!.developer.inputs, ["spec"]);
});

// --- loop input forwarding validation tests (FR-E35) ---

Deno.test(
  "parseConfig — loop forwarding: body node references external input in loop.inputs → passes",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: "write spec"
  my-loop:
    type: loop
    label: Loop
    inputs: [spec]
    condition_node: worker
    condition_field: status
    exit_value: DONE
    nodes:
      worker:
        type: agent
        label: Worker
        prompt: "work"
        inputs: [spec]
`;
    const config = parseConfig(yaml);
    assertEquals(config.nodes["my-loop"].nodes!.worker.inputs, ["spec"]);
  },
);

Deno.test(
  "parseConfig — loop forwarding: body node references external input NOT in loop.inputs → throws",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: "write spec"
  my-loop:
    type: loop
    label: Loop
    condition_node: worker
    condition_field: status
    exit_value: DONE
    nodes:
      worker:
        type: agent
        label: Worker
        prompt: "work"
        inputs: [spec]
`;
    assertThrows(
      () => parseConfig(yaml),
      Error,
      "references external input(s) [spec] not listed in loop inputs",
    );
  },
);

Deno.test(
  "parseConfig — loop forwarding: body node references sibling body node → no error",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  my-loop:
    type: loop
    label: Loop
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    nodes:
      developer:
        type: agent
        label: Developer
        prompt: "implement"
      qa:
        type: agent
        label: QA
        prompt: "verify"
        inputs: [developer]
`;
    const config = parseConfig(yaml);
    assertEquals(config.nodes["my-loop"].nodes!.qa.inputs, ["developer"]);
  },
);

Deno.test(
  "parseConfig — loop forwarding: body node with no inputs → no error",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: "write spec"
  my-loop:
    type: loop
    label: Loop
    inputs: [spec]
    condition_node: worker
    condition_field: status
    exit_value: DONE
    nodes:
      worker:
        type: agent
        label: Worker
        prompt: "work"
`;
    const config = parseConfig(yaml);
    assertEquals(config.nodes["my-loop"].nodes!.worker.inputs, undefined);
  },
);

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
    prompt: "do A"
  b:
    type: agent
    label: B
    prompt: "do B"
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
    prompt: "write spec"
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
    prompt: "use {{env.API_KEY}}"
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
    prompt: "do something"
    before: "git pull"
    after: "deno task check"
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.before, "git pull");
  assertEquals(config.nodes.a.after, "deno task check");
});

// --- pre_run removal tests ---

Deno.test("parseConfig — pre_run field throws migration error", () => {
  const yaml = `
name: test
version: "1"
pre_run: "./scripts/reset.sh"
nodes:
  a:
    type: agent
    label: A
    prompt: "do something"
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "pre_run removed",
  );
});

// --- worktree_disabled tests ---

Deno.test("extractWorktreeDisabled — returns false when absent", () => {
  assertEquals(extractWorktreeDisabled(MINIMAL_AGENT), false);
});

Deno.test("extractWorktreeDisabled — returns true when set", () => {
  const yaml = `
name: test
version: "1"
defaults:
  worktree_disabled: true
nodes:
  a:
    type: agent
    label: A
    prompt: "do something"
`;
  assertEquals(extractWorktreeDisabled(yaml), true);
});

Deno.test("extractWorktreeDisabled — returns false when explicitly false", () => {
  const yaml = `
name: test
version: "1"
defaults:
  worktree_disabled: false
nodes:
  a:
    type: agent
    label: A
    prompt: "do something"
`;
  assertEquals(extractWorktreeDisabled(yaml), false);
});

Deno.test("parseConfig — worktree_disabled is preserved in defaults", () => {
  const yaml = `
name: test
version: "1"
defaults:
  worktree_disabled: true
nodes:
  a:
    type: agent
    label: A
    prompt: "do something"
`;
  const config = parseConfig(yaml);
  assertEquals(config.defaults?.worktree_disabled, true);
});

// --- Error cases ---

Deno.test("parseConfig — missing name throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `version: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    prompt: x`,
      ),
    Error,
    "non-empty 'name'",
  );
});

Deno.test("parseConfig — wrong version throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "2"\nnodes:\n  a:\n    type: agent\n    label: A\n    prompt: x`,
      ),
    Error,
    "Unsupported workflow config version",
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
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    prompt: x`,
      ),
    Error,
    "non-empty 'label'",
  );
});

Deno.test("parseConfig — agent without prompt throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A`,
      ),
    Error,
    "requires a 'prompt' field",
  );
});

Deno.test("parseConfig — input referencing unknown node throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    prompt: x\n    inputs: [nonexistent]`,
      ),
    Error,
    "unknown input node 'nonexistent'",
  );
});

Deno.test("parseConfig — self-referencing input throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    prompt: x\n    inputs: [a]`,
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
      developer:
        type: agent
        label: E
        prompt: x
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
      developer:
        type: agent
        label: E
        prompt: x
      qa:
        type: agent
        label: Q
        prompt: x
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
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    prompt: x\n    validate:\n      - type: invalid\n        path: foo`,
      ),
    Error,
    "invalid type 'invalid'",
  );
});

Deno.test("parseConfig — invalid on_error throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    prompt: x\n    settings:\n      on_error: maybe`,
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
    prompt: "do something"
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
    prompt: "do something"
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
    prompt: "do something"
    run_on: failure
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.run_on, "failure");
});

Deno.test("parseConfig — invalid run_on value throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    prompt: x\n    run_on: sometimes`,
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
    prompt: "do something"
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
    prompt: "do something"
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
    prompt: "do something"
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
    prompt: "do A"
  b:
    type: agent
    label: B
    prompt: "do B"
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
    prompt: "do A"
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
    prompt: "do A"
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "Node 'a' appears in multiple phases",
  );
});

// --- phases mutual-exclusivity validation tests (FR-E33) ---

Deno.test(
  "parseConfig — phases block + per-node phase field coexist → diagnostic error naming node ID",
  () => {
    const yaml = `
name: test
version: "1"
phases:
  plan: [a]
nodes:
  a:
    type: agent
    label: A
    prompt: "do A"
    phase: wrong-phase
`;
    assertThrows(
      () => parseConfig(yaml),
      Error,
      "cannot coexist",
    );
  },
);

Deno.test("parseConfig — phases block only (no per-node phase fields) → accepted", () => {
  const yaml = `
name: test
version: "1"
phases:
  plan: [a]
nodes:
  a:
    type: agent
    label: A
    prompt: "do A"
`;
  const config = parseConfig(yaml);
  assertEquals(config.phases!.plan, ["a"]);
});

Deno.test(
  "parseConfig — per-node phase fields only (no phases block) → accepted",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: "do A"
    phase: plan
`;
    const config = parseConfig(yaml);
    assertEquals(config.nodes.a.phase, "plan");
  },
);

Deno.test("parseConfig — neither phases mechanism → accepted", () => {
  const config = parseConfig(MINIMAL_AGENT);
  assertEquals(config.phases, undefined);
  assertEquals(config.nodes.spec.phase, undefined);
});

// --- validateFileReferences tests (FR-E32) ---

Deno.test("parseConfig — prompt with valid file() reference passes", () => {
  const tmpDir = Deno.makeTempDirSync();
  const filePath = `${tmpDir}/context.md`;
  Deno.writeTextFileSync(filePath, "# Context");
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: '{{file("${filePath}")}}'
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.prompt, `{{file("${filePath}")}}`);
});

Deno.test("parseConfig — prompt with missing file() path throws", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: '{{file("/nonexistent/missing.md")}}'
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "file not found",
  );
});

Deno.test("parseConfig — file() path containing {{ is skipped (no validation error)", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: '{{file("{{input.x}}/context.md")}}'
`;
  const config = parseConfig(yaml);
  assertEquals(
    config.nodes.a.prompt,
    '{{file("{{input.x}}/context.md")}}',
  );
});

Deno.test("parseConfig — loop body node prompt with missing file() throws", () => {
  const yaml = `
name: test
version: "1"
nodes:
  impl-loop:
    type: loop
    label: Impl loop
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    nodes:
      developer:
        type: agent
        label: Developer
        prompt: '{{file("/nonexistent/prompt.md")}}'
      qa:
        type: agent
        label: QA
        prompt: verify
        inputs: [developer]
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "file not found",
  );
});

Deno.test("parseConfig — system_prompt with missing file() path throws", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: "do work"
    system_prompt: '{{file("/nonexistent/rules.md")}}'
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "file not found",
  );
});

Deno.test("parseConfig — system_prompt with valid file() reference passes", () => {
  const tmpDir = Deno.makeTempDirSync();
  const filePath = `${tmpDir}/rules.md`;
  Deno.writeTextFileSync(filePath, "# Rules");
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: "do work"
    system_prompt: '{{file("${filePath}")}}'
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.system_prompt, `{{file("${filePath}")}}`);
});

// --- artifact validation rule schema tests ---

Deno.test("parseConfig — artifact rule without sections or fields throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    prompt: x\n    validate:\n      - type: artifact\n        path: foo`,
      ),
    Error,
    "requires at least one of 'sections' or 'fields'",
  );
});

Deno.test("parseConfig — artifact rule with empty sections array and no fields throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    prompt: x\n    validate:\n      - type: artifact\n        path: foo\n        sections: []`,
      ),
    Error,
    "requires at least one of 'sections' or 'fields'",
  );
});

Deno.test("parseConfig — artifact rule with non-string sections throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    prompt: x\n    validate:\n      - type: artifact\n        path: foo\n        sections: [123, 456]`,
      ),
    Error,
    "array of strings",
  );
});

Deno.test("parseConfig — valid artifact rule passes", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: x
    validate:
      - type: artifact
        path: "{{node_dir}}/output.md"
        sections: [Summary, Details]
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.validate![0].type, "artifact");
  assertEquals(config.nodes.a.validate![0].sections, ["Summary", "Details"]);
});

Deno.test("parseConfig — artifact rule with non-string field entry throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    prompt: x\n    validate:\n      - type: artifact\n        path: foo\n        fields: [123]`,
      ),
    Error,
    "non-empty strings",
  );
});

Deno.test("parseConfig — artifact rule with empty-string field entry throws", () => {
  assertThrows(
    () =>
      parseConfig(
        `name: test\nversion: "1"\nnodes:\n  a:\n    type: agent\n    label: A\n    prompt: x\n    validate:\n      - type: artifact\n        path: foo\n        fields: [""]`,
      ),
    Error,
    "non-empty strings",
  );
});

Deno.test("parseConfig — artifact rule with fields-only (no sections) accepted", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: x
    validate:
      - type: artifact
        path: "{{node_dir}}/output.md"
        fields: [variant, scope]
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.validate![0].type, "artifact");
  assertEquals(config.nodes.a.validate![0].fields, ["variant", "scope"]);
});

// --- FR-E36: Parse-time condition_field vs frontmatter_field cross-check ---

Deno.test(
  "parseConfig — loop condition_field missing from condition node validate block → throws",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  my-loop:
    type: loop
    label: Loop
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    nodes:
      developer:
        type: agent
        label: Developer
        prompt: implement
      qa:
        type: agent
        label: QA
        prompt: verify
        inputs: [developer]
        validate:
          - type: frontmatter_field
            path: "{{node_dir}}/report.md"
            field: status
`;
    assertThrows(
      () => parseConfig(yaml),
      Error,
      "condition_field 'verdict' is not declared as a frontmatter_field in condition node 'qa' validate block",
    );
  },
);

Deno.test(
  "parseConfig — loop condition_field present in condition node validate block → passes",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  my-loop:
    type: loop
    label: Loop
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    nodes:
      developer:
        type: agent
        label: Developer
        prompt: implement
      qa:
        type: agent
        label: QA
        prompt: verify
        inputs: [developer]
        validate:
          - type: frontmatter_field
            path: "{{node_dir}}/report.md"
            field: verdict
`;
    const config = parseConfig(yaml);
    assertEquals(config.nodes["my-loop"].condition_field, "verdict");
  },
);

// --- FR-E7: Hook template variable validation ---

Deno.test("parseConfig — before hook with valid template vars passes", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: "do something"
    before: "echo {{node_dir}} {{run_id}}"
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.before, "echo {{node_dir}} {{run_id}}");
});

Deno.test("parseConfig — after hook with valid template vars passes", () => {
  const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: "do something"
    after: "deno task check {{env.SOME_VAR}}"
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.a.after, "deno task check {{env.SOME_VAR}}");
});

Deno.test(
  "parseConfig — before hook with unknown prefix throws with node ID",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  my-node:
    type: agent
    label: A
    prompt: "do something"
    before: "echo {{bad.var}}"
`;
    assertThrows(
      () => parseConfig(yaml),
      Error,
      "my-node",
    );
  },
);

Deno.test(
  "parseConfig — after hook with unknown prefix throws mentioning 'after hook'",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  my-node:
    type: agent
    label: A
    prompt: "do something"
    after: "echo {{bad.var}}"
`;
    assertThrows(
      () => parseConfig(yaml),
      Error,
      "after hook",
    );
  },
);

Deno.test(
  "parseConfig — before hook with unknown direct key throws mentioning 'before hook'",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  my-node:
    type: agent
    label: A
    prompt: "do something"
    before: "echo {{unknown_key}}"
`;
    assertThrows(
      () => parseConfig(yaml),
      Error,
      "before hook",
    );
  },
);

Deno.test(
  "parseConfig — hook with valid input.<node-id> from same workflow passes",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: "do A"
  b:
    type: agent
    label: B
    prompt: "do B"
    inputs: [a]
    after: "cat {{input.a}}/output.md"
`;
    const config = parseConfig(yaml);
    assertEquals(config.nodes.b.after, "cat {{input.a}}/output.md");
  },
);

Deno.test(
  "parseConfig — hook with input.<unknown-node> throws",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    prompt: "do A"
    after: "cat {{input.nonexistent}}/output.md"
`;
    assertThrows(
      () => parseConfig(yaml),
      Error,
      "after hook",
    );
  },
);

Deno.test(
  "parseConfig — loop body node hook uses combined IDs (body node ref valid)",
  () => {
    const yaml = `
name: test
version: "1"
nodes:
  my-loop:
    type: loop
    label: Loop
    condition_node: qa
    condition_field: verdict
    exit_value: PASS
    nodes:
      developer:
        type: agent
        label: Developer
        prompt: implement
      qa:
        type: agent
        label: QA
        prompt: verify
        inputs: [developer]
        after: "echo {{input.developer}}"
`;
    const config = parseConfig(yaml);
    assertEquals(
      config.nodes["my-loop"].nodes!.qa.after,
      "echo {{input.developer}}",
    );
  },
);

// --- permission_mode validation tests ---

Deno.test("parseConfig — valid permission_mode in defaults", () => {
  const yaml = `
name: test
version: "1"
defaults:
  permission_mode: bypassPermissions
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
`;
  const config = parseConfig(yaml);
  assertEquals(config.defaults?.permission_mode, "bypassPermissions");
});

Deno.test("parseConfig — valid permission_mode per node", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
    permission_mode: plan
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.spec.permission_mode, "plan");
});

Deno.test("parseConfig — invalid permission_mode in defaults throws", () => {
  const yaml = `
name: test
version: "1"
defaults:
  permission_mode: invalidMode
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "defaults.permission_mode has invalid value 'invalidMode'",
  );
});

Deno.test("parseConfig — invalid permission_mode per node throws", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
    permission_mode: wrongValue
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "invalid permission_mode 'wrongValue'",
  );
});

// --- FR-E47: Budget validation + cascade ---

Deno.test("parseConfig — node budget with valid max_usd accepted", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
    budget:
      max_usd: 0.5
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.spec.budget?.max_usd, 0.5);
});

Deno.test("parseConfig — node budget with valid max_turns accepted", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
    budget:
      max_turns: 10
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.spec.budget?.max_turns, 10);
});

Deno.test("parseConfig — defaults.budget accepted", () => {
  const yaml = `
name: test
version: "1"
defaults:
  budget:
    max_usd: 2.5
    max_turns: 50
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
`;
  const config = parseConfig(yaml);
  assertEquals(config.defaults?.budget?.max_usd, 2.5);
  assertEquals(config.defaults?.budget?.max_turns, 50);
});

Deno.test("parseConfig — budget.max_usd zero rejects", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
    budget:
      max_usd: 0
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "budget.max_usd must be a positive number",
  );
});

Deno.test("parseConfig — budget.max_usd negative rejects", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
    budget:
      max_usd: -1
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "budget.max_usd must be a positive number",
  );
});

Deno.test("parseConfig — budget.max_turns non-integer rejects", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
    budget:
      max_turns: 2.5
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "budget.max_turns must be a positive integer",
  );
});

Deno.test("parseConfig — budget.max_turns zero rejects", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
    budget:
      max_turns: 0
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "budget.max_turns must be a positive integer",
  );
});

Deno.test("parseConfig — unknown budget key rejects", () => {
  const yaml = `
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
    budget:
      max_typos: 1
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "budget has unknown key 'max_typos'",
  );
});

Deno.test("parseConfig — defaults.budget invalid rejects with 'defaults' context", () => {
  const yaml = `
name: test
version: "1"
defaults:
  budget:
    max_usd: -5
nodes:
  spec:
    type: agent
    label: Spec
    prompt: do it
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "defaults.budget.max_usd must be a positive number",
  );
});

Deno.test("resolveBudget — node wins over loop parent and defaults", async () => {
  const { resolveBudget } = await import("./config.ts");
  const node = {
    type: "agent",
    label: "n",
    prompt: "p",
    budget: { max_usd: 1 },
  } as const;
  const loopParent = {
    type: "loop",
    label: "l",
    budget: { max_usd: 2 },
  } as const;
  const defaults = { budget: { max_usd: 3 } };
  const resolved = resolveBudget(node, defaults, loopParent);
  assertEquals(resolved?.max_usd, 1);
});

Deno.test("resolveBudget — loop parent wins over defaults when node has none", async () => {
  const { resolveBudget } = await import("./config.ts");
  const node = { type: "agent", label: "n", prompt: "p" } as const;
  const loopParent = {
    type: "loop",
    label: "l",
    budget: { max_usd: 2 },
  } as const;
  const defaults = { budget: { max_usd: 3 } };
  const resolved = resolveBudget(node, defaults, loopParent);
  assertEquals(resolved?.max_usd, 2);
});

Deno.test("resolveBudget — defaults used when neither node nor loop has budget", async () => {
  const { resolveBudget } = await import("./config.ts");
  const node = { type: "agent", label: "n", prompt: "p" } as const;
  const defaults = { budget: { max_usd: 3, max_turns: 25 } };
  const resolved = resolveBudget(node, defaults);
  assertEquals(resolved?.max_usd, 3);
  assertEquals(resolved?.max_turns, 25);
});

Deno.test("resolveBudget — undefined when no budget at any level", async () => {
  const { resolveBudget } = await import("./config.ts");
  const node = { type: "agent", label: "n", prompt: "p" } as const;
  const resolved = resolveBudget(node, undefined);
  assertEquals(resolved, undefined);
});

// --- FR-E48: Tool filter validation ---

Deno.test("parseConfig — allowed_tools accepted at defaults level", () => {
  const yaml = `
name: w
version: "1"
defaults:
  allowed_tools: ["Read", "Grep"]
nodes:
  n:
    type: agent
    label: n
    prompt: p
`;
  const config = parseConfig(yaml);
  assertEquals(config.defaults?.allowed_tools, ["Read", "Grep"]);
});

Deno.test("parseConfig — disallowed_tools accepted per node", () => {
  const yaml = `
name: w
version: "1"
nodes:
  n:
    type: agent
    label: n
    prompt: p
    disallowed_tools: ["Write", "Edit"]
`;
  const config = parseConfig(yaml);
  assertEquals(config.nodes.n.disallowed_tools, ["Write", "Edit"]);
});

Deno.test("parseConfig — both allowed_tools and disallowed_tools at same level throws", () => {
  const yaml = `
name: w
version: "1"
defaults:
  allowed_tools: ["Read"]
  disallowed_tools: ["Write"]
nodes:
  n:
    type: agent
    label: n
    prompt: p
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "mutually exclusive",
  );
});

Deno.test("parseConfig — allowed_tools not-array throws", () => {
  const yaml = `
name: w
version: "1"
nodes:
  n:
    type: agent
    label: n
    prompt: p
    allowed_tools: "Read"
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "must be an array",
  );
});

Deno.test("parseConfig — allowed_tools with empty string throws", () => {
  const yaml = `
name: w
version: "1"
nodes:
  n:
    type: agent
    label: n
    prompt: p
    allowed_tools: ["Read", ""]
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "non-empty strings",
  );
});

Deno.test("parseConfig — runtime_args with --allowedTools + typed allowed_tools throws", () => {
  const yaml = `
name: w
version: "1"
nodes:
  n:
    type: agent
    label: n
    prompt: p
    allowed_tools: ["Read"]
    runtime_args:
      "--allowedTools": "Bash"
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "conflicts with typed",
  );
});

Deno.test("parseConfig — runtime_args with --disallowedTools + typed disallowed_tools throws", () => {
  const yaml = `
name: w
version: "1"
nodes:
  n:
    type: agent
    label: n
    prompt: p
    disallowed_tools: ["Write"]
    runtime_args:
      "--disallowedTools": "Edit"
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "conflicts with typed",
  );
});

Deno.test("parseConfig — runtime_args with --tools + typed allowed_tools throws", () => {
  const yaml = `
name: w
version: "1"
nodes:
  n:
    type: agent
    label: n
    prompt: p
    allowed_tools: ["Read"]
    runtime_args:
      "--tools": "Bash"
`;
  assertThrows(
    () => parseConfig(yaml),
    Error,
    "conflicts with typed",
  );
});

Deno.test("parseConfig — back-compat: runtime_args with --allowedTools alone is valid", () => {
  const yaml = `
name: w
version: "1"
defaults:
  runtime_args:
    "--allowedTools": "Read,Grep"
nodes:
  n:
    type: agent
    label: n
    prompt: p
`;
  const config = parseConfig(yaml);
  assertEquals(
    (config.defaults?.runtime_args as Record<string, unknown>)[
      "--allowedTools"
    ],
    "Read,Grep",
  );
});

Deno.test("parseConfig — cross-level mode switch: defaults.allowed + node.disallowed is valid", () => {
  const yaml = `
name: w
version: "1"
defaults:
  allowed_tools: ["Read"]
nodes:
  n:
    type: agent
    label: n
    prompt: p
    disallowed_tools: ["Write"]
`;
  const config = parseConfig(yaml);
  assertEquals(config.defaults?.allowed_tools, ["Read"]);
  assertEquals(config.nodes.n.disallowed_tools, ["Write"]);
});

Deno.test("resolveToolFilter — node wins over loop parent and defaults", async () => {
  const { resolveToolFilter } = await import("./config.ts");
  const node: NodeConfig = {
    type: "agent",
    label: "n",
    prompt: "p",
    allowed_tools: ["Read"],
  };
  const loopParent: NodeConfig = {
    type: "loop",
    label: "l",
    disallowed_tools: ["Edit"],
  };
  const defaults = { allowed_tools: ["Grep"] };
  const r = resolveToolFilter(node, defaults, loopParent);
  assertEquals(r.allowedTools, ["Read"]);
  assertEquals(r.disallowedTools, undefined);
});

Deno.test("resolveToolFilter — loop parent wins over defaults when node has none", async () => {
  const { resolveToolFilter } = await import("./config.ts");
  const node: NodeConfig = { type: "agent", label: "n", prompt: "p" };
  const loopParent: NodeConfig = {
    type: "loop",
    label: "l",
    disallowed_tools: ["Edit"],
  };
  const defaults = { allowed_tools: ["Grep"] };
  const r = resolveToolFilter(node, defaults, loopParent);
  assertEquals(r.disallowedTools, ["Edit"]);
  assertEquals(r.allowedTools, undefined);
});

Deno.test("resolveToolFilter — defaults used when neither node nor loop has fields", async () => {
  const { resolveToolFilter } = await import("./config.ts");
  const node: NodeConfig = { type: "agent", label: "n", prompt: "p" };
  const defaults = { allowed_tools: ["Grep"] };
  const r = resolveToolFilter(node, defaults);
  assertEquals(r.allowedTools, ["Grep"]);
});

Deno.test("resolveToolFilter — empty result when no level declares fields", async () => {
  const { resolveToolFilter } = await import("./config.ts");
  const node = { type: "agent", label: "n", prompt: "p" } as const;
  const r = resolveToolFilter(node, undefined);
  assertEquals(r, {});
});

Deno.test("resolveToolFilter — cross-level mode switch: node.disallowed replaces defaults.allowed", async () => {
  const { resolveToolFilter } = await import("./config.ts");
  const node: NodeConfig = {
    type: "agent",
    label: "n",
    prompt: "p",
    disallowed_tools: ["Write"],
  };
  const defaults = { allowed_tools: ["Read"] };
  const r = resolveToolFilter(node, defaults);
  assertEquals(r.disallowedTools, ["Write"]);
  assertEquals(r.allowedTools, undefined);
});
