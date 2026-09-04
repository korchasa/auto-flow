/**
 * @module
 * Node executor functions for the engine.
 * Encapsulates all node-type-specific execution logic, keeping engine.ts as a
 * pure orchestrator (config loading, state management, level iteration).
 */
import type { AgentResult } from "./agent.ts";
import { resolveInputArtifacts, runAgent, runShellCommand } from "./agent.ts";
import { persistAnswer } from "./answer.ts";
import { interpolate } from "../config/template.ts";
import { resolveBudget, resolveToolFilter } from "../config/config.ts";
import { runWithGuardrail } from "../isolation/guardrail.ts";
import { handleAgentHitl } from "../hitl/hitl-handler.ts";
import { isHitlConfigured } from "../hitl/hitl.ts";
import { runHitlNode } from "../hitl/hitl-node.ts";
import { resolve } from "@std/path";
import { runHuman } from "./human.ts";
import { runCommandNode } from "./command.ts";
import {
  allPassed,
  formatFailures,
  runValidations,
} from "../config/validate.ts";
import {
  findDirtyMemoryFiles,
  formatMemoryViolation,
} from "../isolation/memory-check.ts";
import type { UserInput } from "./human.ts";
import { saveAgentLog } from "../state/log.ts";
import { runLoop } from "./loop.ts";
import type { OutputManager } from "../output.ts";
import { resolveRuntimeConfig } from "@korchasa/ai-ide-cli/runtime";
import {
  appendAttemptCompleted,
  resultExcerpt,
  type RunJournalWriter,
} from "../state/run-journal.ts";
import {
  getNodeDir,
  getRunDir,
  markRunAborted,
  type PhaseRegistry,
  workPath,
} from "../state/state.ts";
import type {
  EngineOptions,
  ErrorCategory,
  NodeConfig,
  ResolvedNodeSettings,
  RunState,
  TemplateContext,
  WorkflowConfig,
} from "../types.ts";

/** Parameter bag passed to every node executor function. */
export interface EngineContext {
  config: WorkflowConfig;
  state: RunState;
  output: OutputManager;
  options: EngineOptions;
  userInput: UserInput;
  /** Build template context for a given node (with optional loop iteration). */
  buildContext: (nodeId: string, loopIteration?: number) => TemplateContext;
  /** The run's working directory (worktree path or "."). Artifact I/O and the
   * FR-E50 guardrail are scoped to it. */
  workDir: string;
  /** The working tree THIS node's subprocesses run in. Equals `workDir` unless
   * the node declares `isolation: worktree` (FR-E91), in which case it is the
   * node's own worktree and the context's artifact paths are absolute. */
  nodeWorkDir: string;
  /** Workflow folder (containing `workflow.yaml`). FR-S47/FR-E9: threaded into
   * state-path calls so runs land under `<workflowDir>/runs/<run-id>` regardless
   * of project layout. */
  workflowDir: string;
  /** Per-run phase registry (FR-E59). Threaded to
   * every `getNodeDir`/`buildTaskPaths` call so two back-to-back
   * `Engine.run()` calls in one Deno process keep their mappings isolated. */
  phaseRegistry: PhaseRegistry;
  /** Durable lifecycle journal for this run. */
  journal?: RunJournalWriter;
  /** FR-E91: whether the FR-E50 guardrail brackets THIS node. False while a
   * level runs its nodes concurrently, where one bracket around the level
   * replaces the per-node ones. */
  nodeGuardrail: boolean;
  /** FR-E37: write scopes the scope check must forgive for a node — the run's
   * own artifact directory plus the scopes of every OTHER node sharing this
   * node's tree right now. The check compares repository-wide snapshots, so
   * both land inside the node's bracket; forgiving them is what stops one
   * node failing for another's file. */
  forgivenScopes?: (nodeId: string) => readonly string[];
  /** Mark a node as running and publish optional lifecycle callback. */
  nodeStarted: (nodeId: string) => Promise<void>;
  /** Mark a node as completed and publish optional lifecycle callback. */
  nodeCompleted: (
    nodeId: string,
    costUsd?: number,
    result?: string,
  ) => Promise<void>;
  /** Mark a node as failed and publish optional lifecycle callback. */
  nodeFailed: (
    nodeId: string,
    error: string,
    errorCategory?: ErrorCategory,
  ) => Promise<void>;
  /** Mark a node as waiting and publish optional lifecycle callback. */
  nodeWaiting: (
    nodeId: string,
    sessionId: string,
    questionJson: string,
  ) => Promise<void>;
}

/** Run an agent node: invoke Claude CLI, handle HITL if triggered, save logs. */
export async function executeAgentNode(
  eng: EngineContext,
  nodeId: string,
  node: NodeConfig,
  wasWaiting = false,
): Promise<AgentResult | null> {
  const ctx = eng.buildContext(nodeId);
  const settings = node.settings as ResolvedNodeSettings;
  const hitlConfig = isHitlConfigured(eng.config.defaults?.hitl)
    ? eng.config.defaults.hitl
    : undefined;
  const runtimeConfig = resolveRuntimeConfig({
    defaults: eng.config.defaults,
    node,
  });
  const toolFilter = resolveToolFilter(node, eng.config.defaults);
  const cwd = eng.nodeWorkDir !== "." ? eng.nodeWorkDir : undefined;

  // Resume path: node was waiting for human reply
  if (wasWaiting) {
    await eng.journal?.append({ kind: "attempt_started", node_id: nodeId });
    if (!hitlConfig) {
      await eng.nodeFailed(
        nodeId,
        "HITL detected but defaults.hitl not configured in workflow.yaml",
        "unknown",
      );
      return null;
    }
    const result = await handleAgentHitl({
      mode: "resume",
      nodeId,
      hitlConfig,
      state: eng.state,
      workflowDir: eng.workflowDir,
      node,
      ctx,
      settings,
      runtime: runtimeConfig.runtime,
      runtimeArgs: runtimeConfig.args,
      permissionMode: runtimeConfig.permissionMode,
      model: runtimeConfig.model,
      reasoningEffort: runtimeConfig.reasoningEffort,
      allowedTools: toolFilter.allowedTools,
      disallowedTools: toolFilter.disallowedTools,
      runtimeAdapter: eng.options.runtimeAdapter,
      output: eng.output,
      cwd,
      maxTurns: resolveBudget(node, eng.config.defaults)?.max_turns,
      processRegistry: eng.options.processRegistry,
      nodeFailed: eng.nodeFailed,
      nodeWaiting: eng.nodeWaiting,
    });
    await appendAttemptCompleted(eng.journal, nodeId, result);
    return result;
  }

  // Normal path: run agent
  // Verbose: resolve and show input artifacts
  const inputArtifacts = await resolveInputArtifacts(ctx.input, eng.workDir);
  eng.output.verboseInputs(nodeId, inputArtifacts);

  const streamLogPath = `${workPath(ctx.workDir, ctx.node_dir)}/stream.log`;

  // FR-E50: wrap runAgent in worktree-isolation guardrail. Snapshots main
  // tree before/after; if the agent wrote files outside workDir and outside
  // node.allowed_paths, roll them back and fail the node.
  await eng.journal?.append({ kind: "attempt_started", node_id: nodeId });
  const { result, leak } = await runWithGuardrail(
    {
      repoRoot: Deno.cwd(),
      workDir: eng.workDir,
      allowedPaths: node.allowed_paths ?? [],
      nodeId,
      log: (m) => eng.output.warn(m),
      // FR-E91: off while the level runs concurrently — the level bracket
      // owns the check there.
      enabled: eng.nodeGuardrail,
    },
    () =>
      runAgent({
        forgivenScopes: eng.forgivenScopes,
        node,
        ctx,
        settings,
        runtime: runtimeConfig.runtime,
        runtimeArgs: runtimeConfig.args,
        permissionMode: runtimeConfig.permissionMode,
        model: runtimeConfig.model,
        reasoningEffort: runtimeConfig.reasoningEffort,
        allowedTools: toolFilter.allowedTools,
        disallowedTools: toolFilter.disallowedTools,
        hitlConfig,
        runtimeAdapter: eng.options.runtimeAdapter,
        output: eng.output,
        nodeId,
        streamLogPath,
        verbosity: eng.options.verbosity,
        cwd,
        maxTurns: resolveBudget(node, eng.config.defaults)?.max_turns,
        processRegistry: eng.options.processRegistry,
      }),
  );

  if (leak !== undefined) {
    await eng.nodeFailed(nodeId, leak.message, "scope_violation");
    const failed: AgentResult = {
      ...result,
      success: false,
      error: leak.message,
      error_category: "scope_violation",
    };
    await appendAttemptCompleted(eng.journal, nodeId, failed);
    return failed;
  }

  if (!result.success) {
    await eng.nodeFailed(
      nodeId,
      result.error ?? "Agent failed",
      result.error_category ?? "unknown",
    );
    await appendAttemptCompleted(eng.journal, nodeId, result);
    return result;
  }

  // FR-S28: per-agent reflection-memory commit-step enforcement. After a
  // successful agent run inside a worktree, any path matching the
  // configured `defaults.memory_paths` globs MUST be either unchanged or
  // committed by the agent itself. Loop-body agents may opt out via
  // `memory_commit_deferred: true` on the node.
  const memoryPaths = eng.config.defaults?.memory_paths ?? [];
  if (
    eng.nodeWorkDir !== "." &&
    memoryPaths.length > 0 &&
    node.memory_commit_deferred !== true
  ) {
    // The node's own tree, not the run's: an isolated node edits memory there.
    const dirtyMemory = await findDirtyMemoryFiles(
      eng.nodeWorkDir,
      memoryPaths,
    );
    if (dirtyMemory.length > 0) {
      const msg = formatMemoryViolation(nodeId, dirtyMemory);
      eng.output.warn(msg);
      await eng.nodeFailed(nodeId, msg, "scope_violation");
      const failed: AgentResult = {
        ...result,
        success: false,
        error: msg,
        error_category: "scope_violation",
      };
      await appendAttemptCompleted(eng.journal, nodeId, failed);
      return failed;
    }
  }

  // FR-L35 / hitl-via-engine-mcp: HITL request was captured by the engine's
  // `onToolUseObserved` observer in agent.ts (replaces the legacy
  // `permission_denials` AskUserQuestion path). Route to the handler when
  // present.
  if (result.hitl_question && result.output) {
    if (!hitlConfig) {
      await eng.nodeFailed(
        nodeId,
        "Agent called request_human_input but defaults.hitl not configured in workflow.yaml",
        "unknown",
      );
      return null;
    }
    const hitlResult = await handleAgentHitl({
      mode: "detect",
      nodeId,
      hitlQuestion: result.hitl_question,
      agentSessionId: result.output.session_id,
      hitlConfig,
      state: eng.state,
      workflowDir: eng.workflowDir,
      node,
      ctx,
      settings,
      runtime: runtimeConfig.runtime,
      runtimeArgs: runtimeConfig.args,
      permissionMode: runtimeConfig.permissionMode,
      model: runtimeConfig.model,
      reasoningEffort: runtimeConfig.reasoningEffort,
      allowedTools: toolFilter.allowedTools,
      disallowedTools: toolFilter.disallowedTools,
      runtimeAdapter: eng.options.runtimeAdapter,
      output: eng.output,
      cwd,
      maxTurns: resolveBudget(node, eng.config.defaults)?.max_turns,
      processRegistry: eng.options.processRegistry,
      nodeFailed: eng.nodeFailed,
      nodeWaiting: eng.nodeWaiting,
    });
    await appendAttemptCompleted(eng.journal, nodeId, hitlResult);
    return hitlResult;
  }

  if (result.session_id) {
    eng.state.nodes[nodeId].session_id = result.session_id;
  }
  eng.state.nodes[nodeId].continuations = result.continuations;

  // Save agent log (JSON output + JSONL transcript)
  if (result.output) {
    const runDir = workPath(ctx.workDir, ctx.run_dir);
    await saveAgentLog(runDir, nodeId, result.output);
  }

  // FR-E96: the node's answer — the `after` hook's stdout when it declared
  // one, the agent's final message otherwise. Written beside the artifacts so
  // a `join` can read it as a file, patch or verdict alike.
  if (result.success) await persistAnswer(ctx, result.answer ?? "");

  await appendAttemptCompleted(eng.journal, nodeId, result);
  return result;
}

/** Merge inputs by copying each input directory into the merge node's output dir. */
export async function executeMergeNode(
  eng: EngineContext,
  nodeId: string,
  node: NodeConfig,
): Promise<boolean> {
  const nodeDir = workPath(
    eng.workDir,
    getNodeDir(eng.state.run_id, nodeId, eng.workflowDir, eng.phaseRegistry),
  );
  await Deno.mkdir(nodeDir, { recursive: true });

  // Copy input directories as subdirectories
  for (const inputId of node.inputs ?? []) {
    const inputDir = workPath(
      eng.workDir,
      getNodeDir(
        eng.state.run_id,
        inputId,
        eng.workflowDir,
        eng.phaseRegistry,
      ),
    );
    const targetDir = `${nodeDir}/${inputId}`;
    try {
      await copyDir(inputDir, targetDir);
    } catch (err) {
      // A node that produced no artifacts leaves no directory — that is the
      // one benign case. Everything else (permissions, full disk, unreadable
      // file) used to be swallowed by a bare `catch`, so a merge node
      // reported success while silently dropping its inputs.
      if (!(err instanceof Deno.errors.NotFound)) {
        throw new Error(
          `Merge node '${nodeId}': failed to copy input '${inputId}' from ${inputDir}: ${
            (err as Error).message
          }`,
        );
      }
      eng.output.status(
        nodeId,
        `input '${inputId}' produced no artifacts — nothing to merge`,
      );
    }
  }

  return true;
}

/** Delegate to runLoop(), then record iteration count and failure state. */
export async function executeLoopNode(
  eng: EngineContext,
  nodeId: string,
  loopNode: NodeConfig,
): Promise<boolean> {
  const hitlConfig = isHitlConfigured(eng.config.defaults?.hitl)
    ? eng.config.defaults.hitl
    : undefined;
  const cwd = eng.nodeWorkDir !== "." ? eng.nodeWorkDir : undefined;

  const result = await runLoop({
    loopNodeId: nodeId,
    config: eng.config,
    state: eng.state,
    budgetUsd: eng.options.budget_usd,
    processRegistry: eng.options.processRegistry,
    runtimeAdapter: eng.options.runtimeAdapter,
    // Body-node HITL takes the same route as a top-level agent node
    // (executeAgentNode above): ask the human, poll, resume the session.
    // Returning null obliges this router to have recorded the cause on the
    // node first — see `LoopRunOptions.onHitl`. Every early exit below does.
    onHitl: async (bodyNodeId, bodyResult, iteration) => {
      const bodyNode = loopNode.nodes?.[bodyNodeId];
      if (!bodyNode || !bodyResult.hitl_question || !bodyResult.output) {
        await eng.nodeFailed(
          bodyNodeId,
          `Cannot route HITL for body node '${bodyNodeId}': it is not declared under loop '${nodeId}' or its turn carried no session to resume`,
          "unknown",
        );
        return null;
      }
      if (!hitlConfig) {
        await eng.nodeFailed(
          bodyNodeId,
          "Agent called request_human_input but defaults.hitl not configured in workflow.yaml",
          "unknown",
        );
        return null;
      }
      const runtimeConfig = resolveRuntimeConfig({
        defaults: eng.config.defaults,
        node: bodyNode,
        parent: loopNode,
      });
      const toolFilter = resolveToolFilter(
        bodyNode,
        eng.config.defaults,
        loopNode,
      );
      return await handleAgentHitl({
        mode: "detect",
        nodeId: bodyNodeId,
        hitlQuestion: bodyResult.hitl_question,
        agentSessionId: bodyResult.output.session_id,
        hitlConfig,
        state: eng.state,
        workflowDir: eng.workflowDir,
        node: bodyNode,
        ctx: eng.buildContext(bodyNodeId, iteration),
        settings: bodyNode.settings as ResolvedNodeSettings,
        runtime: runtimeConfig.runtime,
        runtimeArgs: runtimeConfig.args,
        permissionMode: runtimeConfig.permissionMode,
        model: runtimeConfig.model,
        reasoningEffort: runtimeConfig.reasoningEffort,
        allowedTools: toolFilter.allowedTools,
        disallowedTools: toolFilter.disallowedTools,
        runtimeAdapter: eng.options.runtimeAdapter,
        output: eng.output,
        cwd,
        maxTurns: resolveBudget(bodyNode, eng.config.defaults, loopNode)
          ?.max_turns,
        processRegistry: eng.options.processRegistry,
        nodeFailed: eng.nodeFailed,
        nodeWaiting: eng.nodeWaiting,
      });
    },
    buildCtx: (bodyNodeId, iteration) =>
      eng.buildContext(bodyNodeId, iteration),
    onNodeStart: (id, iteration) =>
      eng.output.status(id, `STARTED (iteration ${iteration})`),
    onNodeComplete: (id, iteration, result) => {
      if (result.success) {
        eng.output.status(id, "COMPLETED");
        if (result.output) {
          eng.output.nodeResult(id, result.output);
          if (id in eng.state.nodes) {
            eng.state.nodes[id].result = resultExcerpt(
              result.output.result ?? "",
            );
          }
        }
      } else {
        eng.output.nodeFailed(id, result.error ?? "Failed");
      }

      // Save agent log for successful loop body nodes (iteration-qualified)
      if (result.success && result.output) {
        const runDir = workPath(
          eng.workDir,
          getRunDir(eng.state.run_id, eng.workflowDir),
        );
        const iterNodeId = `${id}-iter-${iteration}`;
        saveAgentLog(runDir, iterNodeId, result.output).catch((err) => {
          eng.output.warn(
            `Failed to save log for ${iterNodeId}: ${(err as Error).message}`,
          );
        });
      }
    },
    onIteration: (iteration, maxIterations) =>
      eng.output.loopIteration(nodeId, iteration, maxIterations),
    output: eng.output,
    verbosity: eng.options.verbosity,
    cwd: eng.workDir !== "." ? eng.workDir : undefined,
    nodeStarted: async (id) => {
      await eng.nodeStarted(id);
    },
    nodeCompleted: async (id, costUsd, result) => {
      await eng.nodeCompleted(id, costUsd, result);
    },
    nodeFailed: async (id, error, errorCategory) => {
      await eng.nodeFailed(id, error, errorCategory);
    },
    onIterationStarted: async (iteration, maxIterations) => {
      await eng.journal?.append({
        kind: "loop_iteration_started",
        loop_node_id: nodeId,
        iteration,
        max_iterations: maxIterations,
      });
    },
    onIterationCompleted: async (iteration) => {
      await eng.journal?.append({
        kind: "loop_iteration_completed",
        loop_node_id: nodeId,
        iteration,
      });
    },
    onIterationFailed: async (iteration, error, errorCategory) => {
      await eng.journal?.append({
        kind: "loop_iteration_failed",
        loop_node_id: nodeId,
        iteration,
        error,
        error_category: errorCategory,
      });
    },
    onAttemptStarted: async (id, iteration) => {
      await eng.journal?.append({
        kind: "attempt_started",
        node_id: id,
        iteration,
      });
    },
    onAttemptCompleted: async (id, iteration, result) => {
      await appendAttemptCompleted(eng.journal, id, result, iteration);
    },
  });

  if (!result.success) {
    await eng.nodeFailed(
      nodeId,
      result.error ?? "Loop failed",
      result.error_category ?? "unknown",
    );
  }
  eng.state.nodes[nodeId].iteration = result.iterations;

  return result.success;
}

/** Prompt the user for input and abort the run if response matches abort_on. */
/**
 * Run a `type: command` node (FR-E88): execute the shell command, then apply
 * the node's `validate` rules once.
 *
 * Unlike an agent node there is no continuation loop — a failed validation on
 * a deterministic command means the command itself is wrong, and re-running it
 * unchanged would produce the same artifacts.
 */
export async function executeCommandNode(
  eng: EngineContext,
  nodeId: string,
  node: NodeConfig,
): Promise<boolean> {
  const ctx = eng.buildContext(nodeId);
  const settings = node.settings as ResolvedNodeSettings;
  const cwd = eng.nodeWorkDir !== "." ? eng.nodeWorkDir : undefined;

  await eng.journal?.append({ kind: "attempt_started", node_id: nodeId });

  const result = await runCommandNode(node, ctx, settings, cwd);
  eng.output.status(nodeId, `$ ${result.resolved} → exit ${result.code}`);

  if (!result.success) {
    await eng.nodeFailed(
      nodeId,
      result.error ?? `Command failed with exit ${result.code}`,
      result.error_category,
    );
    return false;
  }

  const rules = node.validate ?? [];
  if (rules.length > 0) {
    const results = await runValidations(rules, ctx, cwd);
    if (!allPassed(results)) {
      await eng.nodeFailed(
        nodeId,
        `Command succeeded but validation failed:\n${formatFailures(results)}`,
        "validation_failed",
      );
      return false;
    }
  }

  // FR-E96: the `after` hook's stdout is the node's answer when it declares
  // one — the same rule an agent node follows — and the command's own stdout
  // otherwise.
  let answer = result.stdout;
  if (node.after) {
    try {
      answer = await runShellCommand(
        interpolate(node.after, ctx, cwd ?? ctx.workDir),
        "after hook",
        cwd,
      );
    } catch (err) {
      await eng.nodeFailed(
        nodeId,
        `After hook failed: ${(err as Error).message}`,
        "hook_failure",
      );
      return false;
    }
  }
  await persistAnswer(ctx, answer);

  return true;
}

/**
 * Run a `type: hitl` node (FR-E93): ask a human through the workflow's HITL
 * transport and wait for the answer.
 *
 * An abort answer aborts the whole run, matching `type: human` — the node
 * exists to let a human stop the workflow, and a stop that only failed one
 * node would leave the rest of the level running.
 */
export async function executeHitlNode(
  eng: EngineContext,
  nodeId: string,
  node: NodeConfig,
): Promise<boolean> {
  const ctx = eng.buildContext(nodeId);
  const result = await runHitlNode(
    node,
    ctx,
    eng.config.defaults?.hitl,
    {
      nodeId,
      // Absolute, for the same reason handleAgentHitl resolves it: the
      // ask/check scripts run with cwd inside the worktree, where the
      // workDir-relative run directory does not exist.
      runDir: resolve(getRunDir(eng.state.run_id, eng.workflowDir)),
      cwd: eng.workDir !== "." ? eng.workDir : undefined,
      output: eng.output,
    },
  );

  if (result.aborted) {
    markRunAborted(eng.state);
  }
  if (!result.success) {
    await eng.nodeFailed(
      nodeId,
      result.error ?? "HITL node failed",
      result.error_category,
    );
    return false;
  }

  return true;
}

export async function executeHumanNode(
  eng: EngineContext,
  nodeId: string,
  node: NodeConfig,
): Promise<boolean> {
  const ctx = eng.buildContext(nodeId);
  const result = await runHuman(node, ctx, eng.userInput);

  if (result.aborted) {
    markRunAborted(eng.state);
    await eng.nodeFailed(
      nodeId,
      `Aborted by user (response: ${result.response})`,
      "aborted",
    );
    return false;
  }

  return result.success;
}

/** Recursively copy a directory. */
export async function copyDir(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const srcPath = `${src}/${entry.name}`;
    const destPath = `${dest}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}
