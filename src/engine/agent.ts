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
  ValidationRule,
  Verbosity,
} from "../types.ts";
import type {
  ExtraArgsMap,
  RuntimeAdapter,
  RuntimeInvokeResult,
} from "@korchasa/ai-ide-cli/runtime/types";
import { interpolate } from "../config/template.ts";
import { resolve } from "@std/path";
import { getRuntimeAdapter } from "@korchasa/ai-ide-cli/runtime";
import { defaultRegistry } from "@korchasa/ai-ide-cli/process-registry";
import { isHitlConfigured } from "../hitl/hitl.ts";
import {
  buildHitlMcpServers,
  createHitlObserver,
} from "../hitl/hitl-injection.ts";
import {
  allPassed,
  formatFailures,
  runValidations,
  type ValidationResult,
} from "../config/validate.ts";
import type { OutputManager, VerboseInput } from "../output.ts";
import {
  findViolations,
  snapshotModifiedFiles,
} from "../isolation/scope-check.ts";
import { workPath } from "../state/state.ts";
import {
  createEventFormatter,
  createStreamLogWriter,
  type StreamLogWriter,
} from "./stream-log.ts";

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
  /** FR-E96: what this node hands back. The `after` hook's stdout when the
   * node declares one, the agent's final message otherwise. */
  answer?: string;
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
  /** Verbosity level for terminal output filtering. Consumed by the
   * {@link OutputManager} the caller builds — NEVER forwarded to the runtime:
   * the ACP wire cannot carry `verbosity` and rejects the whole invoke when it
   * is present (FR-E98). */
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
  /** FR-E37: write scopes the check forgives on top of the node's own
   * `allowed_paths` — the run's artifact directory, which the engine itself
   * writes into, and the scopes of the other nodes sharing this node's tree.
   * The snapshots are repository-wide, so both land inside this node's
   * bracket and would otherwise be reported against it. Consulted only when
   * `nodeId` is given: a direct `runAgent` call outside the engine has no
   * node to attribute writes to, and keeps the plain `allowed_paths` check. */
  forgivenScopes?: (nodeId: string) => readonly string[];
  /** FR-E100: re-enter this runtime session on the INITIAL invoke instead of
   * opening a new one — the session an earlier attempt of this node, or of an
   * ancestor node, recorded. The invoke then takes the continuation shape:
   * task prompt, no system prompt, no `agent`. A front that did not advertise
   * `session/load` fails the node with `config_error`; nothing falls back to
   * a fresh session. */
  resumeSessionId?: string;
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
 * FR-E98: name the workflow fields whose intent the ACP wire cannot carry, or
 * `undefined` when the node asks for nothing of the sort.
 *
 * The library rejects `agent` and `extraArgs` outright
 * (`ACP_UNSUPPORTED_INVOKE_OPTIONS`), and both come straight from the workflow
 * file. Reporting them here — before the invoke — names the YAML key the author
 * wrote rather than the library field it maps to.
 *
 * @param agent   Value of the node's `agent:` key.
 * @param extraArgs Resolved runtime args, budget flags already folded in.
 */
export function acpUnsupportedIntent(
  agent: string | undefined,
  extraArgs: ExtraArgsMap | undefined,
): string | undefined {
  const offenders: string[] = [];
  if (agent !== undefined) offenders.push("agent");
  if (extraArgs && Object.keys(extraArgs).length > 0) {
    offenders.push("runtime_args");
  }
  if (offenders.length === 0) return undefined;
  return `The ACP transport cannot carry ${offenders.join(" or ")}; ` +
    `remove ${offenders.length > 1 ? "them" : "it"} from the node ` +
    `(a non-empty runtime_args also comes from budget.max_turns on claude).`;
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
 * The same argument holds ACROSS attempts (FR-E100): a loop body fixing what a
 * reviewer found, or a node rewriting what an ancestor wrote, loses the whole
 * context of the first attempt when it starts fresh. `resumeSessionId` lets
 * the caller hand such a session in, and the initial invoke then takes the
 * very shape the continuation below already uses — so a resumed attempt and a
 * validation continuation are one code path as far as the runtime can tell.
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
    cwd,
    maxTurns,
    allowedTools,
    disallowedTools,
    processRegistry,
    forgivenScopes,
    resumeSessionId,
  } = opts;
  const adapter = runtimeAdapter ?? getRuntimeAdapter(runtime);
  const extraArgs = applyBudgetFlags(runtimeArgs, runtime, maxTurns);

  // FR-E98: ACP is the engine's only transport, and the ACP wire carries
  // neither a named sub-agent nor raw CLI flags. Both encode explicit
  // workflow intent, so refuse the node instead of dropping them — a
  // silently ignored `--max-turns` would look like a budget cap that never
  // fires. `verbosity` and `onOutput` are NOT in this list: the engine owns
  // both locally, so it simply stops sending them.
  const acpRejects = acpUnsupportedIntent(node.agent, extraArgs);
  if (acpRejects) {
    return {
      success: false,
      continuations: 0,
      error: acpRejects,
      error_category: "config_error",
    };
  }

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

  // Derive the ACP capability vector for HITL gating. Falls back to the
  // adapter's default capabilities when it does not implement
  // `capabilitiesFor` (test stubs).
  const effectiveCaps = adapter.capabilitiesFor?.("acp") ??
    adapter.capabilities;

  // FR-L35: register the engine's HITL MCP server when (a) the workflow
  // has HITL configured AND (b) the ACP capability vector supports
  // per-invocation MCP injection. The `onToolUseObserved` observer
  // intercepts the agent's call to `request_human_input` and aborts the run
  // with the question stashed for the caller to route through
  // `handleAgentHitl`.
  const hitlEnabled = isHitlConfigured(hitlConfig) &&
    effectiveCaps.mcpInjection;
  const mcpServers = hitlEnabled ? buildHitlMcpServers() : undefined;
  const hitlObserver = hitlEnabled ? createHitlObserver(runtime) : undefined;

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

  // The engine works in a repo-relative workDir (template paths resolve
  // against it), but the ACP front validates `cwd` as an absolute path —
  // claude's `session/new` rejects a relative one outright.
  const runtimeCwd = cwd === undefined ? undefined : resolve(cwd);

  // Initial invocation. FR-E100: a resumed session already holds its system
  // prompt from its first turn, and the ACP resume shape carries none — so a
  // continued attempt delivers the task prompt only.
  const systemPromptDelivery = resumeSessionId === undefined
    ? await prepareSystemPromptDelivery({
      nodeId,
      runtime,
      systemPromptTemplate: node.system_prompt,
      ctx,
      cwd,
    })
    : {};

  // FR-E18/FR-E20: the engine is the SOLE writer of `${node_dir}/stream.log`.
  // Under ACP the library persists nothing — it only forwards raw
  // `session/update` params via `onEvent`. Open the writer once here (before
  // the first invoke) so a single append handle spans the initial invoke AND
  // every continuation. A synchronous open failure fails the node fast with
  // `cli_crash` (fail-fast); async write rejections surface via
  // `takeWriteError()` after each invoke and after `close()`.
  let streamLog: StreamLogWriter | undefined;
  if (streamLogPath) {
    try {
      streamLog = createStreamLogWriter(streamLogPath, {
        onParseError: onCallbackError,
      });
    } catch (err) {
      if (budgetTimer !== undefined) clearTimeout(budgetTimer);
      return {
        success: false,
        continuations: 0,
        error: (err as Error).message,
        error_category: "cli_crash",
      };
    }
  }
  // FR-E98: one formatter per node run, feeding both sinks. The ACP wire
  // cannot carry `onOutput`, so the live per-node terminal lines come from
  // the same events as `stream.log` — formatted once so the two never
  // disagree and the FR-E20 re-read counter is not double-counted.
  const nodeSink = output && nodeId
    ? (line: string) => output.nodeOutput(nodeId, line)
    : undefined;
  const eventFormatter = streamLog || nodeSink
    ? createEventFormatter({ onParseError: onCallbackError })
    : undefined;
  const onEvent = eventFormatter
    ? (params: Record<string, unknown>) => {
      const lines = eventFormatter.format(params);
      if (lines.length === 0) return;
      streamLog?.writeLines(lines);
      if (nodeSink) { for (const line of lines) nodeSink(line); }
    }
    : undefined;

  const initialInvokeOptions: Parameters<RuntimeAdapter["invoke"]>[0] = {
    // ACP is the engine's only runtime transport — request it explicitly so
    // `@korchasa/ai-ide-cli` adapters route through the shared ACP client
    // instead of their default CLI subprocess path.
    transport: "acp",
    // FR-E100: the resume shape (see the continuation invoke below) names the
    // session and nothing that only a new session takes.
    ...(resumeSessionId === undefined
      ? { agent: node.agent }
      : { resumeSessionId }),
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
    onCallbackError,
    // FR-E18/E20: subscribe to the raw ACP event stream — the engine persists
    // it to `stream.log`. `streamLogPath` is intentionally NOT forwarded (the
    // library drops it under ACP and would report a spurious FR-E79 WARN).
    onEvent,
    cwd: runtimeCwd,
    processRegistry: processRegistry ?? defaultRegistry,
    // FR-E80: shared budget signal — undefined when no cap is configured.
    signal: budgetController?.signal,
  };
  let attempts = 0;

  /** Flush + close the stream-log writer and surface any deferred write
   * rejection. Idempotent close; safe to call once before the success return. */
  const flushStreamLog = async (): Promise<Error | null> => {
    if (!streamLog) return null;
    await streamLog.close();
    return streamLog.takeWriteError();
  };

  try {
    attempts++;
    let result: RuntimeInvokeResult;
    try {
      result = await adapter.invoke(initialInvokeOptions);
    } catch (err) {
      // FR-E100: the library THROWS when the front did not advertise
      // `session/load` and the invoke asked to resume. The error class is not
      // exported, so it is recognised by the name its constructor sets and the
      // option it names; anything else is not ours to interpret.
      if (resumeSessionId !== undefined && rejectsResumeSession(err)) {
        return {
          success: false,
          continuations: 0,
          error: `Node '${
            nodeId ?? "<unknown>"
          }' asks to continue a session, but runtime '${runtime}' did not advertise session/load`,
          error_category: "config_error",
        };
      }
      throw err;
    }
    if (budgetController?.signal.aborted) {
      return buildBudgetExceeded(attempts);
    }

    let continuations = 0;
    // FR-E18: fail fast if persisting the event stream already rejected.
    {
      const we = streamLog?.takeWriteError();
      if (we) {
        return {
          success: false,
          session_id: result.output?.session_id,
          output: result.output,
          continuations,
          error: `stream-log write failed: ${we.message}`,
          error_category: "cli_crash",
        };
      }
    }
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
          [
            ...node.allowed_paths,
            // FR-E37: the engine's own writes into the run directory, and the
            // scopes of whoever else shares this tree right now. Neither is
            // this node's edit, and a repository-wide snapshot cannot tell
            // them apart from one.
            ...(nodeId === undefined ? [] : forgivenScopes?.(nodeId) ?? []),
          ],
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
        // ACP is the engine's only runtime transport (see initial invocation).
        transport: "acp",
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
        onCallbackError,
        // FR-E18/E20: same engine-owned writer as the initial invoke —
        // events append to one handle across all continuations.
        onEvent,
        cwd: runtimeCwd,
        processRegistry: processRegistry ?? defaultRegistry,
        // FR-E80: same controller as the initial invocation — cumulative
        // budget across all attempts.
        signal: budgetController?.signal,
      });
      if (budgetController?.signal.aborted) {
        return buildBudgetExceeded(attempts);
      }
      // FR-E18: fail fast on a deferred stream-log write rejection.
      {
        const we = streamLog?.takeWriteError();
        if (we) {
          return {
            success: false,
            session_id: result.output?.session_id,
            output: result.output,
            continuations,
            error: `stream-log write failed: ${we.message}`,
            error_category: "cli_crash",
          };
        }
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

    // Run after hook. Its stdout, when there is a hook, is the node's answer
    // (FR-E96) — the agent's final message otherwise.
    let afterOutput: string | undefined;
    if (node.after) {
      const hookCmd = interpolate(node.after, ctx, cwd);
      try {
        afterOutput = await runShellCommand(hookCmd, "after hook", cwd);
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

    // FR-E18: flush the stream log before declaring success; a deferred
    // write rejection that only surfaces on the final flush fails the node
    // `cli_crash` (persistence failure is fatal — never swallowed).
    const writeErr = await flushStreamLog();
    if (writeErr) {
      return {
        success: false,
        session_id: result.output?.session_id,
        output: result.output,
        continuations,
        error: `stream-log write failed: ${writeErr.message}`,
        error_category: "cli_crash",
      };
    }

    return {
      success: true,
      session_id: result.output?.session_id,
      output: result.output,
      continuations,
      permission_denials: result.output?.permission_denials,
      hitl_question: hitlObserver?.getQuestion() ?? undefined,
      answer: afterOutput ?? result.output?.result ?? "",
    };
  } finally {
    // FR-E80: clear the wall-clock budget timer on EVERY exit path —
    // success, fail-fast, HITL early return, continuation exhaustion,
    // hook failure, exception. Otherwise the timer leaks past runAgent
    // and may incorrectly abort a later operation in the same process.
    if (budgetTimer !== undefined) clearTimeout(budgetTimer);
    // FR-E18: guarantee the stream-log fd is released on every exit path
    // (close is idempotent — the success path already flushed it).
    if (streamLog) await streamLog.close();
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
): Promise<{ systemPrompt?: string }> {
  const { nodeId, runtime, systemPromptTemplate, ctx, cwd } = opts;
  if (!systemPromptTemplate) return {};

  const systemPrompt = interpolate(systemPromptTemplate, ctx, cwd);
  if (runtime !== "claude") {
    return { systemPrompt };
  }

  // FR-E9: the interpolated prompt is persisted for observers. It is NOT
  // handed over as `systemPromptFile` — the ACP wire, the engine's only
  // transport, rejects that option (ai-ide-cli FR-L39) — so the front gets
  // the same text inline like every other runtime.

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

  return { systemPrompt };
}

/**
 * FR-E100: is this the `AcpUnsupportedOptionError` the ACP adapter throws for
 * a `resumeSessionId` the front cannot load? Duck-typed on the stable `name`
 * and `fields` the library documents, because the class itself is not among
 * the package exports.
 */
function rejectsResumeSession(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { name, fields } = err as { name?: unknown; fields?: unknown };
  return name === "AcpUnsupportedOptionError" && Array.isArray(fields) &&
    fields.includes("resumeSessionId");
}

function mapRuntimeErrorCategory(
  category: string | undefined,
): ErrorCategory {
  if (category === "stream_stall") return "stream_stall";
  return "cli_crash";
}

/** Run a shell command (for before/after hooks). */
/**
 * Run a hook through `sh -c` and return its stdout.
 *
 * The stdout is not incidental: when a node declares `after`, that output
 * becomes the node's answer (FR-E96), which is what lets a code-editing branch
 * hand its patch back without the engine knowing anything about patches.
 */
export async function runShellCommand(
  command: string,
  label: string,
  cwd?: string,
): Promise<string> {
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
  return new TextDecoder().decode(output.stdout);
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
