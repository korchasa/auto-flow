import { assertEquals, assertThrows } from "@std/assert";
import { buildLevels, buildLoopBodyOrder } from "./dag.ts";
import type { WorkflowConfig } from "../types.ts";
import { parseConfig } from "../config/config.ts";

function cfg(yaml: string): WorkflowConfig {
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
    prompt: "do A"
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
    prompt: "do A"
  b:
    type: agent
    label: B
    prompt: "do B"
    inputs: [a]
  c:
    type: agent
    label: C
    prompt: "do C"
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
    prompt: "do A"
  b:
    type: agent
    label: B
    prompt: "do B"
    inputs: [a]
  c:
    type: agent
    label: C
    prompt: "do C"
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
    prompt: "do A"
  b:
    type: agent
    label: B
    prompt: "do B"
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
    prompt: "start"
  left:
    type: agent
    label: Left
    prompt: "left"
    inputs: [start]
  right:
    type: agent
    label: Right
    prompt: "right"
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
    prompt: "spec"
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
      qa:
        type: agent
        label: QA
        prompt: "verify"
        inputs: [developer]
`);
  const levels = buildLevels(config);
  // developer and qa should NOT appear in main levels
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
    prompt: "do A"
  b:
    type: agent
    label: B
    prompt: "do B"
  c:
    type: agent
    label: C
    prompt: "do C"
`);
  const levels = buildLevels(config);
  assertEquals(levels, [["a", "b", "c"]]);
});

Deno.test("buildLevels — cycle detection throws", () => {
  // Can't use parseConfig because it doesn't detect cycles.
  // Build config manually with circular inputs.
  const config: WorkflowConfig = {
    name: "test",
    version: "1",
    nodes: {
      a: { type: "agent", label: "A", prompt: "x", inputs: ["b"] },
      b: { type: "agent", label: "B", prompt: "x", inputs: ["a"] },
    },
  };
  assertThrows(
    () => buildLevels(config),
    Error,
    "Cycle detected",
  );
});

Deno.test("buildLevels — 3-node cycle detection", () => {
  const config: WorkflowConfig = {
    name: "test",
    version: "1",
    nodes: {
      a: { type: "agent", label: "A", prompt: "x", inputs: ["c"] },
      b: { type: "agent", label: "B", prompt: "x", inputs: ["a"] },
      c: { type: "agent", label: "C", prompt: "x", inputs: ["b"] },
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
      developer:
        type: agent
        label: Developer
        prompt: "implement"
      qa:
        type: agent
        label: QA
        prompt: "verify"
        inputs: [developer]
`);
  const order = buildLoopBodyOrder(config, "impl-loop");
  assertEquals(order, ["developer", "qa"]);
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
        prompt: "review"
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
    prompt: "do A"
`);
  assertThrows(
    () => buildLoopBodyOrder(config, "a"),
    Error,
    "not a loop node",
  );
});
