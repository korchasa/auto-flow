import type {
  ClaudeCliOutput,
  HitlConfig,
  NodeConfig,
  NodeSettings,
  TemplateContext,
} from "./types.ts";
import type { AgentResult, InvokeOptions } from "./agent.ts";
import type { OutputManager } from "./output.ts";

/** Structured question extracted from AskUserQuestion permission denial. */
export interface HitlQuestion {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
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
  config: HitlConfig;
  nodeId: string;
  runId: string;
  runDir: string;
  env: Record<string, string>;
  sessionId: string;
  question: HitlQuestion;
  node: NodeConfig;
  ctx: TemplateContext;
  settings: Required<NodeSettings>;
  claudeArgs?: string[];
  output?: OutputManager;
  /** Injected script runner — defaults to real shell; override in tests. */
  scriptRunner?: ScriptRunner;
  /** Injected claude CLI runner — defaults to real invokeClaudeCli; override in tests. */
  claudeRunner?: ClaudeRunner;
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

  const runner = opts.scriptRunner ?? defaultScriptRunner;
  const claudeRun = opts.claudeRunner ??
    (await import("./agent.ts")).invokeClaudeCli;

  // Step 1: Deliver question (unless resuming)
  if (!skipAsk) {
    const askArgs = buildScriptArgs(
      "ask",
      runDir,
      runId,
      nodeId,
      config,
      question,
    );

    const askResult = await runner(config.ask_script, askArgs);
    if (askResult.exitCode !== 0) {
      return {
        success: false,
        continuations: 0,
        error: `ask_script failed with exit code ${askResult.exitCode}`,
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
    );

    const checkResult = await runner(config.check_script, checkArgs);

    if (checkResult.exitCode === 0 && checkResult.stdout.trim()) {
      // Reply received — resume agent
      const reply = checkResult.stdout.trim();

      const result = await claudeRun({
        resumeSessionId: sessionId,
        taskPrompt: reply,
        claudeArgs,
        timeoutSeconds: settings.timeout_seconds,
        maxRetries: settings.max_retries,
        retryDelaySeconds: settings.retry_delay_seconds,
      });

      if (result.error) {
        return {
          success: false,
          session_id: result.output?.session_id,
          output: result.output,
          continuations: 0,
          error: result.error,
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
  question?: HitlQuestion,
): string[] {
  const args = [
    "--run-dir",
    runDir,
    "--issue-source",
    config.issue_source ?? "",
    "--run-id",
    runId,
    "--node-id",
    nodeId,
  ];

  if (type === "ask" && question) {
    args.push("--question-json", JSON.stringify(question));
  }

  if (type === "check" && config.bot_login) {
    args.push("--bot-login", config.bot_login);
  }

  return args;
}

/** Default script runner — executes shell script via sh. */
async function defaultScriptRunner(
  path: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string }> {
  const cmd = new Deno.Command("bash", {
    args: [path, ...args],
    stdout: "piped",
    stderr: "piped",
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
