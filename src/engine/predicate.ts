/**
 * @module
 * Shell predicates used as control flow: loop exit (`until`, FR-E87) and
 * conditional node execution (`when`, FR-E89).
 * Entry point: {@link evaluateShellPredicate}.
 */

import type { TemplateContext } from "../types.ts";
import { interpolate } from "../config/template.ts";

/** Outcome of one shell-predicate evaluation. */
export interface ShellPredicateResult {
  /** True when the predicate exited 0. */
  satisfied: boolean;
  /** Raw exit code, surfaced in diagnostics. */
  code: number;
  /** Captured stderr, so a broken predicate names itself in the failure. */
  stderr: string;
}

/**
 * Interpolate a predicate and run it through `bash -c`.
 *
 * Exit 0 is the only "yes"; every other code is a "no". Interpolation happens
 * first, so the predicate sees the same variable surface as a prompt, and an
 * unresolvable variable throws instead of degrading into a predicate that can
 * never match.
 *
 * @param cwd working directory — the run's worktree when isolation is on,
 *   otherwise the engine CWD.
 */
export async function evaluateShellPredicate(
  command: string,
  ctx: TemplateContext,
  cwd?: string,
): Promise<ShellPredicateResult> {
  const resolved = interpolate(command, ctx, cwd ?? ctx.workDir);
  const output = await new Deno.Command("bash", {
    args: ["-c", resolved],
    cwd: cwd ?? Deno.cwd(),
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    satisfied: output.code === 0,
    code: output.code,
    stderr: new TextDecoder().decode(output.stderr),
  };
}
