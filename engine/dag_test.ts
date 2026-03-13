import { assertEquals, assertThrows } from "@std/assert";
import { buildLevels, buildLoopBodyOrder } from "./dag.ts";
import type { PipelineConfig } from "./types.ts";
import { parseConfig } from "./config.ts";

function cfg(yaml: string): PipelineConfig {
  return parseConfig(yaml);
}

Deno.test("buildLevels — single node, no deps", () => {
  const config = cfg(`
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    task_template: "do A"
`);
  assertEquals(buildLevels(config), [["a"]]);
});

Deno.test("buildLevels — linear chain", () => {
  const config = cfg(`
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
    inputs: [a]
  c:
    type: agent
    label: C
    task_template: "do C"
    inputs: [b]
`);
  assertEquals(buildLevels(config), [["a"], ["b"], ["c"]]);
});

Deno.test("buildLevels — parallel nodes (fan-out)", () => {
  const config = cfg(`
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
    inputs: [a]
  c:
    type: agent
    label: C
    task_template: "do C"
    inputs: [a]
`);
  const levels = buildLevels(config);
  assertEquals(levels, [["a"], ["b", "c"]]);
});

Deno.test("buildLevels — fan-in (merge)", () => {
  const config = cfg(`
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
    label: Combine
    inputs: [a, b]
`);
  const levels = buildLevels(config);
  assertEquals(levels, [["a", "b"], ["combined"]]);
});

Deno.test("buildLevels — diamond pattern", () => {
  const config = cfg(`
name: test
version: "1"
nodes:
  start:
    type: agent
    label: Start
    task_template: "start"
  left:
    type: agent
    label: Left
    task_template: "left"
    inputs: [start]
  right:
    type: agent
    label: Right
    task_template: "right"
    inputs: [start]
  end:
    type: merge
    label: End
    inputs: [left, right]
`);
  const levels = buildLevels(config);
  assertEquals(levels, [["start"], ["left", "right"], ["end"]]);
});

Deno.test("buildLevels — loop body nodes excluded from main DAG", () => {
  const config = cfg(`
name: test
version: "1"
nodes:
  spec:
    type: agent
    label: Spec
    task_template: "spec"
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
      qa:
        type: agent
        label: QA
        task_template: "verify"
        inputs: [executor]
`);
  const levels = buildLevels(config);
  // executor and qa should NOT appear in main levels
  assertEquals(levels, [["spec"], ["impl-loop"]]);
});

Deno.test("buildLevels — multiple independent roots", () => {
  const config = cfg(`
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
  c:
    type: agent
    label: C
    task_template: "do C"
`);
  const levels = buildLevels(config);
  assertEquals(levels, [["a", "b", "c"]]);
});

Deno.test("buildLevels — cycle detection throws", () => {
  // Can't use parseConfig because it doesn't detect cycles.
  // Build config manually with circular inputs.
  const config: PipelineConfig = {
    name: "test",
    version: "1",
    nodes: {
      a: { type: "agent", label: "A", task_template: "x", inputs: ["b"] },
      b: { type: "agent", label: "B", task_template: "x", inputs: ["a"] },
    },
  };
  assertThrows(
    () => buildLevels(config),
    Error,
    "Cycle detected",
  );
});

Deno.test("buildLevels — 3-node cycle detection", () => {
  const config: PipelineConfig = {
    name: "test",
    version: "1",
    nodes: {
      a: { type: "agent", label: "A", task_template: "x", inputs: ["c"] },
      b: { type: "agent", label: "B", task_template: "x", inputs: ["a"] },
      c: { type: "agent", label: "C", task_template: "x", inputs: ["b"] },
    },
  };
  assertThrows(
    () => buildLevels(config),
    Error,
    "Cycle detected",
  );
});

// --- buildLoopBodyOrder ---

Deno.test("buildLoopBodyOrder — sequential body nodes", () => {
  const config = cfg(`
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
      executor:
        type: agent
        label: Executor
        task_template: "implement"
      qa:
        type: agent
        label: QA
        task_template: "verify"
        inputs: [executor]
`);
  const order = buildLoopBodyOrder(config, "impl-loop");
  assertEquals(order, ["executor", "qa"]);
});

Deno.test("buildLoopBodyOrder — single body node", () => {
  const config = cfg(`
name: test
version: "1"
nodes:
  review-loop:
    type: loop
    label: Review loop
    condition_node: reviewer
    condition_field: status
    exit_value: OK
    nodes:
      reviewer:
        type: agent
        label: Reviewer
        task_template: "review"
`);
  const order = buildLoopBodyOrder(config, "review-loop");
  assertEquals(order, ["reviewer"]);
});

Deno.test("buildLoopBodyOrder — non-loop node throws", () => {
  const config = cfg(`
name: test
version: "1"
nodes:
  a:
    type: agent
    label: A
    task_template: "do A"
`);
  assertThrows(
    () => buildLoopBodyOrder(config, "a"),
    Error,
    "not a loop node",
  );
});
