import type {
  ClaudeCliOutput,
  NodeConfig,
  NodeSettings,
  TemplateContext,
  ValidationRule,
} from "./types.ts";
import { interpolate } from "./template.ts";
import {
  allPassed,
  formatFailures,
  runValidations,
} from "./validate.ts";

/** Result of an agent node execution. */
export interface AgentResult {
  success: boolean;
  session_id?: string;
  output?: ClaudeCliOutput;
  continuations: number;
  error?: string;
}

/** Options for running an agent. */
export interface AgentRunOptions {
  node: NodeConfig;
  ctx: TemplateContext;
  settings: Required<NodeSettings>;
  onOutput?: (line: string) => void;
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
  const { node, ctx, settings, onOutput } = opts;

  // Run before hook
  if (node.before) {
    const hookCmd = interpolate(node.before, ctx);
    await runShellCommand(hookCmd, "before hook");
  }

  // Build task prompt
  const taskPrompt = node.task_template
    ? interpolate(node.task_template, ctx)
    : "";

  // Initial invocation
  let result = await invokeClaudeCli({
    promptFile: node.prompt ? interpolate(node.prompt, ctx) : undefined,
    taskPrompt,
    timeoutSeconds: settings.timeout_seconds,
    maxRetries: settings.max_retries,
    retryDelaySeconds: settings.retry_delay_seconds,
    onOutput,
  });

  let continuations = 0;
  const validationRules = node.validate ?? [];

  // Continuation loop
  while (validationRules.length > 0) {
    const validationResults = await runValidations(validationRules, ctx);
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
        error: `Continuation limit (${settings.max_continuations}) reached. Failures:\n${failures}`,
      };
    }

    continuations++;
    const failures = formatFailures(validationResults);
    const resumePrompt =
      `Validation failed (continuation ${continuations}/${settings.max_continuations}):\n${failures}\nFix the issues.`;

    if (!result.output?.session_id) {
      return {
        success: false,
        output: result.output,
        continuations,
        error: "No session_id available for --resume continuation",
      };
    }

    result = await invokeClaudeCli({
      resumeSessionId: result.output.session_id,
      taskPrompt: resumePrompt,
      timeoutSeconds: settings.timeout_seconds,
      maxRetries: settings.max_retries,
      retryDelaySeconds: settings.retry_delay_seconds,
      onOutput,
    });
  }

  if (result.error) {
    return {
      success: false,
      session_id: result.output?.session_id,
      output: result.output,
      continuations,
      error: result.error,
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
      };
    }
  }

  return {
    success: true,
    session_id: result.output?.session_id,
    output: result.output,
    continuations,
  };
}

// --- Internal helpers ---

interface InvokeOptions {
  promptFile?: string;
  taskPrompt: string;
  resumeSessionId?: string;
  timeoutSeconds: number;
  maxRetries: number;
  retryDelaySeconds: number;
  onOutput?: (line: string) => void;
}

interface InvokeResult {
  output?: ClaudeCliOutput;
  error?: string;
}

/** Invoke claude CLI with retry logic. */
async function invokeClaudeCli(opts: InvokeOptions): Promise<InvokeResult> {
  const args = buildClaudeArgs(opts);
  let lastError = "";

  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    try {
      const output = await executeClaudeProcess(args, opts.timeoutSeconds, opts.onOutput);
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

  return { error: `Claude CLI failed after ${opts.maxRetries} attempts: ${lastError}` };
}

function buildClaudeArgs(opts: InvokeOptions): string[] {
  const args: string[] = [];

  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  }

  args.push("-p", opts.taskPrompt);

  if (opts.promptFile && !opts.resumeSessionId) {
    args.push("--append-system-prompt-file", opts.promptFile);
  }

  args.push("--output-format", "json");

  return args;
}

/** Execute the claude CLI process and capture JSON output. */
async function executeClaudeProcess(
  args: string[],
  timeoutSeconds: number,
  onOutput?: (line: string) => void,
): Promise<ClaudeCliOutput> {
  const cmd = new Deno.Command("claude", {
    args,
    stdout: "piped",
    stderr: "piped",
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

  // Read stderr for streaming output
  if (onOutput) {
    const stderrReader = process.stderr.getReader();
    const decoder = new TextDecoder();
    (async () => {
      try {
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split("\n").filter(Boolean)) {
            onOutput(line);
          }
        }
      } catch {
        // Stream closed
      }
    })();
  }

  const output = await process.output();
  clearTimeout(timeoutId);

  const stdout = new TextDecoder().decode(output.stdout).trim();

  if (!output.success && !stdout) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(
      `Claude CLI exited with code ${output.code}${stderr ? `: ${stderr}` : ""}`,
    );
  }

  try {
    return JSON.parse(stdout) as ClaudeCliOutput;
  } catch {
    throw new Error(
      `Failed to parse Claude CLI JSON output: ${stdout.substring(0, 200)}`,
    );
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
    throw new Error(`${label} failed: ${command}${stderr ? `\n${stderr}` : ""}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
