/**
 * @module
 * Agent node execution: invoke Claude CLI, validate output artifacts, and
 * continue on validation failure (continuation loop).
 * Entry point: {@link runAgent}.
 * Depends on {@link invokeClaudeCli} for the actual subprocess management and
 * {@link runValidations} for post-run artifact checks.
 */

import type {
  ClaudeCliOutput,
  ErrorCategory,
  NodeConfig,
  NodeSettings,
  PermissionDenial,
  TemplateContext,
  ValidationRule,
  Verbosity,
} from "./types.ts";
import { interpolate } from "./template.ts";
import {
  allPassed,
  formatFailures,
  runValidations,
  type ValidationResult,
} from "./validate.ts";
import type { OutputManager, VerboseInput } from "./output.ts";
import { invokeClaudeCli } from "./claude-process.ts";
import { findViolations, snapshotModifiedFiles } from "./scope-check.ts";

/**
 * Resolve input artifact file paths and sizes from input directories.
 * Walks each input directory (non-recursive), collects file path + size.
 */
export async function resolveInputArtifacts(
  inputs: Record<string, string>,
): Promise<VerboseInput[]> {
  const result: VerboseInput[] = [];
  for (const [_nodeId, dir] of Object.entries(inputs)) {
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile) continue;
        const filePath = `${dir}/${entry.name}`;
        try {
          const stat = await Deno.stat(filePath);
          result.push({ path: filePath, sizeBytes: stat.size });
        } catch {
          // File may have been removed between readDir and stat
        }
      }
    } catch {
      // Directory may not exist
    }
  }
  return result;
}

/** Result of an agent node execution. */
export interface AgentResult {
  /** Whether the agent completed successfully (all validations passed). */
  success: boolean;
  /** Claude CLI session ID for potential --resume continuation. */
  session_id?: string;
  /** Parsed CLI output including cost, duration, and result text. */
  output?: ClaudeCliOutput;
  /** Number of validation-failure continuations performed. */
  continuations: number;
  /** Human-readable error message if execution failed. */
  error?: string;
  /** Classified failure reason for structured error handling. */
  error_category?: ErrorCategory;
  /** Tool permission denials encountered during execution. */
  permission_denials?: PermissionDenial[];
}

/** Options for running an agent. */
export interface AgentRunOptions {
  /** Workflow node configuration (prompt, hooks, validation rules). */
  node: NodeConfig;
  /** Template context for interpolating prompt/hook variables. */
  ctx: TemplateContext;
  /** Resolved node settings (timeouts, retries, continuations). */
  settings: Required<NodeSettings>;
  /** Extra CLI arguments passed to claude command. */
  claudeArgs?: string[];
  /** Permission mode for this agent (maps to --permission-mode CLI flag). */
  permissionMode?: string;
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
  /** Working directory for subprocesses (worktree path or "."). */
  cwd?: string;
}

/**
 * Execute an agent node: invoke Claude CLI, validate output, continue on failure.
 *
 * Flow:
 * 1. Run `before` hook if configured
 * 2. Snapshot modified files if `allowed_paths` set (FR-E37)
 * 3. Invoke `claude` CLI with prompt + task template
 * 4. Validate output artifacts; inject scope_check result if out-of-scope mods detected
 * 5. If validation fails and continuations remain, resume with `--resume`
 * 6. Run `after` hook if configured
 *
 * Why reuse the same session_id across continuations: `claude --resume <id>`
 * re-enters the existing conversation so the agent retains full context of
 * what it already produced. A fresh invocation would lose that context, forcing
 * the agent to start over rather than surgically fix the specific validation
 * failure. Context preservation is critical when artefacts are large (e.g. a
 * half-written implementation) and only a small section needs correction.
 *
 * Why a loop rather than one-shot: the number of continuations needed is
 * unknown upfront — each pass may fix some failures while exposing others.
 * The loop terminates on either allPassed() or exhausting max_continuations,
 * satisfying the fail-fast contract without hard-coding a fixed retry count.
 */
export async function runAgent(opts: AgentRunOptions): Promise<AgentResult> {
  const {
    node,
    ctx,
    settings,
    claudeArgs,
    permissionMode,
    model,
    output,
    nodeId,
    streamLogPath,
    verbosity,
    cwd,
  } = opts;

  // Derive onOutput callback from OutputManager
  const onOutput = output && nodeId
    ? (line: string) => output.nodeOutput(nodeId, line)
    : undefined;

  // Run before hook
  if (node.before) {
    const hookCmd = interpolate(node.before, ctx, cwd);
    await runShellCommand(hookCmd, "before hook", cwd);
  }

  // Build task prompt
  const taskPrompt = node.prompt ? interpolate(node.prompt, ctx, cwd) : "";

  // Verbose: show interpolated prompt
  if (output && nodeId) {
    output.verbosePrompt(nodeId, taskPrompt);
  }

  // Scope check: snapshot before first invocation (FR-E37)
  let beforeSnapshot: Set<string> | undefined;
  if (node.allowed_paths !== undefined) {
    beforeSnapshot = await snapshotModifiedFiles(cwd);
  }

  // Initial invocation
  let result = await invokeClaudeCli({
    agent: node.agent,
    systemPrompt: node.system_prompt
      ? interpolate(node.system_prompt, ctx, cwd)
      : undefined,
    taskPrompt,
    claudeArgs,
    permissionMode,
    model,
    timeoutSeconds: settings.timeout_seconds,
    maxRetries: settings.max_retries,
    retryDelaySeconds: settings.retry_delay_seconds,
    onOutput,
    streamLogPath,
    verbosity,
    cwd,
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

  // Continuation loop: runs when validate rules exist OR scope check is active
  while (validationRules.length > 0 || node.allowed_paths !== undefined) {
    const validationResults = await runValidations(validationRules, ctx, cwd);

    // Inject scope_check result if out-of-scope modifications detected (FR-E37)
    if (node.allowed_paths !== undefined && beforeSnapshot !== undefined) {
      const afterSnapshot = await snapshotModifiedFiles(cwd);
      const violations = findViolations(
        beforeSnapshot,
        afterSnapshot,
        node.allowed_paths,
      );
      if (violations.length > 0) {
        const scopeRule: ValidationRule = { type: "scope_check", path: "" };
        validationResults.push({
          rule: scopeRule,
          passed: false,
          message: `Out-of-scope modifications: ${violations.join(", ")}`,
        });
      }
      // Update snapshot for next iteration (incremental detection)
      beforeSnapshot = afterSnapshot;
    }

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
      permissionMode,
      model,
      timeoutSeconds: settings.timeout_seconds,
      maxRetries: settings.max_retries,
      retryDelaySeconds: settings.retry_delay_seconds,
      onOutput,
      streamLogPath,
      verbosity,
      cwd,
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
    const hookCmd = interpolate(node.after, ctx, cwd);
    try {
      await runShellCommand(hookCmd, "after hook", cwd);
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

/** Run a shell command (for before/after hooks). */
async function runShellCommand(
  command: string,
  label: string,
  cwd?: string,
): Promise<void> {
  const cmd = new Deno.Command("sh", {
    args: ["-c", command],
    stdout: "piped",
    stderr: "piped",
    ...(cwd ? { cwd } : {}),
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
