/**
 * @module
 * HITL node execution (FR-E93): ask a human a question through the workflow's
 * configured HITL transport and wait for the answer, as an ordinary DAG node.
 *
 * Distinct from the two pre-existing human paths:
 * - `type: human` prompts on the terminal, so it only works when an operator
 *   is sitting at the run.
 * - `defaults.hitl` handles a question an *agent* raised mid-invocation, and
 *   resumes that agent's session with the reply.
 *
 * This node is neither: the workflow author decides where the human belongs,
 * and the answer becomes an artifact that downstream nodes read like any other.
 * Entry point: {@link runHitlNode}.
 */

import type {
  ErrorCategory,
  HitlConfig,
  NodeConfig,
  TemplateContext,
} from "../types.ts";
import { interpolate } from "../config/template.ts";
import { getHitlInboxPath, workPath } from "../state/state.ts";
import type { OutputManager } from "../output.ts";
import {
  appendHitlAuditRecord,
  buildScriptArgs,
  defaultScriptRunner,
  formatScriptFailure,
  type HitlQuestion,
  isHitlConfigured,
  readAndConsumeInbox,
  type ScriptRunner,
  sleep,
} from "./hitl.ts";

/** Outcome of one HITL node execution. */
export interface HitlNodeResult {
  /** True when a reply arrived and it was not an abort answer. */
  success: boolean;
  /** The human's reply (option text when the reply was an option number). */
  response: string;
  /** True when the reply matched one of the node's `abort_on` values. */
  aborted: boolean;
  /** Failure description; absent on success. */
  error?: string;
  /** Engine-vocabulary failure category; absent on success. */
  error_category?: ErrorCategory;
}

/** Injectable dependencies and identity for one HITL node execution. */
export interface HitlNodeOptions {
  /** Node id — names the inbox file and is passed to the ask/check scripts. */
  nodeId: string;
  /** Absolute path to the run directory. Passed in rather than derived from
   * `ctx.run_dir`, which is workDir-relative (FR-E52) and would send the
   * ask/check scripts looking in the wrong place under worktree isolation. */
  runDir: string;
  /** Script runner; defaults to the real shell runner. */
  scriptRunner?: ScriptRunner;
  /** Working directory for the scripts (worktree path, or undefined for CWD). */
  cwd?: string;
  /** Output manager for waiting-status lines. */
  output?: OutputManager;
}

/**
 * Ask a human a question and wait for the answer.
 *
 * Delivers the question through `ask_script`, then polls two channels until
 * `timeout` seconds elapse: the local inbox (written by MCP
 * `provide_human_input` / CLI `answer`) and `check_script`. The inbox wins
 * when both have something, since a locally delivered answer is the more
 * recent one by construction.
 *
 * The reply is written to `<node_dir>/response.txt` — the same artifact
 * `type: human` produces, so a workflow can swap terminal prompting for an
 * external channel without touching its downstream nodes — and appended to
 * `<node_dir>/hitl.jsonl` for the audit trail.
 */
export async function runHitlNode(
  node: NodeConfig,
  ctx: TemplateContext,
  config: HitlConfig | undefined,
  opts: HitlNodeOptions,
): Promise<HitlNodeResult> {
  if (node.type !== "hitl") {
    throw new Error(`Node is not a hitl node (type: ${node.type})`);
  }
  if (!isHitlConfigured(config)) {
    return failure(
      "defaults.hitl requires non-empty ask_script and check_script for 'hitl' nodes",
      "unknown",
    );
  }

  const runner = opts.scriptRunner ??
    ((path: string, args: string[]) =>
      defaultScriptRunner(path, args, opts.cwd));

  const question: HitlQuestion = {
    question: interpolate(node.question!, ctx),
    ...(node.options && node.options.length > 0
      ? { options: node.options.map((label) => ({ label })) }
      : {}),
  };

  const askResult = await runner(
    config.ask_script,
    buildScriptArgs(
      "ask",
      opts.runDir,
      ctx.run_id,
      opts.nodeId,
      config,
      ctx,
      question,
    ),
  );
  if (askResult.exitCode !== 0) {
    return failure(formatScriptFailure("ask_script", askResult), "unknown");
  }

  const reply = await pollForReply(config, ctx, opts, runner);
  if (reply === undefined) {
    return failure(
      `No human reply within ${config.timeout}s`,
      "hitl_timeout",
    );
  }

  return await recordReply(node, ctx, question, reply);
}

/**
 * Poll the inbox and `check_script` until a reply arrives or time runs out.
 *
 * The inbox is read before the first sleep: an answer may already be waiting
 * (a resumed run, or an operator who answered ahead of the question), and
 * sleeping through a `poll_interval` first would delay it for no reason.
 */
async function pollForReply(
  config: HitlConfig,
  ctx: TemplateContext,
  opts: HitlNodeOptions,
  runner: ScriptRunner,
): Promise<string | undefined> {
  const started = Date.now();
  const deadline = started + config.timeout * 1000;
  const inboxPath = getHitlInboxPath(opts.runDir, opts.nodeId);

  const inboxFirst = await readAndConsumeInbox(inboxPath);
  if (inboxFirst !== undefined) return inboxFirst;

  while (Date.now() < deadline) {
    await sleep(config.poll_interval * 1000);
    if (Date.now() >= deadline) break;

    const inboxReply = await readAndConsumeInbox(inboxPath);
    if (inboxReply !== undefined) {
      opts.output?.status(opts.nodeId, "received local HITL reply (inbox)");
      return inboxReply;
    }

    opts.output?.status(
      opts.nodeId,
      `WAITING for human reply (${
        Math.round((Date.now() - started) / 1000)
      }s elapsed)`,
    );

    const checkResult = await runner(
      config.check_script,
      buildScriptArgs(
        "check",
        opts.runDir,
        ctx.run_id,
        opts.nodeId,
        config,
        ctx,
      ),
    );
    if (checkResult.exitCode === 0 && checkResult.stdout.trim()) {
      return checkResult.stdout.trim();
    }
  }

  return undefined;
}

/** Resolve an option number, persist the artifacts, apply `abort_on`. */
async function recordReply(
  node: NodeConfig,
  ctx: TemplateContext,
  question: HitlQuestion,
  rawReply: string,
): Promise<HitlNodeResult> {
  let response = rawReply;
  if (node.options && node.options.length > 0) {
    const idx = parseInt(rawReply, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= node.options.length) {
      response = node.options[idx - 1];
    }
  }

  const nodeDir = workPath(ctx.workDir, ctx.node_dir);
  await Deno.mkdir(nodeDir, { recursive: true });
  await Deno.writeTextFile(`${nodeDir}/response.txt`, `${response}\n`);
  await appendHitlAuditRecord(nodeDir, question, response);

  const aborted = (node.abort_on ?? []).includes(response);
  return {
    success: !aborted,
    response,
    aborted,
    ...(aborted
      ? {
        error: `Aborted by human (response: ${response})`,
        error_category: "aborted" as ErrorCategory,
      }
      : {}),
  };
}

function failure(error: string, category: ErrorCategory): HitlNodeResult {
  return {
    success: false,
    response: "",
    aborted: false,
    error,
    error_category: category,
  };
}
