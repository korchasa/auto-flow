/**
 * @module
 * Agent node execution: invoke Claude CLI, validate output artifacts, and
 * continue on validation failure (continuation loop).
 * Entry point: {@link runAgent}.
 * Depends on {@link invokeClaudeCli} for the actual subprocess management and
 * {@link runValidations} for post-run artifact checks.
 */

import type {
  CliRunOutput,
  ErrorCategory,
  HitlConfig,
  HumanInputRequest,
  NodeConfig,
  PermissionDenial,
  ProcessRegistry,
  ReasoningEffort,
  ResolvedNodeSettings,
  RuntimeId,
  TemplateContext,
  TransportOption,
  ValidationRule,
  Verbosity,
} from "./types.ts";
import type {
  ExtraArgsMap,
  RuntimeAdapter,
} from "@korchasa/ai-ide-cli/runtime/types";
import { interpolate } from "./template.ts";
import { getRuntimeAdapter } from "@korchasa/ai-ide-cli/runtime";
import { defaultRegistry } from "@korchasa/ai-ide-cli/process-registry";
import { isHitlConfigured } from "./hitl.ts";
import { buildHitlMcpServers, createHitlObserver } from "./hitl-injection.ts";
import {
  allPassed,
  formatFailures,
  runValidations,
  type ValidationResult,
} from "./validate.ts";
import type { OutputManager, VerboseInput } from "./output.ts";
import { findViolations, snapshotModifiedFiles } from "./scope-check.ts";
import { workPath } from "./state.ts";

/**
 * Resolve input artifact file paths and sizes from input directories.
 * Walks each input directory (non-recursive), collects file path + size.
 */
export async function resolveInputArtifacts(
  inputs: Record<string, string>,
  workDir: string = ".",
): Promise<VerboseInput[]> {
  const result: VerboseInput[] = [];
  for (const [_nodeId, dir] of Object.entries(inputs)) {
    // FR-E52: input dirs are workDir-relative — wrap before FS access from
    // engine cwd, otherwise readDir fails silently under worktree isolation.
    const fullDir = workPath(workDir, dir);
    try {
      for await (const entry of Deno.readDir(fullDir)) {
        if (!entry.isFile) continue;
        const filePath = `${fullDir}/${entry.name}`;
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
  output?: CliRunOutput;
  /** Number of validation-failure continuations performed. */
  continuations: number;
  /** Human-readable error message if execution failed. */
  error?: string;
  /** Classified failure reason for structured error handling. */
  error_category?: ErrorCategory;
  /** Tool permission denials encountered during execution. */
  permission_denials?: PermissionDenial[];
  /** HITL question captured from the agent's MCP `request_human_input` tool
   * call (FR-L35). Populated when the engine intercepted the call via
   * `onToolUseObserved` and aborted the run. The caller is expected to
   * route this through `handleAgentHitl` for ask/poll/resume. */
  hitl_question?: HumanInputRequest;
}

/** Options for running an agent. */
export interface AgentRunOptions {
  /** Workflow node configuration (prompt, hooks, validation rules). */
  node: NodeConfig;
  /** Template context for interpolating prompt/hook variables. */
  ctx: TemplateContext;
  /** Resolved node settings (timeouts, retries, continuations). */
  settings: ResolvedNodeSettings;
  /** Runtime used for this invocation. Defaults to claude for backward compatibility. */
  runtime?: RuntimeId;
  /** Extra CLI arguments passed to the selected runtime. Map-shape per FR-L14. */
  runtimeArgs?: ExtraArgsMap;
  /** Permission mode for this agent (maps to --permission-mode CLI flag). */
  permissionMode?: string;
  /** Claude model override (e.g. "claude-sonnet-4-6"). Omit = CLI default. */
  model?: string;
  /** Resolved reasoning-effort dial (FR-E42). Forwarded to the runtime adapter
   * on initial AND continuation invocations; the library itself filters
   * `--effort` from the resume argv (Claude only). */
  reasoningEffort?: ReasoningEffort;
  /** Workflow HITL config forwarded to runtimes that need explicit tool wiring. */
  hitlConfig?: HitlConfig;
  /** Injected runtime adapter for unit testing. */
  runtimeAdapter?: RuntimeAdapter;
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
  /** Resolved `budget.max_turns` (FR-E47). Claude-only: emits `--max-turns <N>`
   * to extraArgs; other runtimes silently omit to avoid unknown-flag rejection. */
  maxTurns?: number;
  /** Resolved tool whitelist (FR-E48). Passed as typed `allowedTools` to the
   * runtime adapter; Claude emits `--allowedTools`, other adapters may warn. */
  allowedTools?: string[];
  /** Resolved tool blacklist (FR-E48). See {@link allowedTools}. */
  disallowedTools?: string[];
  /** Caller-supplied process tracker scope
   * (FR-E60). Forwarded to every
   * `adapter.invoke()` call this agent makes (initial + continuations) so
   * the resulting child processes register in this {@link ProcessRegistry}
   * instead of the ai-ide-cli default singleton. Omit to keep the legacy
   * singleton behavior. */
  processRegistry?: ProcessRegistry;
  /** Resolved transport (FR-E77). Forwarded to `adapter.invoke()` on both
   * the initial call and continuation/resume calls. The HITL MCP injection
   * gate consults `adapter.capabilitiesFor?.(transport)` instead of the
   * adapter's CLI vector so transport-specific downgrades take effect. */
  transport?: TransportOption;
}

/**
 * Append runtime-specific budget flags to `extraArgs`. Currently only Claude
 * gets `--max-turns <N>` (FR-E47). Other runtimes may reject unknown flags —
 * omit instead of relying on silent-ignore tolerance.
 */
export function applyBudgetFlags(
  base: ExtraArgsMap | undefined,
  runtime: RuntimeId,
  maxTurns: number | undefined,
): ExtraArgsMap | undefined {
  if (maxTurns === undefined) return base;
  if (runtime !== "claude") return base;
  return { ...(base ?? {}), "--max-turns": String(maxTurns) };
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
    runtime = "claude",
    runtimeArgs,
    permissionMode,
    model,
    reasoningEffort,
    hitlConfig,
    runtimeAdapter,
    output,
    nodeId,
    streamLogPath,
    verbosity,
    cwd,
    maxTurns,
    allowedTools,
    disallowedTools,
    processRegistry,
    transport,
  } = opts;
  const adapter = runtimeAdapter ?? getRuntimeAdapter(runtime);
  const extraArgs = applyBudgetFlags(runtimeArgs, runtime, maxTurns);

  // FR-E80: cumulative wall-clock retry cap. When configured, a single
  // AbortController is shared across the initial invoke and every
  // continuation; expiry aborts the in-flight subprocess via the signal
  // forwarded into `RuntimeInvokeOptions.signal`. Undefined cap means no
  // clock and no signal — preserves byte-identical legacy behaviour for
  // workflows that omit the field.
  const wallClockCapSec = settings.max_retry_wall_clock_seconds;
  const budgetController = wallClockCapSec !== undefined
    ? new AbortController()
    : undefined;
  const budgetTimer = wallClockCapSec !== undefined && budgetController
    ? setTimeout(() => {
      budgetController.abort(
        new Error(`retry budget ${wallClockCapSec}s exceeded`),
      );
    }, wallClockCapSec * 1000)
    : undefined;
  const buildBudgetExceeded = (attempts: number): AgentResult => {
    const msg =
      `wall-clock budget ${wallClockCapSec}s exceeded after ${attempts} attempt(s)`;
    if (output && nodeId) {
      output.warn(`${nodeId.padEnd(16)}${msg}`);
    }
    return {
      success: false,
      continuations: Math.max(0, attempts - 1),
      error: msg,
      error_category: "retry_budget_exceeded",
    };
  };

  // FR-E77: derive the transport-scoped capability vector for HITL gating.
  // Falls back to the CLI vector when the adapter does not implement
  // `capabilitiesFor` (older library versions or test stubs).
  const effectiveCaps = adapter.capabilitiesFor?.(transport ?? "cli") ??
    adapter.capabilities;

  // FR-L35: register the engine's HITL MCP server when (a) the workflow
  // has HITL configured AND (b) the resolved transport's capability vector
  // supports per-invocation MCP injection. The `onToolUseObserved` observer
  // intercepts the agent's call to `request_human_input` and aborts the run
  // with the question stashed for the caller to route through
  // `handleAgentHitl`.
  const hitlEnabled = isHitlConfigured(hitlConfig) &&
    effectiveCaps.mcpInjection;
  const mcpServers = hitlEnabled ? buildHitlMcpServers() : undefined;
  const hitlObserver = hitlEnabled ? createHitlObserver(runtime) : undefined;

  // Derive onOutput callback from OutputManager
  const onOutput = output && nodeId
    ? (line: string) => output.nodeOutput(nodeId, line)
    : undefined;

  // FR-E79: surface library `onCallbackError` (FR-L32 consumer-callback
  // throws + FR-L39 ACP `degradedOptions` diagnostics) as node-tagged
  // engine WARN lines. When `output`/`nodeId` is omitted (headless
  // embedders), leave the field undefined so the library's default
  // `console.warn` handler runs — pre-existing behaviour preserved.
  const onCallbackError = output && nodeId
    ? (err: unknown, source: string) => {
      const msg = err instanceof Error ? err.message : String(err);
      output.warn(`${nodeId.padEnd(16)}runtime ${source}: ${msg}`);
    }
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
  const systemPromptDelivery = await prepareSystemPromptDelivery({
    nodeId,
    runtime,
    systemPromptTemplate: node.system_prompt,
    ctx,
    cwd,
  });
  const initialInvokeOptions: Parameters<RuntimeAdapter["invoke"]>[0] = {
    agent: node.agent,
    ...systemPromptDelivery,
    taskPrompt,
    extraArgs,
    permissionMode,
    model,
    // FR-E42: forward to adapter; library filters --effort on resume.
    reasoningEffort,
    allowedTools,
    disallowedTools,
    mcpServers,
    onToolUseObserved: hitlObserver?.observer,
    timeoutSeconds: settings.timeout_seconds,
    maxRetries: settings.max_retries,
    retryDelaySeconds: settings.retry_delay_seconds,
    onOutput,
    onCallbackError,
    streamLogPath,
    verbosity,
    cwd,
    processRegistry: processRegistry ?? defaultRegistry,
    // FR-E77: forward resolved transport on the initial invocation.
    transport,
    // FR-E80: shared budget signal — undefined when no cap is configured.
    signal: budgetController?.signal,
  };
  let attempts = 0;

  try {
    attempts++;
    let result = await adapter.invoke(initialInvokeOptions);
    if (budgetController?.signal.aborted) {
      return buildBudgetExceeded(attempts);
    }

    let continuations = 0;
    const validationRules = node.validate ?? [];

    // FR-L35 / hitl-via-engine-mcp: HITL question captured by `onToolUseObserved` is the
    // run's terminal state. Skip the cli_crash branch (the abort-induced
    // is_error is by design) AND skip validation/continuation: the artifact
    // is intentionally absent until the user replies, so validation would
    // fail and a resume would re-invoke the agent — at which point the
    // observer's "captured-once" guard lets the second tool call through with
    // a fake `{ok:true}` response. The agent then believes the question was
    // answered, and the engine never surfaces the captured question to
    // `handleAgentHitl`. Short-circuit here and let the caller route it.
    const hitlEarlyReturn = (): AgentResult | null => {
      const captured = hitlObserver?.getQuestion();
      if (!captured) return null;
      return {
        success: true,
        session_id: result.output?.session_id,
        output: result.output,
        continuations,
        hitl_question: captured,
        permission_denials: result.output?.permission_denials,
      };
    };
    {
      const early = hitlEarlyReturn();
      if (early) return early;
    }

    // Fail fast if initial invocation returned no output at all
    if (result.error && !result.output) {
      return {
        success: false,
        continuations,
        error: result.error,
        error_category: mapRuntimeErrorCategory(result.error_category),
      };
    }

    // Fail fast on runtime-reported error: the adapter ran but the model/API
    // terminated the turn with is_error=true. The artifact this node was
    // supposed to write does not exist, so continuation/--resume cannot
    // satisfy validation — it would just resend the same broken prompt and
    // burn `max_continuations × max_retries` invocations. Surface the error
    // immediately. Permanent-category signals (e.g. Codex 400 invalid_request)
    // are propagated through `error_category`; transient categories
    // (`stream_stall`) keep their existing semantics.
    if (result.output?.is_error) {
      const detail = result.output.result ?? result.error ?? "is_error=true";
      return {
        success: false,
        session_id: result.output.session_id,
        output: result.output,
        continuations,
        error: `Runtime returned error: ${detail}`,
        error_category: mapRuntimeErrorCategory(result.error_category),
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

      attempts++;
      result = await adapter.invoke({
        resumeSessionId: result.output.session_id,
        taskPrompt: resumePrompt,
        extraArgs,
        permissionMode,
        model,
        // FR-E42: still forward — library skips emission on resume.
        reasoningEffort,
        allowedTools,
        disallowedTools,
        mcpServers,
        onToolUseObserved: hitlObserver?.observer,
        timeoutSeconds: settings.timeout_seconds,
        maxRetries: settings.max_retries,
        retryDelaySeconds: settings.retry_delay_seconds,
        onOutput,
        onCallbackError,
        streamLogPath,
        verbosity,
        cwd,
        processRegistry: processRegistry ?? defaultRegistry,
        // FR-E77: forward resolved transport on resume so HITL replies and
        // validation continuations land on the same transport as the
        // initial invocation.
        transport,
        // FR-E80: same controller as the initial invocation — cumulative
        // budget across all attempts.
        signal: budgetController?.signal,
      });
      if (budgetController?.signal.aborted) {
        return buildBudgetExceeded(attempts);
      }

      // Same short-circuit applies if the observer captures during a
      // continuation: the artifact still cannot be produced without the
      // user's reply, and any further continuation would race the
      // observer's captured-once guard.
      const earlyAfterResume = hitlEarlyReturn();
      if (earlyAfterResume) return earlyAfterResume;
    }

    if (result.error) {
      return {
        success: false,
        session_id: result.output?.session_id,
        output: result.output,
        continuations,
        error: result.error,
        error_category: mapRuntimeErrorCategory(result.error_category),
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
      hitl_question: hitlObserver?.getQuestion() ?? undefined,
    };
  } finally {
    // FR-E80: clear the wall-clock budget timer on EVERY exit path —
    // success, fail-fast, HITL early return, continuation exhaustion,
    // hook failure, exception. Otherwise the timer leaks past runAgent
    // and may incorrectly abort a later operation in the same process.
    if (budgetTimer !== undefined) clearTimeout(budgetTimer);
  }
}

// --- Internal helpers ---

async function prepareSystemPromptDelivery(
  opts: {
    nodeId?: string;
    runtime: RuntimeId;
    systemPromptTemplate?: string;
    ctx: TemplateContext;
    cwd?: string;
  },
): Promise<{ systemPrompt?: string; systemPromptFile?: string }> {
  const { nodeId, runtime, systemPromptTemplate, ctx, cwd } = opts;
  if (!systemPromptTemplate) return {};

  const systemPrompt = interpolate(systemPromptTemplate, ctx, cwd);
  if (runtime !== "claude") {
    return { systemPrompt };
  }

  const childPath = interpolate("{{node_dir}}/system-prompt.md", ctx, cwd);
  const workDir = cwd ?? ctx.workDir;
  const fsNodeDir = workPath(workDir, ctx.node_dir);
  const fsPath = `${fsNodeDir}/system-prompt.md`;
  try {
    await Deno.mkdir(fsNodeDir, { recursive: true });
    await Deno.writeTextFile(fsPath, systemPrompt);
  } catch (err) {
    const label = nodeId ?? "<unknown>";
    throw new Error(
      `Failed to write system prompt artifact for node '${label}' at '${fsPath}': ${
        (err as Error).message
      }`,
    );
  }

  return { systemPromptFile: childPath };
}

function mapRuntimeErrorCategory(
  category: string | undefined,
): ErrorCategory {
  if (category === "stream_stall") return "stream_stall";
  return "cli_crash";
}

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
