/**
 * @module
 * Command node execution (FR-E88): run a shell command as a first-class DAG
 * node, persist its streams as artifacts, and map its exit code onto the
 * engine's node-failure vocabulary.
 * Entry point: {@link runCommandNode}.
 */

import type {
  ErrorCategory,
  NodeConfig,
  ResolvedNodeSettings,
  TemplateContext,
} from "../types.ts";
import { interpolate } from "../config/template.ts";
import { workPath } from "../state/state.ts";

/** Outcome of one command-node execution. */
export interface CommandNodeResult {
  /** True when the command exited 0. */
  success: boolean;
  /** Exit code; -1 when the command was killed by the timeout. */
  code: number;
  /** Captured stdout. */
  stdout: string;
  /** Captured stderr. */
  stderr: string;
  /** The command after template interpolation — what actually ran. */
  resolved: string;
  /** Failure description; absent on success. */
  error?: string;
  /** Engine-vocabulary failure category; absent on success. */
  error_category?: ErrorCategory;
}

/** Truncate captured output for an error message without hiding the cause. */
function tail(text: string, limit = 400): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `…${trimmed.slice(-limit)}`;
}

/**
 * Execute a `type: command` node.
 *
 * The command is interpolated first, so an unresolved variable throws here
 * rather than reaching the shell as literal `{{…}}` text and failing with a
 * confusing syntax error several layers down.
 *
 * Streams are always persisted — including on failure, which is precisely when
 * an operator needs them — as `stdout.txt`, `stderr.txt` and `exit_code.txt`
 * under the node's artifact directory.
 *
 * @param cwd working directory; the run's worktree when isolation is on.
 */
export async function runCommandNode(
  node: NodeConfig,
  ctx: TemplateContext,
  settings: ResolvedNodeSettings,
  cwd?: string,
): Promise<CommandNodeResult> {
  if (node.type !== "command") {
    throw new Error(`Node is not a command node (type: ${node.type})`);
  }
  if (!node.command) {
    throw new Error("Command node has no 'command' field");
  }

  const resolved = interpolate(node.command, ctx, cwd ?? ctx.workDir);

  const controller = new AbortController();
  let timedOut = false;
  const timeoutSeconds = settings.timeout_seconds;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutSeconds * 1000);

  let code: number;
  let stdout = "";
  let stderr = "";
  try {
    const output = await new Deno.Command("bash", {
      args: ["-c", resolved],
      cwd: cwd ?? Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
      signal: controller.signal,
    }).output();
    code = output.code;
    stdout = new TextDecoder().decode(output.stdout);
    stderr = new TextDecoder().decode(output.stderr);
  } catch (err) {
    // An aborted subprocess surfaces as a rejection on some platforms and as
    // a signalled exit on others; normalise both onto the timeout result.
    if (!timedOut) throw err;
    code = -1;
  } finally {
    clearTimeout(timer);
  }

  await persistStreams(ctx, stdout, stderr, code);

  if (timedOut) {
    return {
      success: false,
      code: -1,
      stdout,
      stderr,
      resolved,
      error: `Command timed out after ${timeoutSeconds}s: ${resolved}${
        stderr.trim() ? `\n${tail(stderr)}` : ""
      }`,
      error_category: "timeout",
    };
  }

  if (code !== 0) {
    return {
      success: false,
      code,
      stdout,
      stderr,
      resolved,
      error: `Command failed with exit ${code}: ${resolved}${
        stderr.trim() ? `\n${tail(stderr)}` : ""
      }`,
      error_category: "command_failed",
    };
  }

  return { success: true, code, stdout, stderr, resolved };
}

/** Write the command's streams and exit code into the node's artifact dir. */
async function persistStreams(
  ctx: TemplateContext,
  stdout: string,
  stderr: string,
  code: number,
): Promise<void> {
  // ctx.node_dir is workDir-relative (see TemplateContext); reconstruct a
  // cwd-correct path before touching the filesystem. Deliberately keyed on
  // ctx.workDir rather than the subprocess cwd: the artifact contract is
  // defined against workDir, and the two coincide in the engine anyway.
  const nodeDir = workPath(ctx.workDir, ctx.node_dir);
  await Deno.mkdir(nodeDir, { recursive: true });
  await Deno.writeTextFile(`${nodeDir}/stdout.txt`, stdout);
  await Deno.writeTextFile(`${nodeDir}/stderr.txt`, stderr);
  await Deno.writeTextFile(`${nodeDir}/exit_code.txt`, `${code}\n`);
}
