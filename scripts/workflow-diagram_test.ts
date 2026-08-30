import {
  assertEquals,
  assertFalse,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import type { NodeConfig, WorkflowConfig } from "../src/types.ts";
import {
  parseDiagramArgs,
  parseWorkflowForDiagram,
  renderWorkflowHtml,
  renderWorkflowMarkdown,
  resolveWorkflowConfigPath,
} from "./workflow-diagram.ts";

const config: WorkflowConfig = {
  name: "example & flow",
  version: "1",
  phases: {
    collect: ["fetch", "classify"],
  },
  nodes: {
    fetch: {
      type: "command",
      label: "Fetch <items>",
      command: "fetch",
    },
    classify: {
      type: "agent",
      label: "Classify items",
      inputs: ["fetch"],
      prompt: "classify",
      fork: {
        group: "g",
        branches: "items.json",
        max_concurrent: 2,
      },
      when: "test -s items.json",
      isolation: "worktree",
    },
    publish: {
      type: "command",
      label: "Publish",
      inputs: ["classify"],
      command: "publish",
      run_on: "success",
    },
  },
};

Deno.test("FR-E94 workflow diagram renders phases, dependencies, and node traits", () => {
  const markdown = renderWorkflowMarkdown(config, "/project/workflow.yaml");

  assertStringIncludes(markdown, "# Workflow: example & flow");
  assertStringIncludes(markdown, "Source: `/project/workflow.yaml`");
  assertStringIncludes(markdown, "## Overview");
  assertStringIncludes(markdown, 'phase_summary_0["<b>collect</b>');
  assertStringIncludes(markdown, "Fetch &lt;items&gt;");
  assertStringIncludes(markdown, "Classify items");
  assertStringIncludes(markdown, "## Execution map");
  assertStringIncludes(markdown, "flowchart TB");
  assertStringIncludes(markdown, 'subgraph phase_0["collect"]');
  assertStringIncludes(markdown, 'subgraph phase_post["post-workflow"]');
  assertStringIncludes(markdown, "n0 --> n1");
  assertStringIncludes(markdown, "n1 -.-> n2");
  assertStringIncludes(markdown, "fork g ×2");
  assertStringIncludes(markdown, "when");
  assertStringIncludes(markdown, "isolated worktree");
  assertStringIncludes(markdown, "run on success");
  assertStringIncludes(markdown, "class n0 command");
  assertStringIncludes(markdown, "class n1 agent");
  assertStringIncludes(markdown, "## Workflow settings");
  assertStringIncludes(markdown, "## Operational details");
  assertStringIncludes(markdown, "requires: workflow start");
  assertStringIncludes(markdown, "run: fetch");
  assertStringIncludes(markdown, "requires: fetch");
  assertStringIncludes(markdown, "gate: test -s items.json");
  assertStringIncludes(markdown, "branch source: items.json");
  assertStringIncludes(markdown, "branch concurrency: 2; key: index");
  assertStringIncludes(markdown, "isolation: worktree");
  assertStringIncludes(markdown, "after workflow: success");
});

Deno.test("FR-E94 workflow diagram exposes scripts, checks, and effective controls", () => {
  const detailed: WorkflowConfig = {
    name: "complete",
    version: "1",
    defaults: {
      runtime: "codex",
      model: "gpt-5",
      max_parallel: 4,
      timeout_seconds: 900,
      on_failure_script: "scripts/recover.sh",
      prepare_command: "scripts/prepare.sh",
    },
    env: { MODE: "strict" },
    nodes: {
      build: {
        type: "command",
        label: "Build",
        command: "deno task build --output {{node_dir}}",
        before: "scripts/before.sh",
        after: "scripts/after.sh",
        when: "test -f enabled",
        validate: [
          { type: "file_exists", path: "result.json" },
          { type: "custom_script", value: "scripts/check.sh" },
        ],
        settings: { max_retries: 3, on_error: "continue" },
        env: { STEP: "build" },
      },
      approve: {
        type: "human",
        label: "Approve",
        inputs: ["build"],
        question: "Ship it?",
        options: ["yes", "no"],
        abort_on: ["no"],
      },
    },
  };

  const markdown = renderWorkflowMarkdown(detailed, "workflow.yaml");

  assertStringIncludes(markdown, "runtime: codex");
  assertStringIncludes(markdown, "model: gpt-5");
  assertStringIncludes(markdown, "parallel nodes: 4");
  assertStringIncludes(markdown, "node timeout: 900 s");
  assertStringIncludes(markdown, "prepare: scripts/prepare.sh");
  assertStringIncludes(markdown, "on failure: scripts/recover.sh");
  assertStringIncludes(markdown, "environment: MODE=strict");
  assertStringIncludes(markdown, "before: scripts/before.sh");
  assertStringIncludes(markdown, "run: deno task build --output {{node_dir}}");
  assertStringIncludes(markdown, "after success: scripts/after.sh");
  assertStringIncludes(
    markdown,
    "checks: file_exists(result.json); custom_script(scripts/check.sh)",
  );
  assertStringIncludes(markdown, "controls: retries=3; on error=continue");
  assertStringIncludes(markdown, "environment: STEP=build");
  assertStringIncludes(markdown, "question: Ship it?");
  assertStringIncludes(markdown, "options: yes, no; abort on: no");
  assertStringIncludes(markdown, "Configuration coverage: complete");
});

Deno.test("FR-E94 workflow diagram reports fields it cannot represent", () => {
  const futureConfig = structuredClone(config) as WorkflowConfig & {
    future_option: string;
  };
  futureConfig.future_option = "new";
  (futureConfig.nodes.fetch as NodeConfig & { future_node_option: boolean })
    .future_node_option = true;

  const markdown = renderWorkflowMarkdown(futureConfig, "workflow.yaml");

  assertStringIncludes(markdown, "Configuration coverage: incomplete");
  assertStringIncludes(markdown, "Unsupported workflow field `future_option`");
  assertStringIncludes(
    markdown,
    "Unsupported field `nodes.fetch.future_node_option`",
  );
});

Deno.test("FR-E94 HTML canvas renders the whole workflow as one interactive graph", () => {
  const html = renderWorkflowHtml(config, "/project/workflow.yaml");

  assertEquals((html.match(/<svg/g) ?? []).length, 1);
  assertStringIncludes(html, 'id="workflow-canvas"');
  assertStringIncludes(html, 'data-action="fit"');
  assertStringIncludes(html, 'data-action="zoom-in"');
  assertStringIncludes(html, '"id":"fetch"');
  assertStringIncludes(html, '"command":"fetch"');
  assertStringIncludes(html, '"when":"test -s items.json"');
  assertStringIncludes(html, '"run_on":"success"');
  assertStringIncludes(html, '"coverageStatus":"complete"');
  assertFalse(html.includes("<b>"));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assertEquals(scripts.length, 1);
  new Function(scripts[0][1]);
});

Deno.test("FR-E94 workflow diagram removes transitive dependency arrows", () => {
  const graph: WorkflowConfig = {
    name: "transitive",
    version: "1",
    nodes: {
      source: { type: "command", label: "Source", command: "source" },
      middle: {
        type: "command",
        label: "Middle",
        command: "middle",
        inputs: ["source"],
      },
      target: {
        type: "command",
        label: "Target",
        command: "target",
        inputs: ["source", "middle"],
      },
    },
  };

  const markdown = renderWorkflowMarkdown(graph, "workflow.yaml");
  assertStringIncludes(markdown, "n0 --> n1");
  assertStringIncludes(markdown, "n1 --> n2");
  assertFalse(markdown.includes("n0 --> n2"));
});

Deno.test("FR-E94 workflow diagram shows loop body and internal dependencies", () => {
  const loopConfig: WorkflowConfig = {
    name: "loop",
    version: "1",
    nodes: {
      prepare: {
        type: "command",
        label: "Prepare",
        command: "prepare",
      },
      revise: {
        type: "loop",
        label: "Revise",
        inputs: ["prepare"],
        max_iterations: 3,
        until: "test -f done",
        nodes: {
          draft: {
            type: "agent",
            label: "Draft",
            prompt: "draft",
          },
          review: {
            type: "agent",
            label: "Review",
            inputs: ["draft"],
            prompt: "review",
          },
        },
      },
    },
  };

  const markdown = renderWorkflowMarkdown(loopConfig, "workflow.yaml");

  assertStringIncludes(markdown, "loop ×3");
  assertStringIncludes(markdown, "until predicate");
  assertStringIncludes(markdown, "n1 -. contains .-> n1_body_0");
  assertStringIncludes(markdown, "n1_body_0 --> n1_body_1");
  assertStringIncludes(markdown, "class n1_body_0 agent");
});

Deno.test("FR-E94 workflow diagram accepts both fork shapes", () => {
  const parsed = parseWorkflowForDiagram(`
name: forks
version: "1"
nodes:
  static:
    type: agent
    label: Static branch
    fork: g.a
    prompt: work
  dynamic:
    type: agent
    label: Dynamic branches
    fork:
      group: g
      branches: "{{input.prepare}}/items.json"
      key: value.id
    prompt: work
`);

  assertEquals(parsed.nodes.static.fork, "g.a");
  assertEquals(parsed.nodes.dynamic.fork, {
    group: "g",
    branches: "{{input.prepare}}/items.json",
    key: "value.id",
  });
});

Deno.test("FR-E94 workflow diagram CLI parses input and optional output", () => {
  assertEquals(parseDiagramArgs(["--", "flow", "--output", "diagram.md"]), {
    input: "flow",
    output: "diagram.md",
    help: false,
  });
  assertEquals(parseDiagramArgs(["--help"]), {
    input: undefined,
    output: undefined,
    help: true,
  });
});

Deno.test("FR-E94 workflow diagram resolves a workflow directory", async () => {
  const dir = await Deno.makeTempDir({ prefix: "workflow-diagram-" });
  try {
    const configPath = `${dir}/workflow.yaml`;
    await Deno.writeTextFile(configPath, "name: test\n");
    assertEquals(await resolveWorkflowConfigPath(dir), configPath);
    assertEquals(await resolveWorkflowConfigPath(configPath), configPath);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E94 workflow diagram rejects a missing input path", async () => {
  await assertRejects(
    () => resolveWorkflowConfigPath("/definitely/missing/workflow"),
    Error,
    "Workflow path does not exist",
  );
});

Deno.test("FR-E94 HTML canvas draws loop body nodes and their internal edges", () => {
  const loopConfig: WorkflowConfig = {
    name: "loop",
    version: "1",
    nodes: {
      prepare: { type: "command", label: "Prepare", command: "prepare" },
      revise: {
        type: "loop",
        label: "Revise",
        inputs: ["prepare"],
        max_iterations: 3,
        until: "test -f done",
        nodes: {
          draft: { type: "agent", label: "Draft", prompt: "draft" },
          review: {
            type: "agent",
            label: "Review",
            inputs: ["draft", "prepare"],
            prompt: "review",
          },
        },
      },
    },
  };

  const html = renderWorkflowHtml(loopConfig, "workflow.yaml");

  // The body nodes are cards of their own, not a JSON blob buried in the
  // loop's inspector — a reader must see the inner cycle on the canvas.
  assertStringIncludes(html, '"id":"revise/draft"');
  assertStringIncludes(html, '"id":"revise/review"');
  assertStringIncludes(html, '"parent":"revise"');
  // A body node no sibling precedes hangs off its loop; the next one takes the
  // first as its input and keeps the external input the loop forwards to it.
  assertStringIncludes(html, '"inputs":["revise"]');
  assertStringIncludes(html, '"inputs":["revise/draft","prepare"]');
});
