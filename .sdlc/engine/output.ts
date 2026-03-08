import type { Verbosity } from "./types.ts";

/** Terminal output manager with configurable verbosity levels. */
export class OutputManager {
  private verbosity: Verbosity;
  private encoder = new TextEncoder();

  constructor(verbosity: Verbosity = "normal") {
    this.verbosity = verbosity;
  }

  /** Log a status line (shown in normal and verbose modes). */
  status(nodeId: string, message: string): void {
    if (this.verbosity === "quiet") return;
    const time = this.timestamp();
    const paddedId = nodeId.padEnd(16);
    this.write(`[${time}] ${paddedId}${message}\n`);
  }

  /** Log a node start event. */
  nodeStarted(nodeId: string, extra?: string): void {
    const suffix = extra ? ` (${extra})` : "";
    this.status(nodeId, `STARTED${suffix}`);
  }

  /** Log a node completion event. */
  nodeCompleted(nodeId: string, durationMs: number, extra?: string): void {
    const duration = this.formatDuration(durationMs);
    const suffix = extra ? `, ${extra}` : "";
    this.status(nodeId, `COMPLETED (${duration}${suffix})`);
  }

  /** Log a node failure event. */
  nodeFailed(nodeId: string, error: string): void {
    const time = this.timestamp();
    const paddedId = nodeId.padEnd(16);
    // Always show failures, even in quiet mode
    this.write(`[${time}] ${paddedId}FAILED: ${error}\n`);
  }

  /** Log a node skip event. */
  nodeSkipped(nodeId: string, reason: string): void {
    this.status(nodeId, `SKIPPED (${reason})`);
  }

  /** Log a loop iteration event. */
  loopIteration(nodeId: string, iteration: number, maxIterations: number): void {
    this.status(nodeId, `ITERATION ${iteration}/${maxIterations}`);
  }

  /** Log streaming output from a node (verbose only). */
  nodeOutput(nodeId: string, line: string): void {
    if (this.verbosity !== "verbose") return;
    const paddedId = `[${nodeId}]`.padEnd(18);
    this.write(`${paddedId} ${line}\n`);
  }

  /** Log an error message (always shown). */
  error(message: string): void {
    this.write(`ERROR: ${message}\n`);
  }

  /** Log a warning message (shown in normal and verbose). */
  warn(message: string): void {
    if (this.verbosity === "quiet") return;
    this.write(`WARN: ${message}\n`);
  }

  /** Print a summary at the end of a run. */
  summary(stats: RunSummary): void {
    this.write("\n");
    this.write(`${"=".repeat(60)}\n`);
    this.write(`Pipeline: ${stats.name}\n`);
    this.write(`Run ID:   ${stats.runId}\n`);
    this.write(`Status:   ${stats.status}\n`);
    this.write(`Duration: ${this.formatDuration(stats.durationMs)}\n`);
    this.write(`Nodes:    ${stats.completed}/${stats.total} completed`);
    if (stats.failed > 0) this.write(`, ${stats.failed} failed`);
    if (stats.skipped > 0) this.write(`, ${stats.skipped} skipped`);
    this.write("\n");
    this.write(`${"=".repeat(60)}\n`);
  }

  /** Print the dry-run execution plan. */
  dryRunPlan(levels: string[][], labels: Record<string, string>): void {
    this.write("\nExecution Plan (dry run):\n");
    this.write(`${"─".repeat(40)}\n`);
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const parallel = level.length > 1 ? " (parallel)" : "";
      this.write(`Level ${i + 1}${parallel}:\n`);
      for (const nodeId of level) {
        const label = labels[nodeId] ?? nodeId;
        this.write(`  - ${nodeId}: ${label}\n`);
      }
    }
    this.write(`${"─".repeat(40)}\n`);
  }

  private timestamp(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m${remainingSeconds > 0 ? `${remainingSeconds}s` : ""}`;
  }

  private write(text: string): void {
    Deno.stderr.writeSync(this.encoder.encode(text));
  }
}

/** Summary statistics for a pipeline run. */
export interface RunSummary {
  name: string;
  runId: string;
  status: string;
  durationMs: number;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
}
