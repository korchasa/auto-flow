/**
 * @module
 * A node's answer (FR-E96): the one piece of output a node hands back that is
 * not a file it chose to write.
 *
 * For an agent it is the final message, for a command its stdout, and for
 * either it is the `after` hook's stdout when the node declares one — which is
 * how a branch that edits code returns its patch (`git add -A -N . && git
 * diff`) instead of a verdict. The engine never parses it: a verdict and a
 * unified diff travel the same way, and what to do with either is the join
 * node's business.
 * Entry points: {@link persistAnswer}, {@link readAnswer}.
 */

import type { TemplateContext } from "../types.ts";
import { workPath } from "../state/state.ts";

/** File a node's answer is stored under, inside its artifact directory. */
export const ANSWER_FILE = ".answer";

/**
 * Write a node's answer beside its artifacts.
 *
 * A file rather than a field of `state.json`: an answer can be a whole patch,
 * and the run state is read back on every resume.
 */
export async function persistAnswer(
  ctx: TemplateContext,
  answer: string,
): Promise<void> {
  const dir = workPath(ctx.workDir, ctx.node_dir);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/${ANSWER_FILE}`, answer);
}

/** Read a node's answer from its artifact directory, or undefined if it left none. */
export async function readAnswer(
  nodeDir: string,
): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(`${nodeDir}/${ANSWER_FILE}`);
  } catch {
    return undefined;
  }
}
