/**
 * @module
 * Unified run-control command layer (FR-E75).
 *
 * Single home for operations that must behave identically whether they are
 * triggered from the host IDE (MCP tools) or the terminal (CLI subcommands).
 * MCP (`mcp-server.ts`) and CLI (`cli.ts`) are THIN interfaces over these
 * functions — they parse/serialise, this module owns the logic. Keeps the
 * two surfaces from drifting and gives the behaviour one place to test.
 *
 * Exports:
 *   - {@link deliverHumanAnswer} — write a HITL reply into the run's local
 *     inbox file (transport-independent; the live poll loop reads it).
 *   - {@link resumeRun} — the sole `Engine({resume:true})` construction site.
 *   - {@link startRun} — the sole `Engine({resume:false})` construction site
 *     (FR-E84). `wait:true` runs in-process and blocks; `wait:false` (default)
 *     launches an independent detached engine process and returns immediately.
 */

import { basename, dirname, fromFileUrl } from "@std/path";

import type { Verbosity } from "../types.ts";
import { workflowConfigPath } from "../config/config.ts";
import { Engine } from "../engine/engine.ts";
import { isRunLive, liveLockHolder } from "../state/lock.ts";
import { replayRunJournal } from "../state/run-journal.ts";
import { generateRunId, getHitlInboxPath, getRunDir } from "../state/state.ts";
import { VERSION } from "../version.ts";

/** Parameters for {@link deliverHumanAnswer}. */
export interface DeliverHumanAnswerParams {
  /** Workflow folder containing `workflow.yaml` and `runs/`. */
  workflowDir: string;
  /** Target run id (the waiting run). */
  runId: string;
  /** Target node id — ALWAYS explicit; no single-waiting-node auto-pick. */
  nodeId: string;
  /** Reply text delivered to the agent verbatim. */
  text: string;
}

/** Result of {@link deliverHumanAnswer}. */
export interface DeliverHumanAnswerResult {
  /** Absolute-or-relative path of the inbox file that was written. */
  inboxPath: string;
  /** True when an engine process holding the run lock is alive (it will
   * pick the file up on its next poll). False means the caller must resume
   * the run separately. */
  live: boolean;
}

/**
 * Deliver a HITL reply to a waiting run through the local inbox channel
 * (FR-E75). Write-only and non-blocking: it validates the target node is
 * `waiting`, writes the reply atomically to
 * `<runDir>/.hitl-inbox/<nodeId>.txt`, and reports engine liveness. It
 * NEVER resumes the engine — when `live === false`, the caller resumes
 * separately via {@link resumeRun}.
 *
 * Fail-fast (no silent fallbacks): empty text, an unknown node, or a node
 * that is not currently `waiting` all throw with a clear message and write
 * nothing.
 */
export async function deliverHumanAnswer(
  params: DeliverHumanAnswerParams,
): Promise<DeliverHumanAnswerResult> {
  const { workflowDir, runId, nodeId, text } = params;

  if (!text.trim()) {
    throw new Error("answer text is empty; a non-empty reply is required");
  }

  const runDir = getRunDir(runId, workflowDir);
  // Replay the journal to learn the node's live status. A missing journal
  // throws here — surfaced to the caller as a clear "no such run" error.
  const { state } = await replayRunJournal(runDir);
  const node = state.nodes[nodeId];
  if (!node) {
    throw new Error(
      `unknown node '${nodeId}' in run '${runId}'`,
    );
  }
  if (node.status !== "waiting") {
    throw new Error(
      `node '${nodeId}' is not waiting for human input ` +
        `(status: ${node.status}); nothing to answer`,
    );
  }

  const inboxPath = getHitlInboxPath(runDir, nodeId);
  // Atomic write: stage a sibling tmp file then rename into place so the
  // live poll loop never observes a half-written inbox file.
  await Deno.mkdir(dirname(inboxPath), { recursive: true });
  const tmpPath = `${inboxPath}.tmp`;
  await Deno.writeTextFile(tmpPath, text);
  await Deno.rename(tmpPath, inboxPath);

  const live = await isRunLive(workflowDir, runId);
  return { inboxPath, live };
}

/** Parameters for {@link resumeRun}. */
export interface ResumeRunParams {
  /** Workflow folder containing `workflow.yaml`. */
  workflowDir: string;
  /** Run id to resume. */
  runId: string;
  /** Output verbosity for the resumed engine run (default `quiet`). */
  verbosity?: Verbosity;
}

/** Summary triple returned by {@link resumeRun}. */
export interface ResumeRunResult {
  run_id: string;
  status: string;
  total_cost_usd?: number;
}

/**
 * Resume a previously-started run from its journal state (FR-E75). This is
 * the SINGLE `Engine({resume:true})` construction site in the codebase —
 * MCP `resume_node` and CLI `run --resume` both delegate here so the resume
 * behaviour cannot drift between the two surfaces. Blocks until the engine
 * run completes (may take minutes).
 */
export async function resumeRun(
  params: ResumeRunParams,
): Promise<ResumeRunResult> {
  const { workflowDir, runId, verbosity = "quiet" } = params;
  const engine = new Engine({
    config_path: workflowConfigPath(workflowDir),
    run_id: runId,
    resume: true,
    dry_run: false,
    verbosity,
    args: {},
    env_overrides: {},
  });
  const state = await engine.run();
  return {
    run_id: state.run_id,
    status: state.status,
    total_cost_usd: state.total_cost_usd,
  };
}

/** Parameters for {@link startRun}. */
export interface StartRunParams {
  /** Workflow folder containing `workflow.yaml`. */
  workflowDir: string;
  /** Optional extra context forwarded to the workflow as `args.prompt`
   * (mirrors the CLI `--prompt` flag). */
  prompt?: string;
  /** Blocking mode selector (default false). `false` → launch a detached
   * background engine process and return `{ run_id, pid }` immediately.
   * `true` → run in-process, block until completion, return the final
   * `{ run_id, status, total_cost_usd }`. */
  wait?: boolean;
  /** Output verbosity for the blocking (`wait:true`) path (default `quiet`). */
  verbosity?: Verbosity;
}

/** Result of {@link startRun}. `wait` echoes the chosen mode so the caller
 * does not have to remember which fields are populated. */
export interface StartRunResult {
  run_id: string;
  wait: boolean;
  /** Populated only for `wait:true` (final engine state). */
  status?: string;
  /** Populated only for `wait:true`. */
  total_cost_usd?: number;
  /** PID of the detached engine process — populated only for `wait:false`. */
  pid?: number;
}

/**
 * Start a FRESH workflow run (FR-E84) — the SINGLE `Engine({resume:false})`
 * construction site, shared by MCP `start_run` and (the blocking path) any
 * future CLI delegate so start behaviour cannot drift.
 *
 * `wait:false` (default) is the supervisor's primary need: it launches the
 * engine as an INDEPENDENT detached process (re-exec of the engine binary,
 * `child.unref()`) that survives the MCP server / host dying, and returns
 * `{ run_id, pid }` before the run completes so the caller polls via
 * `get_state`/`tail_artifacts`. It pre-checks the per-workflow lock and
 * fail-fast rejects when a run is already active (FR-E60: no parallel
 * `Engine.run()` per workflow).
 *
 * `wait:true` runs the engine in-process and blocks until completion — usable
 * for short workflows where the caller genuinely wants the final state; the
 * run dies with the MCP server if the host exits.
 */
export async function startRun(
  params: StartRunParams,
): Promise<StartRunResult> {
  const { workflowDir, prompt, wait = false, verbosity = "quiet" } = params;

  if (wait) {
    const runId = generateRunId(basename(workflowDir));
    const engine = new Engine({
      config_path: workflowConfigPath(workflowDir),
      run_id: runId,
      resume: false,
      dry_run: false,
      verbosity,
      args: prompt ? { prompt } : {},
      env_overrides: {},
    });
    const state = await engine.run();
    return {
      run_id: state.run_id,
      status: state.status,
      total_cost_usd: state.total_cost_usd,
      wait: true,
    };
  }

  // Background: reject up-front if a run already holds the workflow lock so
  // the caller gets a clear error instead of a doomed detached process that
  // would fail later on `acquireLock` (FR-E60).
  const holder = await liveLockHolder(workflowDir);
  if (holder) {
    throw new Error(
      `a run is already active (run_id: ${holder.run_id}, pid: ${holder.pid}); ` +
        `cannot start a parallel run for this workflow`,
    );
  }

  const runId = generateRunId(basename(workflowDir));
  const { exec, args } = buildEngineRunCommand(workflowDir, runId, prompt);
  // Detached daemon: no stdio pipes (observability is via run artifacts +
  // tail_artifacts), unref'd so it outlives this process and the FR-E83
  // parent-death watchdog (which only reaps the MCP server's own group).
  const child = new Deno.Command(exec, {
    args,
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  child.unref();
  return { run_id: runId, pid: child.pid, wait: false };
}

/**
 * Build the argv to re-exec the engine `run` subcommand for a background
 * start. Two explicit environment branches (NOT an error-recovery fallback):
 * a compiled binary IS the engine (`Deno.execPath()` runs `flowai-workflow
 * run …` directly); under `deno run` (dev/tests, `VERSION === "dev"`) the
 * exec is the `deno` binary, so we re-run `src/cli.ts` through it. The fresh
 * `--run-id` flag (FR-E84) pins the engine to the id this function allocated,
 * so `startRun` can return it before the run completes.
 */
export function buildEngineRunCommand(
  workflowDir: string,
  runId: string,
  prompt?: string,
): { exec: string; args: string[] } {
  const promptArgs = prompt ? ["--prompt", prompt] : [];
  const runArgs = ["run", workflowDir, "--run-id", runId, ...promptArgs];
  if (VERSION === "dev") {
    const cliPath = fromFileUrl(import.meta.resolve("../cli.ts"));
    return {
      exec: Deno.execPath(),
      args: ["run", "-A", "--no-check", cliPath, ...runArgs],
    };
  }
  return { exec: Deno.execPath(), args: runArgs };
}
