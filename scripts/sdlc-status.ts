#!/usr/bin/env -S deno run -A
/**
 * @module
 * Compact status reporter for a flowai-workflow run.
 *
 * Reads only durable artifacts under `<workflowDir>/runs/`:
 *
 * - `runs/.lock`   — JSON `{pid, hostname, run_id, started_at}` written by
 *                    the engine while a run owns the workflow folder.
 * - `runs/<id>/state.json`    — engine-owned run state (RunState).
 * - `runs/<id>/journal.jsonl` — append-only event log; tail printed on
 *                                request.
 *
 * Designed for the supervisor subagent's attach-live mode: one read per
 * invocation, no engine pipe, no extra processes spawned.
 *
 * CLI:
 *
 *   deno run -A scripts/sdlc-status.ts                              # all workflows
 *   deno run -A scripts/sdlc-status.ts .flowai-workflow/<name>      # one workflow
 *   deno run -A scripts/sdlc-status.ts <wf> --run <id>              # specific run
 *   deno run -A scripts/sdlc-status.ts <wf> --json                  # JSON output
 *   deno run -A scripts/sdlc-status.ts <wf> --journal <N>           # tail N events
 */

import { join } from "@std/path";

export interface LockInfo {
  pid: number;
  run_id: string;
  hostname: string;
  started_at: string;
  alive: boolean;
}

export interface RunSummary {
  id: string;
  status: string;
  started_at: string;
  completed_at?: string;
  current_node?: string;
  nodes: Record<string, string>;
  error?: string;
  total_cost_usd?: number;
  journal_tail?: Record<string, unknown>[];
}

export interface WorkflowStatus {
  workflow: string;
  lock: LockInfo | null;
  run: RunSummary | null;
}

export interface LoadOptions {
  journalTail?: number;
}

/** Cheap liveness probe via signal 0 — does not touch the process. */
export function pidAlive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const text = await Deno.readTextFile(path);
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

async function listRunDirs(runsDir: string): Promise<string[]> {
  const entries: { name: string; mtime: number }[] = [];
  try {
    for await (const e of Deno.readDir(runsDir)) {
      if (!e.isDirectory) continue;
      if (e.name.startsWith(".")) continue;
      const stat = await Deno.stat(join(runsDir, e.name));
      entries.push({ name: e.name, mtime: stat.mtime?.getTime() ?? 0 });
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries.map((e) => e.name);
}

async function readJournalTail(
  path: string,
  n: number,
): Promise<Record<string, unknown>[] | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined;
    throw e;
  }
  const lines = text.split("\n").filter((l) => l.length > 0);
  const tail = lines.slice(-n);
  const parsed: Record<string, unknown>[] = [];
  for (const line of tail) {
    try {
      parsed.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      parsed.push({ raw: line });
    }
  }
  return parsed;
}

function summarizeRun(
  raw: Record<string, unknown>,
  journalTail?: Record<string, unknown>[],
): RunSummary {
  const nodesRaw = (raw.nodes ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const nodes: Record<string, string> = {};
  let current: string | undefined;
  let firstError: string | undefined;
  for (const [id, n] of Object.entries(nodesRaw)) {
    const st = String(n.status ?? "unknown");
    nodes[id] = st;
    if (!current && (st === "running" || st === "waiting")) current = id;
    if (!firstError && st === "failed" && typeof n.error === "string") {
      firstError = n.error;
    }
  }
  return {
    id: String(raw.run_id ?? ""),
    status: String(raw.status ?? "unknown"),
    started_at: String(raw.started_at ?? ""),
    completed_at: raw.completed_at ? String(raw.completed_at) : undefined,
    current_node: current,
    nodes,
    error: firstError,
    total_cost_usd: typeof raw.total_cost_usd === "number"
      ? raw.total_cost_usd
      : undefined,
    journal_tail: journalTail,
  };
}

/** Load lock + (specified or newest) run summary for one workflow folder. */
export async function loadWorkflowStatus(
  workflowDir: string,
  runId?: string,
  opts: LoadOptions = {},
): Promise<WorkflowStatus> {
  const runsDir = join(workflowDir, "runs");
  const lockRaw = await readJsonIfExists<{
    pid: number;
    run_id: string;
    hostname: string;
    started_at: string;
  }>(join(runsDir, ".lock"));
  const lock: LockInfo | null = lockRaw
    ? { ...lockRaw, alive: pidAlive(lockRaw.pid) }
    : null;

  let chosen = runId;
  if (!chosen) {
    if (lock) chosen = lock.run_id;
    else {
      const all = await listRunDirs(runsDir);
      chosen = all[0];
    }
  }

  let run: RunSummary | null = null;
  if (chosen) {
    const runDir = join(runsDir, chosen);
    const state = await readJsonIfExists<Record<string, unknown>>(
      join(runDir, "state.json"),
    );
    if (state) {
      const tail = opts.journalTail
        ? await readJournalTail(join(runDir, "journal.jsonl"), opts.journalTail)
        : undefined;
      run = summarizeRun(state, tail);
    }
  }

  return { workflow: workflowDir, lock, run };
}

export function formatStatusText(s: WorkflowStatus): string {
  const lines: string[] = [];
  lines.push(`workflow: ${s.workflow}`);
  if (s.lock) {
    lines.push(
      `  lock: pid=${s.lock.pid} alive=${s.lock.alive} ` +
        `run=${s.lock.run_id} started=${s.lock.started_at}`,
    );
  } else {
    lines.push("  lock: none");
  }
  if (s.run) {
    const r = s.run;
    const head = `  run: ${r.id} status=${r.status} started=${r.started_at}` +
      (r.current_node ? ` current=${r.current_node}` : "") +
      (r.completed_at ? ` completed=${r.completed_at}` : "");
    lines.push(head);
    const nodeSummary = Object.entries(r.nodes)
      .map(([id, st]) => `${id}=${st}`)
      .join(" ");
    if (nodeSummary) lines.push(`    nodes: ${nodeSummary}`);
    if (typeof r.total_cost_usd === "number") {
      lines.push(`    cost_usd: ${r.total_cost_usd.toFixed(4)}`);
    }
    if (r.error) lines.push(`    error: ${r.error}`);
    if (r.journal_tail && r.journal_tail.length > 0) {
      lines.push(`  journal tail (${r.journal_tail.length}):`);
      for (const ev of r.journal_tail) {
        lines.push(`    ${JSON.stringify(ev)}`);
      }
    }
  } else {
    lines.push("  run: none");
  }
  return lines.join("\n");
}

async function findWorkflows(root: string): Promise<string[]> {
  const wfRoot = join(root, ".flowai-workflow");
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(wfRoot)) {
      if (!e.isDirectory || e.name.startsWith(".")) continue;
      const wfPath = join(wfRoot, e.name);
      try {
        await Deno.stat(join(wfPath, "workflow.yaml"));
        out.push(wfPath);
      } catch { /* not a workflow folder */ }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  out.sort();
  return out;
}

interface ParsedArgs {
  workflow?: string;
  run?: string;
  json: boolean;
  journalTail?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--run") out.run = argv[++i];
    else if (a === "--journal") out.journalTail = Number(argv[++i]);
    else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: sdlc-status.ts [<workflow-dir>] [--run <id>] [--json] [--journal <N>]",
      );
      Deno.exit(0);
    } else if (!a.startsWith("-")) out.workflow = a;
    else throw new Error(`unknown flag: ${a}`);
  }
  return out;
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const workflows = args.workflow
    ? [args.workflow]
    : await findWorkflows(Deno.cwd());
  if (workflows.length === 0) {
    console.error("no workflows found under .flowai-workflow/");
    Deno.exit(1);
  }
  const statuses: WorkflowStatus[] = [];
  for (const wf of workflows) {
    statuses.push(
      await loadWorkflowStatus(wf, args.run, {
        journalTail: args.journalTail,
      }),
    );
  }
  if (args.json) {
    console.log(JSON.stringify(statuses, null, 2));
  } else {
    console.log(statuses.map(formatStatusText).join("\n\n"));
  }
}
