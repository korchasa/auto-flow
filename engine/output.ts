import type { ClaudeCliOutput, Verbosity } from "./types.ts";

/** Input artifact descriptor for verbose output. */
export interface VerboseInput {
  path: string;
  sizeBytes: number;
}

/** Validation result descriptor for verbose output. */
export interface VerboseValidationResult {
  rule: string;
  passed: boolean;
  detail?: string;
}

/** Terminal output manager with configurable verbosity levels. */
export class OutputManager {
  private verbosity: Verbosity;
  private encoder = new TextEncoder();
  private customWriter?: (text: string) => void;

  constructor(
    verbosity: Verbosity = "normal",
    writer?: (text: string) => void,
  ) {
    this.verbosity = verbosity;
    this.customWriter = writer;
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
  loopIteration(
    nodeId: string,
    iteration: number,
    maxIterations: number,
  ): void {
    this.status(nodeId, `ITERATION ${iteration}/${maxIterations}`);
  }

  /** Expose verbosity level for callers that need to thread it downstream. */
  get verbosityLevel(): Verbosity {
    return this.verbosity;
  }

  /** Log streaming output from a node (verbose and semi-verbose). */
  nodeOutput(nodeId: string, line: string): void {
    if (this.verbosity !== "verbose" && this.verbosity !== "semi-verbose") {
      return;
    }
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

  // --- Verbose methods (no-op when verbosity !== "verbose") ---

  /** Show the full interpolated prompt sent to an agent. */
  verbosePrompt(nodeId: string, prompt: string): void {
    if (this.verbosity !== "verbose") return;
    this.write(`── ${nodeId}: PROMPT ──\n`);
    this.write(`${prompt}\n`);
    this.write(`── end prompt ──\n`);
  }

  /** Show resolved input artifacts with file paths and sizes. */
  verboseInputs(nodeId: string, inputs: VerboseInput[]): void {
    if (this.verbosity !== "verbose") return;
    this.write(`── ${nodeId}: INPUTS (${inputs.length} files) ──\n`);
    for (const input of inputs) {
      this.write(`  ${input.path} (${input.sizeBytes} bytes)\n`);
    }
  }

  /** Show validation rule results (pass/fail per rule). */
  verboseValidation(
    nodeId: string,
    results: VerboseValidationResult[],
  ): void {
    if (this.verbosity !== "verbose") return;
    this.write(`── ${nodeId}: VALIDATION ──\n`);
    for (const r of results) {
      const status = r.passed ? "PASS" : "FAIL";
      const detail = r.detail ? ` — ${r.detail}` : "";
      this.write(`  [${status}] ${r.rule}${detail}\n`);
    }
  }

  /** Show continuation trigger context. */
  verboseContinuation(
    nodeId: string,
    attempt: number,
    max: number,
    failures: string[],
  ): void {
    if (this.verbosity !== "verbose") return;
    this.write(`── ${nodeId}: CONTINUATION ${attempt}/${max} ──\n`);
    for (const f of failures) {
      this.write(`  ${f}\n`);
    }
  }

  /** Show one-line agent result summary after node completion (FR-30). Suppressed in quiet mode. */
  nodeResult(nodeId: string, output: ClaudeCliOutput): void {
    if (this.verbosity === "quiet") return;
    const firstLine = (output.result ?? "").split("\n")[0].slice(0, 120);
    const cost = output.total_cost_usd.toFixed(4);
    const durationS = Math.round(output.duration_ms / 1000);
    this.status(
      nodeId,
      `  RESULT: ${firstLine} | cost=$${cost} | duration=${durationS}s | turns=${output.num_turns}`,
    );
  }

  /** Print the dry-run execution plan. */
  dryRunPlan(
    levels: string[][],
    labels: Record<string, string>,
    postPipelineNodeIds?: string[],
    runOnMap?: Record<string, string>,
  ): void {
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
    if (postPipelineNodeIds && postPipelineNodeIds.length > 0) {
      this.write(`Post-pipeline:\n`);
      for (const nodeId of postPipelineNodeIds) {
        const label = labels[nodeId] ?? nodeId;
        const condition = runOnMap?.[nodeId] ?? "always";
        this.write(`  - ${nodeId}: ${label} (run_on: ${condition})\n`);
      }
    }
    this.write(`${"─".repeat(40)}\n`);
  }

  private timestamp(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${
      pad(now.getSeconds())
    }`;
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
    if (this.customWriter) {
      this.customWriter(text);
    } else {
      Deno.stderr.writeSync(this.encoder.encode(text));
    }
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
