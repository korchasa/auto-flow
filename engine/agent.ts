import type {
  ClaudeCliOutput,
  ErrorCategory,
  NodeConfig,
  NodeSettings,
  PermissionDenial,
  TemplateContext,
  Verbosity,
} from "./types.ts";
import { interpolate } from "./template.ts";
import {
  allPassed,
  formatFailures,
  runValidations,
  type ValidationResult,
} from "./validate.ts";
import type { OutputManager } from "./output.ts";

/** Result of an agent node execution. */
export interface AgentResult {
  success: boolean;
  session_id?: string;
  output?: ClaudeCliOutput;
  continuations: number;
  error?: string;
  error_category?: ErrorCategory;
  permission_denials?: PermissionDenial[];
}

/** Options for running an agent. */
export interface AgentRunOptions {
  node: NodeConfig;
  ctx: TemplateContext;
  settings: Required<NodeSettings>;
  claudeArgs?: string[];
  /** Claude model override (e.g. "claude-sonnet-4-6"). Omit = CLI default. */
  model?: string;
  /** OutputManager for verbose diagnostics. */
  output?: OutputManager;
  /** Node ID for verbose output tagging. */
  nodeId?: string;
  /** Path to write real-time stream-json log file. */
  streamLogPath?: string;
  /** Verbosity level for terminal output filtering. */
  verbosity?: Verbosity;
}

/**
 * Execute an agent node: invoke Claude CLI, validate output, continue on failure.
 *
 * Flow:
 * 1. Run `before` hook if configured
 * 2. Invoke `claude` CLI with prompt + task template
 * 3. Validate output artifacts
 * 4. If validation fails and continuations remain, resume with `--resume`
 * 5. Run `after` hook if configured
 */
export async function runAgent(opts: AgentRunOptions): Promise<AgentResult> {
  const {
    node,
    ctx,
    settings,
    claudeArgs,
    model,
    output,
    nodeId,
    streamLogPath,
    verbosity,
  } = opts;

  // Derive onOutput callback from OutputManager
  const onOutput = output && nodeId
    ? (line: string) => output.nodeOutput(nodeId, line)
    : undefined;

  // Run before hook
  if (node.before) {
    const hookCmd = interpolate(node.before, ctx);
    await runShellCommand(hookCmd, "before hook");
  }

  // Build task prompt
  const taskPrompt = node.task_template
    ? interpolate(node.task_template, ctx)
    : "";

  // Verbose: show interpolated prompt
  if (output && nodeId) {
    output.verbosePrompt(nodeId, taskPrompt);
  }

  // Initial invocation
  let result = await invokeClaudeCli({
    promptFile: node.prompt ? interpolate(node.prompt, ctx) : undefined,
    promptContent: node.prompt_content,
    taskPrompt,
    claudeArgs,
    model,
    timeoutSeconds: settings.timeout_seconds,
    maxRetries: settings.max_retries,
    retryDelaySeconds: settings.retry_delay_seconds,
    onOutput,
    streamLogPath,
    verbosity,
  });

  let continuations = 0;
  const validationRules = node.validate ?? [];

  // Fail fast if initial invocation returned no output at all
  if (result.error && !result.output) {
    return {
      success: false,
      continuations,
      error: result.error,
      error_category: "cli_crash",
    };
  }

  // Continuation loop
  while (validationRules.length > 0) {
    const validationResults = await runValidations(validationRules, ctx);

    // Verbose: show validation results
    if (output && nodeId) {
      output.verboseValidation(
        nodeId,
        toVerboseValidation(validationResults),
      );
    }

    if (allPassed(validationResults)) {
      break;
    }

    if (continuations >= settings.max_continuations) {
      const failures = formatFailures(validationResults);
      return {
        success: false,
        session_id: result.output?.session_id,
        output: result.output,
        continuations,
        error:
          `Continuation limit (${settings.max_continuations}) reached. Failures:\n${failures}`,
        error_category: "continuations_exhausted",
      };
    }

    continuations++;
    const failures = formatFailures(validationResults);

    // Verbose: show continuation context
    if (output && nodeId) {
      output.verboseContinuation(
        nodeId,
        continuations,
        settings.max_continuations,
        validationResults.filter((r) => !r.passed).map((r) =>
          `${r.rule.type}: ${r.message}`
        ),
      );
    }

    const resumePrompt =
      `Validation failed (continuation ${continuations}/${settings.max_continuations}):\n${failures}\nFix the issues.`;

    if (!result.output?.session_id) {
      return {
        success: false,
        output: result.output,
        continuations,
        error: "No session_id available for --resume continuation",
        error_category: "unknown",
      };
    }

    result = await invokeClaudeCli({
      resumeSessionId: result.output.session_id,
      taskPrompt: resumePrompt,
      claudeArgs,
      model,
      timeoutSeconds: settings.timeout_seconds,
      maxRetries: settings.max_retries,
      retryDelaySeconds: settings.retry_delay_seconds,
      onOutput,
      streamLogPath,
      verbosity,
    });
  }

  if (result.error) {
    return {
      success: false,
      session_id: result.output?.session_id,
      output: result.output,
      continuations,
      error: result.error,
      error_category: "cli_crash",
    };
  }

  // Run after hook
  if (node.after) {
    const hookCmd = interpolate(node.after, ctx);
    try {
      await runShellCommand(hookCmd, "after hook");
    } catch (err) {
      return {
        success: false,
        session_id: result.output?.session_id,
        output: result.output,
        continuations,
        error: `After hook failed: ${(err as Error).message}`,
        error_category: "hook_failure",
      };
    }
  }

  return {
    success: true,
    session_id: result.output?.session_id,
    output: result.output,
    continuations,
    permission_denials: result.output?.permission_denials,
  };
}

// --- Internal helpers ---

export interface InvokeOptions {
  promptFile?: string;
  /** Cached prompt content (takes priority over promptFile). */
  promptContent?: string;
  taskPrompt: string;
  resumeSessionId?: string;
  claudeArgs?: string[];
  /** Claude model override. Skipped on resume (session inherits model). */
  model?: string;
  timeoutSeconds: number;
  maxRetries: number;
  retryDelaySeconds: number;
  onOutput?: (line: string) => void;
  /** Path to write real-time stream-json log file. */
  streamLogPath?: string;
  /** Verbosity level for terminal output filtering (semi-verbose suppresses tool_use). */
  verbosity?: Verbosity;
}

interface InvokeResult {
  output?: ClaudeCliOutput;
  error?: string;
}

/** Invoke claude CLI with retry logic. */
export async function invokeClaudeCli(
  opts: InvokeOptions,
): Promise<InvokeResult> {
  const args = buildClaudeArgs(opts);
  let lastError = "";

  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    try {
      const output = await executeClaudeProcess(
        args,
        opts.timeoutSeconds,
        opts.onOutput,
        opts.streamLogPath,
        opts.verbosity,
      );
      if (output.is_error) {
        lastError = `Claude CLI returned error: ${output.result}`;
        if (attempt < opts.maxRetries) {
          const delay = opts.retryDelaySeconds * Math.pow(2, attempt - 1);
          await sleep(delay * 1000);
          continue;
        }
        return { output, error: lastError };
      }
      return { output };
    } catch (err) {
      lastError = (err as Error).message;
      if (attempt < opts.maxRetries) {
        const delay = opts.retryDelaySeconds * Math.pow(2, attempt - 1);
        await sleep(delay * 1000);
        continue;
      }
    }
  }

  return {
    error: `Claude CLI failed after ${opts.maxRetries} attempts: ${lastError}`,
  };
}

/** Build CLI arguments for the claude command. Exported for testing. */
export function buildClaudeArgs(opts: InvokeOptions): string[] {
  const args: string[] = [];

  // Extra CLI args (e.g. --dangerously-skip-permissions) go first
  if (opts.claudeArgs && opts.claudeArgs.length > 0) {
    args.push(...opts.claudeArgs);
  }

  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  }

  args.push("-p", opts.taskPrompt);

  if (!opts.resumeSessionId) {
    if (opts.promptContent) {
      args.push("--append-system-prompt", opts.promptContent);
    } else if (opts.promptFile) {
      args.push("--append-system-prompt-file", opts.promptFile);
    }
  }

  if (opts.model && !opts.resumeSessionId) {
    args.push("--model", opts.model);
  }

  args.push("--output-format", "stream-json", "--verbose");

  return args;
}

/**
 * Tracks per-path file read counts within a single agent invocation.
 * Returns a warning string when a path is read more than `threshold` times.
 * Pure-logic class — unit-testable without I/O.
 */
export class FileReadTracker {
  private counts = new Map<string, number>();

  constructor(private readonly threshold = 2) {}

  /**
   * Increment read count for path.
   * Returns `[WARN] repeated file read: <path> (<N> times)` when count > threshold, else null.
   */
  track(path: string): string | null {
    const count = (this.counts.get(path) ?? 0) + 1;
    this.counts.set(path, count);
    if (count > this.threshold) {
      return `[WARN] repeated file read: ${path} (${count} times)`;
    }
    return null;
  }

  /** Clear all counts (for testing isolation). */
  reset(): void {
    this.counts.clear();
  }
}

/**
 * Execute the claude CLI process with stream-json output.
 * Processes NDJSON events in real-time: writes readable formatted summaries
 * to streamLogPath (full, unfiltered), forwards filtered summaries to onOutput
 * (tool_use suppressed when verbosity=semi-verbose), and extracts ClaudeCliOutput
 * from the final "result" event.
 */
async function executeClaudeProcess(
  args: string[],
  timeoutSeconds: number,
  onOutput?: (line: string) => void,
  streamLogPath?: string,
  verbosity?: Verbosity,
): Promise<ClaudeCliOutput> {
  // Unset CLAUDECODE to allow nested claude CLI invocations.
  // Claude Code checks this variable and refuses to launch inside another session.
  // Deno.Command merges env with parent, so setting empty string overrides it.
  const cmd = new Deno.Command("claude", {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { CLAUDECODE: "" },
  });

  const process = cmd.spawn();

  // Set up timeout
  const timeoutId = setTimeout(() => {
    try {
      process.kill("SIGTERM");
    } catch {
      // Process may have already exited
    }
  }, timeoutSeconds * 1000);

  // Open stream log file for real-time writing (append mode)
  let logFile: Deno.FsFile | undefined;
  if (streamLogPath) {
    const dir = streamLogPath.replace(/\/[^/]+$/, "");
    await Deno.mkdir(dir, { recursive: true });
    logFile = await Deno.open(streamLogPath, {
      write: true,
      create: true,
      append: true,
    });
  }

  // Process stdout as stream-json NDJSON
  let resultEvent: ClaudeCliOutput | undefined;
  const stdoutDecoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let turnCount = 0;
  const tracker = new FileReadTracker();

  const stdoutReader = process.stdout.getReader();
  const stdoutDone = (async () => {
    try {
      while (true) {
        const { done, value } = await stdoutReader.read();
        if (done) break;
        buffer += stdoutDecoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          // Parse and extract result event
          try {
            // deno-lint-ignore no-explicit-any
            const event = JSON.parse(line) as Record<string, any>;
            if (event.type === "assistant" && logFile) {
              turnCount++;
              await logFile.write(
                encoder.encode(stampLines(`--- turn ${turnCount} ---`) + "\n"),
              );
              // Track repeated file reads
              const contents = event.message?.content;
              if (Array.isArray(contents)) {
                for (const block of contents) {
                  if (block.type === "tool_use" && block.name === "Read") {
                    const warn = tracker.track(block.input?.file_path);
                    if (warn) {
                      await logFile.write(
                        encoder.encode(stampLines(warn) + "\n"),
                      );
                    }
                  }
                }
              }
            }
            if (event.type === "result") {
              resultEvent = extractClaudeOutput(event);
            }
            // Write full unfiltered summary to log file
            const logSummary = formatEventForOutput(event);
            if (logFile && logSummary) {
              await logFile.write(
                encoder.encode(stampLines(logSummary) + "\n"),
              );
            }
            if (event.type === "result" && resultEvent && logFile) {
              await logFile.write(
                encoder.encode(stampLines("--- end ---") + "\n"),
              );
              await logFile.write(
                encoder.encode(stampLines(formatFooter(resultEvent)) + "\n"),
              );
            }
            // Forward verbosity-filtered summary to terminal
            if (onOutput) {
              const termSummary = formatEventForOutput(event, verbosity);
              if (termSummary) onOutput(termSummary);
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
      // Process remaining buffer
      if (buffer.trim()) {
        try {
          // deno-lint-ignore no-explicit-any
          const event = JSON.parse(buffer) as Record<string, any>;
          if (event.type === "assistant" && logFile) {
            turnCount++;
            await logFile.write(
              encoder.encode(stampLines(`--- turn ${turnCount} ---`) + "\n"),
            );
            // Track repeated file reads
            const contents = event.message?.content;
            if (Array.isArray(contents)) {
              for (const block of contents) {
                if (block.type === "tool_use" && block.name === "Read") {
                  const warn = tracker.track(block.input?.file_path);
                  if (warn) {
                    await logFile.write(
                      encoder.encode(stampLines(warn) + "\n"),
                    );
                  }
                }
              }
            }
          }
          if (event.type === "result") {
            resultEvent = extractClaudeOutput(event);
          }
          const logSummary = formatEventForOutput(event);
          if (logFile && logSummary) {
            await logFile.write(encoder.encode(stampLines(logSummary) + "\n"));
          }
          if (event.type === "result" && resultEvent && logFile) {
            await logFile.write(
              encoder.encode(stampLines("--- end ---") + "\n"),
            );
            await logFile.write(
              encoder.encode(stampLines(formatFooter(resultEvent)) + "\n"),
            );
          }
          if (onOutput) {
            const termSummary = formatEventForOutput(event, verbosity);
            if (termSummary) onOutput(termSummary);
          }
        } catch { /* skip */ }
      }
    } catch { /* stream closed */ }
  })();

  // Collect stderr for error reporting
  const stderrChunks: Uint8Array[] = [];
  const stderrReader = process.stderr.getReader();
  const stderrDone = (async () => {
    try {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        stderrChunks.push(value);
      }
    } catch { /* stream closed */ }
  })();

  await Promise.all([stdoutDone, stderrDone]);
  const status = await process.status;
  clearTimeout(timeoutId);

  // Close log file
  if (logFile) {
    logFile.close();
  }

  const concat = (chunks: Uint8Array[]) => {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.length;
    }
    return buf;
  };
  const stderr = new TextDecoder().decode(concat(stderrChunks)).trim();

  if (resultEvent) {
    return resultEvent;
  }

  if (!status.success) {
    throw new Error(
      `Claude CLI exited with code ${status.code}${
        stderr ? `: ${stderr}` : ""
      }`,
    );
  }

  throw new Error(
    "Claude CLI stream-json output contained no result event",
  );
}

/** Extract ClaudeCliOutput fields from a stream-json result event. */
export function extractClaudeOutput(
  // deno-lint-ignore no-explicit-any
  event: Record<string, any>,
): ClaudeCliOutput {
  return {
    result: event.result ?? "",
    session_id: event.session_id ?? "",
    total_cost_usd: event.total_cost_usd ?? 0,
    duration_ms: event.duration_ms ?? 0,
    duration_api_ms: event.duration_api_ms ?? 0,
    num_turns: event.num_turns ?? 0,
    is_error: event.is_error ?? event.subtype !== "success",
    permission_denials: event.permission_denials,
  };
}

/** Shorten an absolute path by stripping common workspace prefixes. */
function shortenPath(p: string): string {
  return p.replace(/^\/workspaces\/[^/]+\//, "").replace(
    /^\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/[^/]+\//,
    "",
  );
}

const MAX_CMD_LEN = 80;

/** Extract a human-readable detail string from a tool_use input. */
// deno-lint-ignore no-explicit-any
function formatToolDetail(name: string, input?: Record<string, any>): string {
  if (!input) return "";
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      return input.file_path ? shortenPath(input.file_path) : "";
    case "Bash":
      if (input.description) return input.description;
      if (input.command) {
        const cmd = input.command as string;
        return cmd.length > MAX_CMD_LEN
          ? `\`${cmd.slice(0, MAX_CMD_LEN)}…\``
          : `\`${cmd}\``;
      }
      return "";
    case "Grep":
      return [
        input.pattern ? `/${input.pattern}/` : "",
        input.path ? `in ${shortenPath(input.path)}` : "",
      ].filter(Boolean).join(" ");
    case "Glob":
      return input.pattern ?? "";
    case "Agent":
      return input.description ?? "";
    default:
      return "";
  }
}

/**
 * Format a stream event as a one-line summary for output.
 * When verbosity is "semi-verbose", tool_use blocks in assistant events are
 * suppressed — only text blocks are emitted. Default undefined = all blocks.
 * Log file writes call without verbosity to preserve full output.
 */
export function formatEventForOutput(
  // deno-lint-ignore no-explicit-any
  event: Record<string, any>,
  verbosity?: Verbosity,
): string {
  switch (event.type) {
    case "system":
      if (event.subtype === "init") {
        return `[stream] init model=${event.model ?? "?"}`;
      }
      return "";
    case "assistant": {
      const contents = event.message?.content;
      if (!Array.isArray(contents)) return "";
      const parts: string[] = [];
      for (const block of contents) {
        if (block.type === "text" && block.text) {
          const preview = block.text.length > 120
            ? block.text.slice(0, 120) + "…"
            : block.text;
          parts.push(`[stream] text: ${preview.replaceAll("\n", "↵")}`);
        } else if (block.type === "tool_use") {
          if (verbosity === "semi-verbose") continue;
          const detail = formatToolDetail(block.name, block.input);
          parts.push(
            detail
              ? `[stream] tool: ${block.name ?? "?"} ${detail}`
              : `[stream] tool: ${block.name ?? "?"}`,
          );
        }
      }
      return parts.join("\n");
    }
    case "result":
      return `[stream] result: ${event.subtype} (${
        event.duration_ms ?? 0
      }ms, $${(event.total_cost_usd ?? 0).toFixed(4)})`;
    default:
      return "";
  }
}

/** Run a shell command (for before/after hooks). */
async function runShellCommand(
  command: string,
  label: string,
): Promise<void> {
  const cmd = new Deno.Command("sh", {
    args: ["-c", command],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(
      `${label} failed: ${command}${stderr ? `\n${stderr}` : ""}`,
    );
  }
}

/** Convert ValidationResult[] to verbose format for output. */
function toVerboseValidation(
  results: ValidationResult[],
): { rule: string; passed: boolean; detail?: string }[] {
  return results.map((r) => ({
    rule: r.rule.type,
    passed: r.passed,
    detail: r.message,
  }));
}

/**
 * Format a one-line summary footer for a completed Claude CLI run.
 * Pure function — unit-testable without CLI.
 * Format: `status=<ok|error> duration=<X>s cost=$<Y> turns=<N>`
 */
export function formatFooter(output: ClaudeCliOutput): string {
  const status = output.is_error ? "error" : "ok";
  const duration = (output.duration_ms / 1000).toFixed(1);
  const cost = output.total_cost_usd.toFixed(4);
  return `status=${status} duration=${duration}s cost=$${cost} turns=${output.num_turns}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns current time as [HH:MM:SS] prefix string. */
export function tsPrefix(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `[${h}:${m}:${s}]`;
}

/**
 * Prepend timestamp to each non-empty line of text.
 * Empty lines pass through unchanged.
 */
export function stampLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line ? `${tsPrefix()} ${line}` : line)
    .join("\n");
}
