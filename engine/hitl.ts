import type {
  ClaudeCliOutput,
  HitlConfig,
  NodeConfig,
  NodeSettings,
  TemplateContext,
} from "./types.ts";
import { interpolate } from "./template.ts";
import type { AgentResult } from "./agent.ts";
import type { InvokeOptions } from "./claude-process.ts";
import type { OutputManager } from "./output.ts";

/** Structured question extracted from AskUserQuestion permission denial. */
export interface HitlQuestion {
  /** The question text to present to the human. */
  question: string;
  /** Optional heading displayed above the question. */
  header?: string;
  /** Selectable answer choices with labels and optional descriptions. */
  options?: Array<{ label: string; description?: string }>;
  /** Whether the user can select multiple options. */
  multiSelect?: boolean;
}

/** Script runner function signature (injectable for testing). */
export type ScriptRunner = (
  path: string,
  args: string[],
) => Promise<{ exitCode: number; stdout: string }>;

/** Claude CLI runner function signature (injectable for testing). */
export type ClaudeRunner = (
  opts: InvokeOptions,
) => Promise<{ output?: ClaudeCliOutput; error?: string }>;

/** Options for running the HITL poll loop. */
export interface HitlRunOptions {
  /** HITL configuration (scripts, timeouts, polling). */
  config: HitlConfig;
  /** ID of the node awaiting human input. */
  nodeId: string;
  /** Current workflow run identifier. */
  runId: string;
  /** Filesystem path to the run's root directory. */
  runDir: string;
  /** Environment variables passed to scripts. */
  env: Record<string, string>;
  /** Claude CLI session ID to resume after receiving a reply. */
  sessionId: string;
  /** The question extracted from the agent's permission denial. */
  question: HitlQuestion;
  /** Node configuration for the agent being paused. */
  node: NodeConfig;
  /** Template context for artifact resolution. */
  ctx: TemplateContext;
  /** Resolved node settings (timeouts, retries). */
  settings: Required<NodeSettings>;
  /** Extra CLI flags forwarded to Claude on resume. */
  claudeArgs?: string[];
  /** Permission mode forwarded to Claude on resume. */
  permissionMode?: string;
  /** Claude model override. Forwarded to invokeClaudeCli on resume. */
  model?: string;
  /** Output manager for status/progress messages. */
  output?: OutputManager;
  /** Injected script runner — defaults to real shell; override in tests. */
  scriptRunner?: ScriptRunner;
  /** Injected claude CLI runner — defaults to real invokeClaudeCli; override in tests. */
  claudeRunner?: ClaudeRunner;
  /** Working directory for subprocesses (worktree path or undefined for CWD). */
  cwd?: string;
}

/**
 * Detect an AskUserQuestion HITL request in Claude CLI output.
 * Returns the extracted HitlQuestion or null if none found.
 */
export function detectHitlRequest(
  output: ClaudeCliOutput,
): HitlQuestion | null {
  if (!output.permission_denials || output.permission_denials.length === 0) {
    return null;
  }

  const denial = output.permission_denials.find(
    (d) => d.tool_name === "AskUserQuestion",
  );
  if (!denial) return null;

  const input = denial.tool_input;

  // Format 1: { questions: [{ question, header, options, multiSelect }] }
  if (
    input.questions && Array.isArray(input.questions) &&
    input.questions.length > 0
  ) {
    const q = input.questions[0] as Record<string, unknown>;
    return {
      question: q.question as string,
      header: q.header as string | undefined,
      options: q.options as HitlQuestion["options"],
      multiSelect: q.multiSelect as boolean | undefined,
    };
  }

  // Format 2: flat { question, header, options, multiSelect }
  if (typeof input.question === "string") {
    return {
      question: input.question as string,
      header: input.header as string | undefined,
      options: input.options as HitlQuestion["options"],
      multiSelect: input.multiSelect as boolean | undefined,
    };
  }

  return null;
}

/**
 * Run the HITL poll loop: deliver question, poll for reply, resume agent.
 *
 * Flow:
 * 1. If !skipAsk: invoke ask_script to deliver question
 * 2. Poll: sleep(poll_interval) → check_script → exit 0 = reply in stdout
 * 3. On reply: resume agent via claude --resume <sessionId> -p "<reply>"
 * 4. On timeout: return failure
 */
export async function runHitlLoop(
  opts: HitlRunOptions,
  skipAsk = false,
): Promise<AgentResult> {
  const {
    config,
    nodeId,
    runId,
    runDir,
    sessionId,
    question,
    settings,
    claudeArgs,
    output,
  } = opts;

  const cwdOpt = opts.cwd;
  const runner = opts.scriptRunner ??
    ((path: string, args: string[]) => defaultScriptRunner(path, args, cwdOpt));
  const claudeRun = opts.claudeRunner ??
    (await import("./claude-process.ts")).invokeClaudeCli;

  // Step 1: Deliver question (unless resuming)
  if (!skipAsk) {
    const askArgs = buildScriptArgs(
      "ask",
      runDir,
      runId,
      nodeId,
      config,
      opts.ctx,
      question,
    );

    const askResult = await runner(config.ask_script, askArgs);
    if (askResult.exitCode !== 0) {
      return {
        success: false,
        continuations: 0,
        error: `ask_script failed with exit code ${askResult.exitCode}`,
        error_category: "unknown",
      };
    }
  }

  // Step 2: Poll for reply
  const deadline = Date.now() + config.timeout * 1000;

  while (Date.now() < deadline) {
    // Sleep first (give human time to respond)
    await sleep(config.poll_interval * 1000);

    if (Date.now() >= deadline) break;

    // Status update
    const elapsed = Math.round(
      (Date.now() - (deadline - config.timeout * 1000)) / 1000,
    );
    if (output) {
      output.status(nodeId, `WAITING for human reply (${elapsed}s elapsed)`);
    }

    const checkArgs = buildScriptArgs(
      "check",
      runDir,
      runId,
      nodeId,
      config,
      opts.ctx,
    );

    const checkResult = await runner(config.check_script, checkArgs);

    if (checkResult.exitCode === 0 && checkResult.stdout.trim()) {
      // Reply received — resume agent
      const reply = checkResult.stdout.trim();

      const result = await claudeRun({
        resumeSessionId: sessionId,
        taskPrompt: reply,
        claudeArgs,
        permissionMode: opts.permissionMode,
        model: opts.model,
        timeoutSeconds: settings.timeout_seconds,
        maxRetries: settings.max_retries,
        retryDelaySeconds: settings.retry_delay_seconds,
        cwd: cwdOpt,
      });

      if (result.error) {
        return {
          success: false,
          session_id: result.output?.session_id,
          output: result.output,
          continuations: 0,
          error: result.error,
          error_category: "cli_crash",
        };
      }

      return {
        success: true,
        session_id: result.output?.session_id,
        output: result.output,
        continuations: 0,
        permission_denials: result.output?.permission_denials,
      };
    }

    // exit 1 = no reply yet; other codes = transient error, continue
    if (checkResult.exitCode !== 1 && checkResult.exitCode !== 0) {
      if (output) {
        output.warn(
          `check_script returned exit code ${checkResult.exitCode} (transient error, retrying)`,
        );
      }
    }
  }

  // Timeout
  return {
    success: false,
    continuations: 0,
    error: `HITL timeout after ${config.timeout}s waiting for human reply`,
    error_category: "hitl_timeout",
  };
}

// --- Internal helpers ---

/** Build args array for ask/check scripts. */
function buildScriptArgs(
  type: "ask" | "check",
  runDir: string,
  runId: string,
  nodeId: string,
  config: HitlConfig,
  ctx: TemplateContext,
  question?: HitlQuestion,
): string[] {
  const args = [
    "--run-dir",
    runDir,
    "--artifact-source",
    interpolate(config.artifact_source ?? "", ctx),
    "--run-id",
    runId,
    "--node-id",
    nodeId,
  ];

  if (type === "ask" && question) {
    args.push("--question-json", JSON.stringify(question));
  }

  if (type === "check" && config.exclude_login) {
    args.push("--exclude-login", config.exclude_login);
  }

  return args;
}

/** Default script runner — executes shell script via sh. */
async function defaultScriptRunner(
  path: string,
  args: string[],
  cwd?: string,
): Promise<{ exitCode: number; stdout: string }> {
  const cmd = new Deno.Command("sh", {
    args: [path, ...args],
    stdout: "piped",
    stderr: "piped",
    ...(cwd ? { cwd } : {}),
  });
  const output = await cmd.output();
  return {
    exitCode: output.code,
    stdout: new TextDecoder().decode(output.stdout).trim(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
