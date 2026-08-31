/**
 * @module
 * FR-E99: selection of the nodes that wait for the run's verdict, plus the
 * `on_failure_script` hook.
 *
 * These nodes used to have a scheduler of their own — its own topological
 * sort, its own completed-node check and its own error swallowing — which is
 * why `when` (FR-E89) was silently inert on them and why a completed node was
 * skipped on `--resume` whatever its `run_on` said. Scheduling now belongs to
 * `Engine.runNodes` and filtering to `Engine.gateNode`; what is left here is
 * the selection rule, so the engine, `--dry-run`, the dashboard and the
 * diagram all read one definition of "post-workflow node".
 */

import type { NodeConfig } from "../types.ts";
import type { OutputManager } from "../output.ts";

/**
 * Collect node IDs with `run_on` set from workflow config.
 * These nodes execute after the graph, once its outcome is known.
 */
export function collectPostWorkflowNodes(
  nodes: Record<string, NodeConfig>,
): string[] {
  return Object.entries(nodes)
    .filter(([_, node]) => node.run_on !== undefined)
    .map(([id]) => id);
}

/**
 * Execute the on_failure_script hook (domain-agnostic).
 * Swallows errors — failure hook must not crash the engine.
 */
export async function runFailureHook(
  script: string | undefined,
  output: OutputManager,
  cwd?: string,
): Promise<void> {
  if (!script) return;
  try {
    const cmd = new Deno.Command(script, {
      stdout: "piped",
      stderr: "piped",
      ...(cwd ? { cwd } : {}),
    });
    const result = await cmd.output();
    const stdout = new TextDecoder().decode(result.stdout).trim();
    const stderr = new TextDecoder().decode(result.stderr).trim();
    if (stdout) output.status("engine", `Hook stdout: ${stdout}`);
    if (stderr) output.warn(`Hook stderr: ${stderr}`);
    if (!result.success) {
      output.warn(`Failure hook exited with code ${result.code}`);
    } else {
      output.status("engine", "Failure hook completed");
    }
  } catch (err) {
    output.warn(`Failure hook error: ${(err as Error).message}`);
  }
}
