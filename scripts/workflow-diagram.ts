/**
 * @module
 * Static workflow diagram generator. Reads a workflow.yaml and emits Markdown
 * with a Mermaid flowchart grouped by phase.
 *
 * CLI: deno task workflow-diagram -- <workflow-dir-or-yaml> [--output <file>]
 */
import { join, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import type { NodeConfig, WorkflowConfig } from "../src/types.ts";
import { collectPostWorkflowNodes } from "../src/engine/post-workflow.ts";

export interface DiagramArgs {
  input?: string;
  output?: string;
  help: boolean;
}

const NODE_CLASSES = [
  "classDef agent fill:#e8f0ff,stroke:#3b68b8,color:#15233d",
  "classDef command fill:#e8f7ee,stroke:#39865a,color:#183524",
  "classDef merge fill:#fff3d9,stroke:#b57a12,color:#422d08",
  "classDef loop fill:#f2eaff,stroke:#7650a8,color:#2f1e47",
  "classDef human fill:#ffe8e8,stroke:#b84c4c,color:#461b1b",
  "classDef hitl fill:#ffe8e8,stroke:#b84c4c,color:#461b1b",
].join("\n    ");

const NODE_TYPES = new Set([
  "agent",
  "command",
  "merge",
  "loop",
  "human",
  "hitl",
]);

const WORKFLOW_FIELDS = new Set([
  "name",
  "version",
  "defaults",
  "env",
  "nodes",
  "phases",
]);
const DEFAULT_FIELDS = new Set([
  "max_continuations",
  "timeout_seconds",
  "on_error",
  "max_retries",
  "retry_delay_seconds",
  "max_retry_wall_clock_seconds",
  "worktree_disabled",
  "max_parallel",
  "runtime",
  "runtime_args",
  "permission_mode",
  "model",
  "effort",
  "hitl",
  "on_failure_script",
  "prepare_command",
  "budget",
  "allowed_tools",
  "disallowed_tools",
  "memory_paths",
]);
const NODE_FIELDS = new Set([
  "type",
  "label",
  "inputs",
  "agent",
  "prompt",
  "system_prompt",
  "model",
  "effort",
  "runtime",
  "runtime_args",
  "permission_mode",
  "command",
  "settings",
  "validate",
  "before",
  "after",
  "nodes",
  "condition_node",
  "condition_field",
  "exit_value",
  "until",
  "max_iterations",
  "merge_strategy",
  "question",
  "options",
  "abort_on",
  "phase",
  "fork",
  "join",
  "failure_mode",
  "when",
  "run_on",
  "run_always",
  "env",
  "allowed_paths",
  "isolation",
  "budget",
  "allowed_tools",
  "disallowed_tools",
  "memory_commit_deferred",
]);
const SETTINGS_FIELDS = new Set([
  "max_continuations",
  "timeout_seconds",
  "on_error",
  "max_retries",
  "retry_delay_seconds",
  "max_retry_wall_clock_seconds",
]);
const FORK_FIELDS = new Set([
  "group",
  "branches",
  "key",
  "max_concurrent",
]);
const VALIDATION_FIELDS = new Set([
  "type",
  "path",
  "value",
  "field",
  "allowed",
  "sections",
  "fields",
]);

/**
 * Parse only the structural fields needed by the diagram. Both `fork` shapes
 * are accepted as written — the `"<group>.<branch>"` string that opens one
 * static branch, and the object that expands into a branch per list item.
 */
export function parseWorkflowForDiagram(yaml: string): WorkflowConfig {
  const raw = parseYaml(yaml);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Workflow config must be a YAML object");
  }
  const config = raw as Record<string, unknown>;
  if (typeof config.name !== "string" || config.name.length === 0) {
    throw new Error("Workflow config requires a non-empty 'name' field");
  }
  if (config.version !== "1") {
    throw new Error(`Unsupported workflow config version: ${config.version}`);
  }
  if (
    !config.nodes || typeof config.nodes !== "object" ||
    Array.isArray(config.nodes)
  ) {
    throw new Error("Workflow config requires a 'nodes' object");
  }

  const normalizeNodes = (nodes: Record<string, unknown>): void => {
    for (const [id, value] of Object.entries(nodes)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Node '${id}' must be an object`);
      }
      const node = value as Record<string, unknown>;
      if (!NODE_TYPES.has(String(node.type))) {
        throw new Error(`Node '${id}' has unsupported type '${node.type}'`);
      }
      if (typeof node.label !== "string" || node.label.length === 0) {
        throw new Error(`Node '${id}' requires a non-empty 'label' field`);
      }
      if (node.nodes !== undefined) {
        if (
          typeof node.nodes !== "object" || node.nodes === null ||
          Array.isArray(node.nodes)
        ) {
          throw new Error(`Node '${id}' 'nodes' must be an object`);
        }
        normalizeNodes(node.nodes as Record<string, unknown>);
      }
    }
  };
  normalizeNodes(config.nodes as Record<string, unknown>);
  return config as unknown as WorkflowConfig;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, " ");
}

function nodeTraits(node: NodeConfig): string[] {
  const traits: string[] = [];
  if (typeof node.fork === "string") traits.push(`branch ${node.fork}`);
  else if (node.fork) {
    traits.push(`fork ${node.fork.group} ×${node.fork.max_concurrent}`);
  }
  if (node.join) traits.push(`join ${node.join}`);
  if (node.when) traits.push("when");
  if (node.isolation === "worktree") traits.push("isolated worktree");
  if (node.run_on) traits.push(`run on ${node.run_on}`);
  if (node.type === "loop") {
    traits.push(`loop ×${node.max_iterations ?? "?"}`);
    traits.push(node.until ? "until predicate" : "artifact condition");
  }
  return traits;
}

function splitLabel(label: string): { title: string; detail?: string } {
  const parts = label.split(/\s+—\s+/, 2);
  return parts.length === 2
    ? { title: parts[0], detail: parts[1] }
    : { title: label };
}

function summaryLabel(label: string): string {
  const { title } = splitLabel(label);
  return title.replace(/^\d+(?:-\d+)?[a-z]?\s+/i, "");
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}=${formatValue(item)}`)
      .join(", ");
  }
  return String(value);
}

function promptDescription(prompt: string): string {
  const lines = prompt.split(/\r?\n/).map((line) => line.trim()).filter(
    Boolean,
  );
  if (lines.length <= 1) return compact(prompt);
  return `inline instructions (${lines.length} lines): ${lines[0]}`;
}

function validationDescription(rule: Record<string, unknown>): string {
  const args = Object.entries(rule)
    .filter(([key]) => key !== "type")
    .map(([, value]) => formatValue(value));
  return `${rule.type}${args.length > 0 ? `(${args.join(", ")})` : ""}`;
}

function controlsDescription(settings: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    max_continuations: "continuations",
    timeout_seconds: "timeout",
    on_error: "on error",
    max_retries: "retries",
    retry_delay_seconds: "retry delay",
    max_retry_wall_clock_seconds: "retry wall clock",
  };
  return Object.entries(settings).map(([key, value]) => {
    const seconds = key.includes("seconds") ? " s" : "";
    return `${labels[key] ?? key}=${formatValue(value)}${seconds}`;
  }).join("; ");
}

function operationalLines(nodeId: string, node: NodeConfig): string[] {
  const details = [
    `<b>${escapeHtml(nodeId)}</b> · ${escapeHtml(node.type)}`,
    `requires: ${
      escapeHtml((node.inputs ?? []).join(", ") || "workflow start")
    }`,
  ];
  if (node.when) details.push(`gate: ${escapeHtml(compact(node.when))}`);
  if (node.before) details.push(`before: ${escapeHtml(compact(node.before))}`);
  if (node.command) details.push(`run: ${escapeHtml(compact(node.command))}`);
  if (node.agent) details.push(`agent: ${escapeHtml(node.agent)}`);
  if (node.prompt) {
    details.push(`prompt: ${escapeHtml(promptDescription(node.prompt))}`);
  }
  if (node.system_prompt) {
    details.push(
      `system prompt: ${escapeHtml(promptDescription(node.system_prompt))}`,
    );
  }
  if (node.question) {
    details.push(`question: ${escapeHtml(compact(node.question))}`);
  }
  if (node.options || node.abort_on) {
    const parts = [];
    if (node.options) parts.push(`options: ${node.options.join(", ")}`);
    if (node.abort_on) parts.push(`abort on: ${node.abort_on.join(", ")}`);
    details.push(escapeHtml(parts.join("; ")));
  }
  if (node.after) {
    details.push(`after success: ${escapeHtml(compact(node.after))}`);
  }
  if (node.validate?.length) {
    details.push(
      `checks: ${
        escapeHtml(
          node.validate.map((rule) =>
            validationDescription(rule as unknown as Record<string, unknown>)
          ).join("; "),
        )
      }`,
    );
  }
  if (typeof node.fork === "object") {
    details.push(`branch source: ${escapeHtml(node.fork.branches)}`);
    details.push(
      `branch concurrency: ${node.fork.max_concurrent ?? 1}; key: ${
        node.fork.key ?? "index"
      }`,
    );
  }
  if (node.join) {
    details.push(
      `joins group ${escapeHtml(node.join)}; failure: ${
        node.failure_mode ?? "fail_fast"
      }`,
    );
  }
  if (node.until) {
    details.push(`loop until: ${escapeHtml(compact(node.until))}`);
  }
  if (node.condition_node || node.condition_field || node.exit_value) {
    details.push(
      `loop exit: ${
        escapeHtml(
          `${node.condition_node ?? "?"}.${node.condition_field ?? "?"} = ${
            node.exit_value ?? "?"
          }`,
        )
      }`,
    );
  }
  if (node.max_iterations !== undefined) {
    details.push(`max iterations: ${node.max_iterations}`);
  }
  if (node.merge_strategy) details.push(`merge: ${node.merge_strategy}`);
  if (node.run_on) details.push(`after workflow: ${node.run_on}`);
  if (node.run_always !== undefined) {
    details.push(`legacy run always: ${node.run_always}`);
  }
  if (node.settings) {
    details.push(
      `controls: ${
        escapeHtml(
          controlsDescription(node.settings as Record<string, unknown>),
        )
      }`,
    );
  }
  for (
    const key of [
      "runtime",
      "model",
      "effort",
      "permission_mode",
      "isolation",
    ] as const
  ) {
    if (node[key] !== undefined) {
      details.push(
        `${key.replace("_", " ")}: ${escapeHtml(String(node[key]))}`,
      );
    }
  }
  if (node.runtime_args) {
    details.push(
      `runtime arguments: ${escapeHtml(formatValue(node.runtime_args))}`,
    );
  }
  if (node.env) {
    details.push(`environment: ${escapeHtml(formatValue(node.env))}`);
  }
  if (node.allowed_paths) {
    details.push(
      `allowed paths: ${escapeHtml(formatValue(node.allowed_paths))}`,
    );
  }
  if (node.budget) {
    details.push(`budget: ${escapeHtml(formatValue(node.budget))}`);
  }
  if (node.allowed_tools) {
    details.push(
      `allowed tools: ${escapeHtml(formatValue(node.allowed_tools))}`,
    );
  }
  if (node.disallowed_tools) {
    details.push(
      `disallowed tools: ${escapeHtml(formatValue(node.disallowed_tools))}`,
    );
  }
  if (node.memory_commit_deferred !== undefined) {
    details.push(`defer memory commit: ${node.memory_commit_deferred}`);
  }
  return details;
}

function auditUnknownFields(config: WorkflowConfig): string[] {
  const warnings: string[] = [];
  const check = (
    value: Record<string, unknown>,
    allowed: Set<string>,
    path: string,
  ) => {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) warnings.push(`${path}${key}`);
    }
  };
  check(config as unknown as Record<string, unknown>, WORKFLOW_FIELDS, "");
  if (config.defaults) {
    check(
      config.defaults as Record<string, unknown>,
      DEFAULT_FIELDS,
      "defaults.",
    );
  }
  const visitNodes = (nodes: Record<string, NodeConfig>, prefix: string) => {
    for (const [nodeId, node] of Object.entries(nodes)) {
      const path = `${prefix}${nodeId}.`;
      check(node as unknown as Record<string, unknown>, NODE_FIELDS, path);
      if (node.settings) {
        check(
          node.settings as Record<string, unknown>,
          SETTINGS_FIELDS,
          `${path}settings.`,
        );
      }
      if (typeof node.fork === "object") {
        check(
          node.fork as unknown as Record<string, unknown>,
          FORK_FIELDS,
          `${path}fork.`,
        );
      }
      for (const [index, rule] of (node.validate ?? []).entries()) {
        check(
          rule as unknown as Record<string, unknown>,
          VALIDATION_FIELDS,
          `${path}validate.${index}.`,
        );
      }
      if (node.nodes) visitNodes(node.nodes, `${path}nodes.`);
    }
  };
  visitNodes(config.nodes, "nodes.");
  return warnings.map((path) =>
    path.includes(".")
      ? `Unsupported field \`${path}\``
      : `Unsupported workflow field \`${path}\``
  );
}

function workflowSettingLines(config: WorkflowConfig): string[] {
  const defaults = config.defaults;
  const lines: string[] = [`- schema version: ${config.version}`];
  if (defaults?.runtime) lines.push(`- runtime: ${defaults.runtime}`);
  if (defaults?.model) lines.push(`- model: ${defaults.model}`);
  if (defaults?.effort) lines.push(`- effort: ${defaults.effort}`);
  if (defaults?.permission_mode) {
    lines.push(`- permission mode: ${defaults.permission_mode}`);
  }
  if (defaults?.max_parallel !== undefined) {
    lines.push(`- parallel nodes: ${defaults.max_parallel}`);
  }
  if (defaults?.timeout_seconds !== undefined) {
    lines.push(`- node timeout: ${defaults.timeout_seconds} s`);
  }
  if (defaults?.max_continuations !== undefined) {
    lines.push(`- continuations: ${defaults.max_continuations}`);
  }
  if (defaults?.max_retries !== undefined) {
    lines.push(`- retries: ${defaults.max_retries}`);
  }
  if (defaults?.retry_delay_seconds !== undefined) {
    lines.push(`- retry delay: ${defaults.retry_delay_seconds} s`);
  }
  if (defaults?.max_retry_wall_clock_seconds !== undefined) {
    lines.push(
      `- retry wall clock: ${defaults.max_retry_wall_clock_seconds} s`,
    );
  }
  if (defaults?.on_error) lines.push(`- on error: ${defaults.on_error}`);
  if (defaults?.worktree_disabled !== undefined) {
    lines.push(`- shared worktree disabled: ${defaults.worktree_disabled}`);
  }
  if (defaults?.prepare_command) {
    lines.push(`- prepare: ${compact(defaults.prepare_command)}`);
  }
  if (defaults?.on_failure_script) {
    lines.push(`- on failure: ${compact(defaults.on_failure_script)}`);
  }
  for (const [key, value] of Object.entries(defaults ?? {})) {
    if (
      [
        "runtime",
        "model",
        "effort",
        "permission_mode",
        "max_parallel",
        "timeout_seconds",
        "max_continuations",
        "max_retries",
        "retry_delay_seconds",
        "max_retry_wall_clock_seconds",
        "on_error",
        "worktree_disabled",
        "prepare_command",
        "on_failure_script",
      ].includes(key)
    ) continue;
    lines.push(`- ${key.replaceAll("_", " ")}: ${formatValue(value)}`);
  }
  if (config.env) lines.push(`- environment: ${formatValue(config.env)}`);
  return lines;
}

interface CanvasNode {
  id: string;
  label: string;
  type: NodeConfig["type"];
  phase: string;
  inputs: string[];
  x: number;
  y: number;
  summary: string;
  /** Loop this node is a body node of; absent for a top-level node. */
  parent?: string;
  config: NodeConfig;
}

/** One node of the flattened graph the canvas draws. */
interface FlatNode {
  id: string;
  node: NodeConfig;
  inputs: string[];
  parent?: string;
}

/**
 * Flatten the config into every node the canvas must draw.
 *
 * Loop body nodes are declared inside their loop (FR-E10) and never appear in
 * `config.nodes`, so a canvas built from that map alone hides a workflow's
 * whole inner cycle behind one opaque card. They are emitted here under
 * `"<loop>/<body>"` ids with their internal edges preserved; a body node that
 * no sibling precedes hangs off its loop node, which draws the containment
 * edge the Mermaid view spells out as `-. contains .->`.
 */
function flattenNodes(config: WorkflowConfig): FlatNode[] {
  const flat: FlatNode[] = [];
  for (const [id, node] of Object.entries(config.nodes)) {
    flat.push({ id, node, inputs: node.inputs ?? [] });
    if (node.type !== "loop" || !node.nodes) continue;
    const body = node.nodes;
    for (const [bodyId, bodyNode] of Object.entries(body)) {
      const declared = bodyNode.inputs ?? [];
      const internal = declared.filter((input) => body[input])
        .map((input) => `${id}/${input}`);
      const external = declared.filter((input) =>
        !body[input] && config.nodes[input]
      );
      flat.push({
        id: `${id}/${bodyId}`,
        node: bodyNode,
        inputs: internal.length > 0
          ? [...internal, ...external]
          : [id, ...external],
        parent: id,
      });
    }
  }
  return flat;
}

function canvasNodes(
  config: WorkflowConfig,
  layout: PhaseLayout,
): CanvasNode[] {
  const flat = flattenNodes(config);
  const byId = new Map(flat.map((entry) => [entry.id, entry]));
  const ranks = new Map<string, number>();
  const rankOf = (nodeId: string, visiting = new Set<string>()): number => {
    const known = ranks.get(nodeId);
    if (known !== undefined) return known;
    if (visiting.has(nodeId)) return 0;
    visiting.add(nodeId);
    const inputs = (byId.get(nodeId)?.inputs ?? []).filter((input) =>
      byId.has(input)
    );
    const rank = inputs.length === 0
      ? 0
      : Math.max(...inputs.map((input) => rankOf(input, new Set(visiting)))) +
        1;
    ranks.set(nodeId, rank);
    return rank;
  };
  flat.forEach((entry) => rankOf(entry.id));
  const slots = new Map<number, number>();
  return flat.map((entry) => {
    const node = entry.node;
    const rank = ranks.get(entry.id) ?? 0;
    const slot = slots.get(rank) ?? 0;
    slots.set(rank, slot + 1);
    const implementation = node.command
      ? compact(node.command)
      : node.prompt
      ? promptDescription(node.prompt)
      : node.question
      ? compact(node.question)
      : node.type;
    return {
      id: entry.id,
      label: summaryLabel(node.label),
      type: node.type,
      // A body node sits in the phase of the loop that owns it — the loop is
      // what the `phases:` block names, the body is never mentioned there.
      phase: layout.phaseByNode.get(entry.parent ?? entry.id) ?? "other",
      inputs: entry.inputs,
      x: 80 + rank * 310,
      y: 90 + slot * 150,
      summary: implementation,
      parent: entry.parent,
      config: node,
    };
  });
}

/** Render one self-contained, interactive Node-RED-style workflow canvas. */
export function renderWorkflowHtml(
  config: WorkflowConfig,
  source: string,
): string {
  const layout = phaseLayout(config);
  const coverage = auditUnknownFields(config);
  const nodes = canvasNodes(config, layout);
  const graphWidth = Math.max(...nodes.map((node) => node.x), 0) + 330;
  const graphHeight = Math.max(...nodes.map((node) => node.y), 0) + 180;
  const payload = JSON.stringify({
    name: config.name,
    version: config.version,
    source,
    defaults: config.defaults ?? {},
    env: config.env ?? {},
    warnings: layout.warnings,
    coverage,
    coverageStatus: coverage.length === 0 ? "complete" : "incomplete",
    graphWidth,
    graphHeight,
    nodes,
  }).replaceAll("<", "\\u003c");
  const rootId = "flowai-workflow-canvas";
  return `<div id="${rootId}">
  <style>
    #${rootId} { color: var(--foreground); font: 400 var(--font-size-base) system-ui, sans-serif; }
    #${rootId} .wf-shell { display:grid; grid-template-columns:minmax(0,1fr) 300px; height:680px; border:1px solid var(--border); background:var(--background); overflow:hidden; }
    #${rootId} .wf-main { min-width:0; display:flex; flex-direction:column; }
    #${rootId} .wf-toolbar { display:flex; align-items:center; gap:8px; min-height:44px; padding:6px 10px; border-bottom:1px solid var(--border); background:var(--card); }
    #${rootId} .wf-title { margin-right:auto; font-weight:500; }
    #${rootId} button { min-width:36px; min-height:32px; border:1px solid var(--border); border-radius:5px; color:var(--foreground); background:var(--background); }
    #${rootId} .wf-stage { flex:1; min-height:0; overflow:hidden; cursor:grab; background-color:var(--muted); background-image:radial-gradient(var(--border) 1px, transparent 1px); background-size:20px 20px; }
    #${rootId} .wf-stage.dragging { cursor:grabbing; }
    #${rootId} svg { width:100%; height:100%; display:block; }
    #${rootId} .edge { fill:none; stroke:var(--muted-foreground); stroke-width:2; }
    #${rootId} .edge.post { stroke-dasharray:7 5; }
    #${rootId} .node { cursor:pointer; }
    #${rootId} .node rect.body { fill:var(--card); stroke:var(--border); stroke-width:1.5; rx:7; }
    #${rootId} .node.selected rect.body { stroke:var(--ring); stroke-width:3; }
    #${rootId} .node .accent { stroke:none; }
    #${rootId} .node.agent .accent { fill:var(--viz-series-1); }
    #${rootId} .node.command .accent { fill:var(--viz-series-2); }
    #${rootId} .node.merge .accent { fill:var(--viz-series-3); }
    #${rootId} .node.loop .accent { fill:var(--viz-series-4); }
    #${rootId} .node.human .accent, #${rootId} .node.hitl .accent { fill:var(--viz-series-5); }
    #${rootId} text { fill:var(--foreground); pointer-events:none; }
    #${rootId} .secondary { fill:var(--muted-foreground); }
    #${rootId} .port { fill:var(--background); stroke:var(--muted-foreground); stroke-width:2; }
    #${rootId} .wf-inspector { overflow:auto; border-left:1px solid var(--border); background:var(--card); padding:14px; }
    #${rootId} .wf-inspector h3 { margin:0 0 4px; font-weight:500; }
    #${rootId} .wf-meta { color:var(--muted-foreground); margin-bottom:14px; }
    #${rootId} .wf-field { margin:0 0 12px; }
    #${rootId} .wf-field dt { color:var(--muted-foreground); margin-bottom:3px; }
    #${rootId} .wf-field dd { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
    #${rootId} .wf-status { padding:5px 10px; border-top:1px solid var(--border); color:var(--muted-foreground); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    @media (max-width:700px) { #${rootId} .wf-shell { grid-template-columns:1fr; height:760px; } #${rootId} .wf-inspector { border-left:0; border-top:1px solid var(--border); max-height:250px; } }
  </style>
  <div class="wf-shell">
    <section class="wf-main" aria-label="Workflow canvas">
      <div class="wf-toolbar">
        <span class="wf-title"></span>
        <button type="button" data-action="zoom-out" aria-label="Zoom out">−</button>
        <button type="button" data-action="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" data-action="fit">Fit</button>
      </div>
      <div class="wf-stage"><svg id="workflow-canvas" role="img" aria-label="Workflow graph"><defs><marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"></path></marker></defs><g class="viewport"></g></svg></div>
      <div class="wf-status" aria-live="polite"></div>
    </section>
    <aside class="wf-inspector" aria-live="polite"></aside>
  </div>
  <script type="application/json" data-workflow>${payload}</script>
  <script>
  (() => {
    const root = document.getElementById("${rootId}");
    const data = JSON.parse(root.querySelector("[data-workflow]").textContent);
    const svg = root.querySelector("svg");
    const viewport = root.querySelector(".viewport");
    const stage = root.querySelector(".wf-stage");
    const inspector = root.querySelector(".wf-inspector");
    const status = root.querySelector(".wf-status");
    const ns = "http://www.w3.org/2000/svg";
    const byId = new Map(data.nodes.map(node => [node.id, node]));
    const make = (name, attrs = {}) => { const element = document.createElementNS(ns, name); Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value))); return element; };
    const short = (value, size) => value.length > size ? value.slice(0, size - 1) + "…" : value;
    let scale = 0.72, tx = 20, ty = 20, selected = null, dragging = false, lastX = 0, lastY = 0;
    const applyTransform = () => viewport.setAttribute("transform", "translate(" + tx + " " + ty + ") scale(" + scale + ")");
    data.nodes.forEach(target => target.inputs.forEach(input => {
      const source = byId.get(input); if (!source) return;
      const path = make("path", { d: "M " + (source.x + 250) + " " + (source.y + 52) + " C " + (source.x + 285) + " " + (source.y + 52) + ", " + (target.x - 35) + " " + (target.y + 52) + ", " + target.x + " " + (target.y + 52), class: "edge" + (target.config.run_on ? " post" : ""), "marker-end": "url(#wf-arrow)" });
      viewport.appendChild(path);
    }));
    const showNode = node => {
      selected = node.id;
      root.querySelectorAll(".node").forEach(element => element.classList.toggle("selected", element.dataset.node === node.id));
      const fields = { prerequisites: node.inputs.length ? node.inputs.join(", ") : "workflow start", ...node.config };
      inspector.replaceChildren();
      const heading = document.createElement("h3"); heading.textContent = node.id; inspector.appendChild(heading);
      const meta = document.createElement("div"); meta.className = "wf-meta"; meta.textContent = node.type + " · " + node.phase + (node.parent ? " · inside loop " + node.parent : ""); inspector.appendChild(meta);
      const dl = document.createElement("dl");
      Object.entries(fields).filter(([key]) => key !== "label" && key !== "inputs").forEach(([key, value]) => {
        const wrap = document.createElement("div"); wrap.className = "wf-field";
        const dt = document.createElement("dt"); dt.textContent = key.replaceAll("_", " ");
        const dd = document.createElement("dd"); dd.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
        wrap.append(dt, dd); dl.appendChild(wrap);
      });
      inspector.appendChild(dl); status.textContent = node.id + ": " + node.label;
    };
    data.nodes.forEach(node => {
      const group = make("g", { class: "node " + node.type, transform: "translate(" + node.x + " " + node.y + ")", "data-node": node.id });
      group.dataset.node = node.id;
      group.appendChild(make("rect", { class: "body", width: 250, height: 104 }));
      group.appendChild(make("rect", { class: "accent", width: 7, height: 104, rx: 7 }));
      group.appendChild(make("circle", { class: "port", cx: 0, cy: 52, r: 5 }));
      group.appendChild(make("circle", { class: "port", cx: 250, cy: 52, r: 5 }));
      const title = make("text", { x: 18, y: 25 }); title.textContent = short(node.label, 32); group.appendChild(title);
      const id = make("text", { x: 18, y: 46, class: "secondary" }); id.textContent = node.id; group.appendChild(id);
      const implementation = make("text", { x: 18, y: 72, class: "secondary" }); implementation.textContent = short(node.summary, 38); group.appendChild(implementation);
      const phase = make("text", { x: 18, y: 94, class: "secondary" }); phase.textContent = node.phase + " · " + node.type; group.appendChild(phase);
      group.addEventListener("click", event => { event.stopPropagation(); showNode(node); }); viewport.appendChild(group);
    });
    const fit = () => { const box = stage.getBoundingClientRect(); scale = Math.min(0.9, (box.width - 40) / data.graphWidth, (box.height - 40) / data.graphHeight); tx = 20; ty = 20; applyTransform(); };
    root.querySelector('[data-action="fit"]').addEventListener("click", fit);
    root.querySelector('[data-action="zoom-in"]').addEventListener("click", () => { scale = Math.min(2, scale * 1.2); applyTransform(); });
    root.querySelector('[data-action="zoom-out"]').addEventListener("click", () => { scale = Math.max(0.12, scale / 1.2); applyTransform(); });
    stage.addEventListener("wheel", event => { event.preventDefault(); scale = Math.max(0.12, Math.min(2, scale * (event.deltaY < 0 ? 1.1 : 0.9))); applyTransform(); }, { passive: false });
    stage.addEventListener("pointerdown", event => { dragging = true; lastX = event.clientX; lastY = event.clientY; stage.classList.add("dragging"); stage.setPointerCapture(event.pointerId); });
    stage.addEventListener("pointermove", event => { if (!dragging) return; tx += event.clientX - lastX; ty += event.clientY - lastY; lastX = event.clientX; lastY = event.clientY; applyTransform(); });
    stage.addEventListener("pointerup", () => { dragging = false; stage.classList.remove("dragging"); });
    root.querySelector(".wf-title").textContent = data.name + " · " + data.nodes.length + " nodes";
    status.textContent = "Configuration coverage: " + data.coverageStatus + (data.warnings.length ? " · " + data.warnings.join(" ") : "");
    fit(); if (data.nodes.length) showNode(data.nodes[0]);
  })();
  </script>
</div>`;
}

function renderNode(
  mermaidId: string,
  node: NodeConfig,
): string {
  const { title, detail } = splitLabel(node.label);
  const content = [
    escapeHtml(title),
    detail ? `<small>${escapeHtml(detail)}</small>` : undefined,
    nodeTraits(node).length > 0
      ? `<small>${nodeTraits(node).map(escapeHtml).join(" · ")}</small>`
      : undefined,
  ].filter((part): part is string => part !== undefined).join("<br/>");

  switch (node.type) {
    case "agent":
      return `${mermaidId}(["${content}"])`;
    case "merge":
      return `${mermaidId}[["${content}"]]`;
    case "loop":
      return `${mermaidId}{{"${content}"}}`;
    case "human":
    case "hitl":
      return `${mermaidId}{"${content}"}`;
    default:
      return `${mermaidId}["${content}"]`;
  }
}

interface NodeIds {
  top: Map<string, string>;
  bodies: Map<string, Map<string, string>>;
}

function assignNodeIds(config: WorkflowConfig): NodeIds {
  const top = new Map<string, string>();
  const bodies = new Map<string, Map<string, string>>();
  Object.entries(config.nodes).forEach(([id, node], index) => {
    const mermaidId = `n${index}`;
    top.set(id, mermaidId);
    if (node.type === "loop" && node.nodes) {
      const body = new Map<string, string>();
      Object.keys(node.nodes).forEach((bodyId, bodyIndex) => {
        body.set(bodyId, `${mermaidId}_body_${bodyIndex}`);
      });
      bodies.set(id, body);
    }
  });
  return { top, bodies };
}

interface PhaseGroup {
  id: string;
  label: string;
  nodes: string[];
}

interface PhaseLayout {
  groups: PhaseGroup[];
  phaseByNode: Map<string, string>;
  warnings: string[];
}

function phaseLayout(config: WorkflowConfig): PhaseLayout {
  const nodeIds = Object.keys(config.nodes);
  const phaseByNode = new Map<string, string>();
  const groups: PhaseGroup[] = [];
  const groupByLabel = new Map<string, PhaseGroup>();
  const hasDeclaredPhases = config.phases &&
    Object.keys(config.phases).length > 0;

  const addGroup = (id: string, label: string): PhaseGroup => {
    const existing = groupByLabel.get(label);
    if (existing) return existing;
    const group = { id, label, nodes: [] };
    groups.push(group);
    groupByLabel.set(label, group);
    return group;
  };

  if (hasDeclaredPhases) {
    Object.entries(config.phases ?? {}).forEach(([label, members], index) => {
      addGroup(`phase_${index}`, label);
      members.forEach((nodeId) => phaseByNode.set(nodeId, label));
    });
  } else {
    addGroup("phase_all", "workflow");
    nodeIds.forEach((nodeId) => phaseByNode.set(nodeId, "workflow"));
  }

  for (const [nodeId, node] of Object.entries(config.nodes)) {
    if (node.phase && !phaseByNode.has(nodeId)) {
      addGroup(`phase_explicit_${groups.length}`, node.phase);
      phaseByNode.set(nodeId, node.phase);
    }
  }

  // FR-E99: one definition of "post-workflow node", shared with the engine.
  const postNodes = new Set(collectPostWorkflowNodes(config.nodes));
  for (const nodeId of postNodes) phaseByNode.set(nodeId, "post-workflow");

  const inferred = new Map<string, string>();
  if (hasDeclaredPhases) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const nodeId of nodeIds) {
        if (phaseByNode.has(nodeId)) continue;
        const adjacent = new Set<string>();
        for (const input of config.nodes[nodeId].inputs ?? []) {
          const phase = phaseByNode.get(input);
          if (phase && phase !== "post-workflow") adjacent.add(phase);
        }
        for (const [successorId, successor] of Object.entries(config.nodes)) {
          if (!(successor.inputs ?? []).includes(nodeId)) continue;
          const phase = phaseByNode.get(successorId);
          if (phase && phase !== "post-workflow") adjacent.add(phase);
        }
        if (adjacent.size === 1) {
          const phase = [...adjacent][0];
          phaseByNode.set(nodeId, phase);
          inferred.set(nodeId, phase);
          changed = true;
        }
      }
    }
  }

  const unresolved = nodeIds.filter((nodeId) => !phaseByNode.has(nodeId));
  if (unresolved.length > 0) {
    addGroup("phase_other", "other");
    unresolved.forEach((nodeId) => phaseByNode.set(nodeId, "other"));
  }
  if (postNodes.size > 0) addGroup("phase_post", "post-workflow");

  for (const nodeId of nodeIds) {
    const label = phaseByNode.get(nodeId);
    if (label) groupByLabel.get(label)?.nodes.push(nodeId);
  }

  return {
    groups: groups.filter((group) => group.nodes.length > 0),
    phaseByNode,
    warnings: [...inferred].map(
      ([nodeId, phase]) =>
        `Node \`${nodeId}\` has no declared phase; shown in \`${phase}\` based on its dependencies.`,
    ),
  };
}

function dependsOn(
  config: WorkflowConfig,
  nodeId: string,
  possibleAncestor: string,
  visited = new Set<string>(),
): boolean {
  if (visited.has(nodeId)) return false;
  visited.add(nodeId);
  for (const input of config.nodes[nodeId]?.inputs ?? []) {
    if (input === possibleAncestor) return true;
    if (dependsOn(config, input, possibleAncestor, visited)) return true;
  }
  return false;
}

function immediateInputs(config: WorkflowConfig, nodeId: string): string[] {
  const inputs = (config.nodes[nodeId].inputs ?? []).filter((input) =>
    config.nodes[input] !== undefined
  );
  return inputs.filter((input) =>
    !inputs.some((other) => other !== input && dependsOn(config, other, input))
  );
}

function phaseEdges(
  config: WorkflowConfig,
  layout: PhaseLayout,
): Array<[string, string]> {
  const edges = new Set<string>();
  for (const [nodeId] of Object.entries(config.nodes)) {
    const target = layout.phaseByNode.get(nodeId);
    if (!target) continue;
    for (const input of immediateInputs(config, nodeId)) {
      const source = layout.phaseByNode.get(input);
      if (source && source !== target) edges.add(`${source}\0${target}`);
    }
  }
  const pairs = [...edges].map((edge) => edge.split("\0") as [string, string]);
  const reaches = (from: string, to: string, skip: string): boolean => {
    const queue = [from];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === to) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const [source, target] of pairs) {
        if (`${source}\0${target}` !== skip && source === current) {
          queue.push(target);
        }
      }
    }
    return false;
  };
  return pairs.filter(([source, target]) =>
    !reaches(source, target, `${source}\0${target}`)
  );
}

/** Render a validated workflow as a Markdown document with a Mermaid graph. */
export function renderWorkflowMarkdown(
  config: WorkflowConfig,
  source: string,
): string {
  const ids = assignNodeIds(config);
  const layout = phaseLayout(config);
  const coverageWarnings = auditUnknownFields(config);
  const lines = [
    `# Workflow: ${config.name}`,
    "",
    `Source: \`${source.replace(/`/g, "\\`")}\``,
    "",
  ];
  if (layout.warnings.length > 0) {
    lines.push(
      "Warnings:",
      "",
      ...layout.warnings.map((warning) => `- ${warning}`),
      "",
    );
  }
  lines.push(
    `Configuration coverage: ${
      coverageWarnings.length === 0 ? "complete" : "incomplete"
    }.`,
    "",
  );
  if (coverageWarnings.length > 0) {
    lines.push(...coverageWarnings.map((warning) => `- ${warning}`), "");
  }
  lines.push(
    "## Workflow settings",
    "",
    ...workflowSettingLines(config),
    "",
  );
  lines.push(
    "## Overview",
    "",
    "Read left to right. Each box is a phase; its lines are the operations in that phase.",
    "",
    "```mermaid",
    "flowchart LR",
  );

  const phaseSummaryIds = new Map<string, string>();
  layout.groups.forEach((group, index) => {
    const summaryId = `phase_summary_${index}`;
    phaseSummaryIds.set(group.label, summaryId);
    const operations = group.nodes
      .map((nodeId) => escapeHtml(summaryLabel(config.nodes[nodeId].label)))
      .join("<br/>");
    lines.push(
      `    ${summaryId}["<b>${
        escapeHtml(group.label)
      }</b><br/><br/>${operations}"]`,
    );
  });
  for (const [source, target] of phaseEdges(config, layout)) {
    const sourceId = phaseSummaryIds.get(source);
    const targetId = phaseSummaryIds.get(target);
    if (sourceId && targetId) lines.push(`    ${sourceId} --> ${targetId}`);
  }
  lines.push(
    "    classDef phase fill:#f7f8fa,stroke:#59636e,color:#17202a,stroke-width:2px",
    `    class ${[...phaseSummaryIds.values()].join(",")} phase`,
    "```",
    "",
    "## Execution map",
    "",
    "Read top to bottom. Only immediate dependencies are drawn; redundant transitive arrows are hidden.",
    "Blue rounded nodes require agent judgement. Green rectangles are deterministic commands.",
    "Yellow double rectangles merge data, purple hexagons are loops, and red diamonds require human input.",
    "Dashed arrows lead to post-workflow nodes or show loop containment.",
    "",
    "```mermaid",
    "flowchart TB",
  );

  for (const group of layout.groups) {
    lines.push(`    subgraph ${group.id}["${escapeHtml(group.label)}"]`);
    lines.push("        direction TB");
    for (const nodeId of group.nodes) {
      const node = config.nodes[nodeId];
      const mermaidId = ids.top.get(nodeId);
      if (!node || !mermaidId) continue;
      lines.push(`        ${renderNode(mermaidId, node)}`);
      if (node.type === "loop" && node.nodes) {
        const bodyIds = ids.bodies.get(nodeId);
        for (const [bodyId, bodyNode] of Object.entries(node.nodes)) {
          const bodyMermaidId = bodyIds?.get(bodyId);
          if (bodyMermaidId) {
            lines.push(
              `        ${renderNode(bodyMermaidId, bodyNode)}`,
            );
          }
        }
      }
    }
    lines.push("    end");
    lines.push(
      `    style ${group.id} fill:#fbfbfc,stroke:#aab2bd,stroke-width:1px`,
    );
  }

  for (const [nodeId, node] of Object.entries(config.nodes)) {
    const target = ids.top.get(nodeId);
    if (!target) continue;
    for (const input of immediateInputs(config, nodeId)) {
      const sourceId = ids.top.get(input);
      const arrow = node.run_on ? "-.->" : "-->";
      if (sourceId) lines.push(`    ${sourceId} ${arrow} ${target}`);
    }

    if (node.type === "loop" && node.nodes) {
      const bodyIds = ids.bodies.get(nodeId);
      const firstBodyId = Object.keys(node.nodes)[0];
      const firstBody = firstBodyId ? bodyIds?.get(firstBodyId) : undefined;
      if (firstBody) lines.push(`    ${target} -. contains .-> ${firstBody}`);
      for (const [bodyId, bodyNode] of Object.entries(node.nodes)) {
        const bodyTarget = bodyIds?.get(bodyId);
        if (!bodyTarget) continue;
        for (const input of bodyNode.inputs ?? []) {
          const bodySource = bodyIds?.get(input);
          if (bodySource) lines.push(`    ${bodySource} --> ${bodyTarget}`);
        }
      }
    }
  }

  lines.push(`    ${NODE_CLASSES}`);
  for (const [nodeId, node] of Object.entries(config.nodes)) {
    const mermaidId = ids.top.get(nodeId);
    if (mermaidId) lines.push(`    class ${mermaidId} ${node.type}`);
    if (node.type === "loop" && node.nodes) {
      const bodyIds = ids.bodies.get(nodeId);
      for (const [bodyId, bodyNode] of Object.entries(node.nodes)) {
        const bodyMermaidId = bodyIds?.get(bodyId);
        if (bodyMermaidId) {
          lines.push(`    class ${bodyMermaidId} ${bodyNode.type}`);
        }
      }
    }
  }
  lines.push(
    "```",
    "",
    "## Operational details",
    "",
    "Each card shows the actual prerequisite, executable command or agent instruction, gates, hooks, checks, fan-out, and local overrides. Inline prompt bodies are summarized by line count and opening line.",
    "",
  );

  for (const group of layout.groups) {
    lines.push(`### ${group.label}`, "", "```mermaid", "flowchart TB");
    for (const nodeId of group.nodes) {
      const node = config.nodes[nodeId];
      const mermaidId = ids.top.get(nodeId);
      if (!node || !mermaidId) continue;
      lines.push(
        `    op_${mermaidId}["${
          operationalLines(nodeId, node).join("<br/>")
        }"]`,
      );
      if (node.type === "loop" && node.nodes) {
        const bodyIds = ids.bodies.get(nodeId);
        for (const [bodyId, bodyNode] of Object.entries(node.nodes)) {
          const bodyMermaidId = bodyIds?.get(bodyId);
          if (!bodyMermaidId) continue;
          lines.push(
            `    op_${bodyMermaidId}["${
              operationalLines(bodyId, bodyNode).join("<br/>")
            }"]`,
          );
        }
      }
    }
    for (const nodeId of group.nodes) {
      const node = config.nodes[nodeId];
      const target = ids.top.get(nodeId);
      if (!target) continue;
      for (const input of immediateInputs(config, nodeId)) {
        if (layout.phaseByNode.get(input) !== group.label) continue;
        const sourceId = ids.top.get(input);
        if (sourceId) lines.push(`    op_${sourceId} --> op_${target}`);
      }
      if (node.type === "loop" && node.nodes) {
        const bodyIds = ids.bodies.get(nodeId);
        const firstBodyId = Object.keys(node.nodes)[0];
        const firstBody = firstBodyId ? bodyIds?.get(firstBodyId) : undefined;
        if (firstBody) {
          lines.push(`    op_${target} -. contains .-> op_${firstBody}`);
        }
        for (const [bodyId, bodyNode] of Object.entries(node.nodes)) {
          const bodyTarget = bodyIds?.get(bodyId);
          if (!bodyTarget) continue;
          for (const input of bodyNode.inputs ?? []) {
            const bodySource = bodyIds?.get(input);
            if (bodySource) {
              lines.push(`    op_${bodySource} --> op_${bodyTarget}`);
            }
          }
        }
      }
    }
    lines.push(
      "    classDef operation fill:#ffffff,stroke:#59636e,color:#17202a",
      `    class ${
        group.nodes.map((nodeId) => `op_${ids.top.get(nodeId)}`).join(",")
      } operation`,
      "```",
      "",
    );
  }
  return lines.join("\n");
}

/** Parse the diagram script command line. */
export function parseDiagramArgs(args: string[]): DiagramArgs {
  const result: DiagramArgs = {
    input: undefined,
    output: undefined,
    help: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--output" || arg === "-o") {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a file path`);
      if (result.output) {
        throw new Error("Output path specified more than once");
      }
      result.output = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option '${arg}'`);
    } else if (result.input) {
      throw new Error("Only one workflow path may be specified");
    } else {
      result.input = arg;
    }
  }
  return result;
}

/** Resolve either a workflow directory or a direct workflow.yaml path. */
export async function resolveWorkflowConfigPath(
  input: string,
): Promise<string> {
  const path = resolve(input);
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(path);
  } catch {
    throw new Error(`Workflow path does not exist: ${path}`);
  }
  if (stat.isDirectory) {
    const configPath = join(path, "workflow.yaml");
    try {
      const configStat = await Deno.stat(configPath);
      if (!configStat.isFile) throw new Error();
    } catch {
      throw new Error(`Workflow directory has no workflow.yaml: ${path}`);
    }
    return configPath;
  }
  if (!stat.isFile) throw new Error(`Workflow path is not a file: ${path}`);
  return path;
}

function printUsage(): void {
  console.log(`Usage:
  deno task workflow-diagram -- <workflow-dir-or-yaml> [--output <file>]

Without --output, the generated Markdown is written to stdout.`);
}

async function main(args: string[]): Promise<void> {
  const parsed = parseDiagramArgs(args);
  if (parsed.help) {
    printUsage();
    return;
  }
  if (!parsed.input) throw new Error("Workflow path is required; use --help");

  const configPath = await resolveWorkflowConfigPath(parsed.input);
  const config = parseWorkflowForDiagram(await Deno.readTextFile(configPath));
  const rendered = parsed.output?.toLowerCase().endsWith(".html")
    ? renderWorkflowHtml(config, configPath)
    : renderWorkflowMarkdown(config, configPath);

  if (parsed.output) {
    await Deno.writeTextFile(parsed.output, rendered);
    console.log(`Workflow diagram written to ${resolve(parsed.output)}`);
  } else {
    console.log(rendered);
  }
}

if (import.meta.main) {
  main(Deno.args).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  });
}
