/**
 * @module
 * Main workflow engine: orchestrates node execution across DAG levels.
 * Handles config loading, worktree setup, state management, lock
 * acquisition, post-workflow hooks, and final summary output.
 * Entry point: {@link Engine.run}.
 */

import type {
  EngineOptions,
  ForkConfig,
  NodeConfig,
  RunState,
  TemplateContext,
  WorkflowConfig,
} from "../types.ts";
import type { AgentResult } from "./agent.ts";
import {
  collectAllNodeIds,
  DYNAMIC_BRANCH,
  extractWorktreeDisabled,
  findNodeConfig,
  loadConfig,
  resolveBranchMembership,
  resolveBudget,
} from "../config/config.ts";
import { resolveRuntimeConfig } from "@korchasa/ai-ide-cli/runtime";
import { buildDependencies, buildLevels } from "./dag.ts";
import { readAnswer } from "./answer.ts";
import { evaluateShellPredicate } from "./predicate.ts";
import { GroupGuardrail } from "../isolation/guardrail.ts";
import {
  branchTreeKey,
  effectiveAllowedPaths,
  isolatedBranches,
} from "../isolation/branch-scope.ts";
import {
  branchContext,
  type BranchItem,
  ensureItemDir,
  resolveBranchItems,
} from "./branch.ts";
import { terminalInput } from "./human.ts";
import type { UserInput } from "./human.ts";
import { acquireLock, defaultLockPath, releaseLock } from "../state/lock.ts";
import { onShutdown } from "../process-registry.ts";
import { OutputManager } from "../output.ts";
import type { RunSummary } from "../output.ts";
import { collectPostWorkflowNodes, runFailureHook } from "./post-workflow.ts";
import {
  buildTaskPaths,
  createRunState,
  generateRunId,
  getNodeDir,
  getRunDir,
  isNodeCompleted,
  markNodeFailed,
  markRunCompleted,
  markRunFailed,
  PhaseRegistry,
  workPath,
} from "../state/state.ts";
import {
  nodeDeclarationPayload,
  replayRunJournal,
  resultExcerpt,
  RunJournalWriter,
} from "../state/run-journal.ts";
import {
  isNodeLifecycleCallbackError,
  nodeCompleted,
  nodeFailed,
  nodeSkipped,
  nodeStarted,
  nodeWaiting,
} from "./node-lifecycle.ts";
import { interpolate } from "../config/template.ts";
import type { EngineContext } from "./node-dispatch.ts";
import {
  executeAgentNode,
  executeCommandNode,
  executeHitlNode,
  executeHumanNode,
  executeLoopNode,
  executeMergeNode,
} from "./node-dispatch.ts";
import {
  copyIgnoredIntoWorktree,
  createNodeWorktree,
  createWorktree,
  pinDetachedHead,
  removeWorktree,
  resolveExistingWorktreePath,
  resolveTreeHead,
  worktreeKey,
} from "../isolation/worktree.ts";
import { isolatedContext } from "../isolation/node-isolation.ts";

/** Main workflow engine. Orchestrates node execution across DAG levels. */
export class Engine {
  private config!: WorkflowConfig;
  private state!: RunState;
  private output: OutputManager;
  private options: EngineOptions;
  private userInput: UserInput;
  private startTime = 0;
  /** Working directory: worktree path or "." when worktree disabled. */
  private workDir = ".";
  /** Workflow folder = directory containing `workflow.yaml` (FR-S47).
   * Derived from `options.config_path` once at construction. Threaded into
   * every state-path call so runs land under `<workflowDir>/runs/<run-id>`
   * regardless of layout. */
  private workflowDir: string;
  /** Durable lifecycle journal for the current run. */
  private journal?: RunJournalWriter;
  /** Per-run phase registry (FR-E59). Built at the top
   * of `runWithLock` from the loaded config and threaded through path
   * helpers so back-to-back runs in one Deno process keep their `nodeId →
   * phase` mappings isolated. Defaults to an empty registry until the run
   * starts (so dry-run path computations behave as before). */
  private phaseRegistry: PhaseRegistry = PhaseRegistry.empty();
  /** Nodes this run did not take, and why. Kept apart from the `skipped`
   * node status, which also covers `--skip`/`--only`: those are an operator
   * saying "I already handled this", and their dependents must still run.
   * `when` is an FR-E89 gate that was not satisfied, `failed` a node that
   * failed where the run carries on regardless (a branch the group absorbs,
   * or the outcome wave), `upstream` a node whose own input was untaken. The
   * reason is carried because a dependent's skip message names it. */
  private untaken = new Map<string, "when" | "failed" | "upstream">();

  /** FR-E99: verdict of the graph wave, and the value `run_on` and
   * `{{run.outcome}}` are evaluated against. `pending` until the graph has
   * finished, so a node inside the graph cannot read its own run's verdict. */
  private runOutcome: "pending" | "success" | "failure" = "pending";
  /** FR-E91: true while a concurrent level runs inside one guardrail bracket.
   * Nodes then skip their own bracket — see `runNodes`. */
  private levelGuardrailActive = false;
  /** FR-E95: groups whose join must not run — a branch of each failed under
   * `failure_mode: all_or_nothing`. */
  private failedGroups = new Set<string>();
  /** FR-E37: write scopes of the nodes running right now, by node id. */
  private runningScopes = new Map<string, readonly string[]>();
  /** FR-E37: the same scopes for every node that has been inside the current
   * bracket, kept until the last of them leaves — a node that finished early
   * still wrote into the tree the others are being checked against. */
  private bracketScopes = new Map<string, readonly string[]>();
  /** FR-E95: node → its branch, resolved once per run from the config. */
  private membership:
    | Map<string, { group: string; branch: string }>
    | undefined;
  /** FR-E91: branches that own a worktree, and the tree each currently holds. */
  private isolated: Set<string> | undefined;
  private branchTrees = new Map<string, string>();
  /** FR-E95: branch names a runtime fork expanded into, per group. */
  private expandedBranches = new Map<string, string[]>();
  /** FR-E97: branch sets recovered from the journal of a resumed run, by the
   * id of the node that forked. A resume must run the branches the first
   * attempt expanded, not whatever the source file holds now. */
  private journalledBranches = new Map<string, BranchItem[]>();

  /** Create an engine instance with the given options and optional user-input provider. */
  constructor(options: EngineOptions, userInput: UserInput = terminalInput) {
    this.options = options;
    this.output = new OutputManager(options.verbosity);
    this.userInput = userInput;
    this.workflowDir = deriveWorkflowDir(options.config_path);
  }

  /** Run the workflow. Main entry point. */
  async run(): Promise<RunState> {
    this.startTime = Date.now();
    // Per-run state, cleared here so a host that reuses one Engine for
    // sequential runs (FR-E59) does not carry a previous run's failed groups
    // into this one's verdict. `untaken` matters most on a resume: a node it
    // still records as failed would have its dependants skipped even after
    // the node re-runs and succeeds.
    this.failedGroups.clear();
    this.runningScopes.clear();
    this.bracketScopes.clear();
    this.untaken.clear();
    this.journalledBranches.clear();

    // Phase 1: Minimal YAML pre-parse — extract worktree_disabled
    const rawYaml = await Deno.readTextFile(this.options.config_path);
    const worktreeDisabled = extractWorktreeDisabled(rawYaml);

    // Dry-run: load config from CWD (no worktree needed), print plan, exit
    if (this.options.dry_run) {
      this.config = await loadConfig(
        this.options.config_path,
        undefined,
        (m) => this.output.warn(m),
        (m) => this.output.status("config", m),
      );
      const levels = buildLevels(this.config);
      const labels: Record<string, string> = {};
      for (const [id, node] of Object.entries(this.config.nodes)) {
        labels[id] = node.label;
      }
      const postWorkflowNodeIds = collectPostWorkflowNodes(this.config.nodes);
      const filteredLevels = levels
        .map((level) => level.filter((id) => !postWorkflowNodeIds.includes(id)))
        .filter((level) => level.length > 0);
      const runOnMap: Record<string, string> = {};
      for (const id of postWorkflowNodeIds) {
        const node = this.config.nodes[id];
        if (node.run_on) runOnMap[id] = node.run_on;
      }
      this.output.dryRunPlan(
        filteredLevels,
        labels,
        postWorkflowNodeIds,
        runOnMap,
      );
      return this.createDryRunState(levels);
    }

    // Phase 2: Set up workDir (worktree or CWD)
    // Generate runId once — shared between worktree path and run state
    const runLabel = this.options.args.prompt?.slice(0, 20) ?? undefined;
    const runId = this.options.run_id ?? generateRunId(runLabel);

    // FR-E57: a workflow.yaml passed without a directory prefix collapses
    // workflowDir to "." and would put the worktree at repo-root
    // ./runs/<id>/worktree, not covered by .gitignore. The mandatory
    // positional <workflow> argument introduced by FR-S47/FR-E53 makes
    // this combination obsolete in normal use; refuse it explicitly.
    if (!worktreeDisabled && this.workflowDir === ".") {
      throw new Error(
        "worktree mode requires workflow.yaml to live inside a workflow folder " +
          "(FR-S47/FR-E53); pass `<workflow>` positional argument or set " +
          "worktree_disabled: true",
      );
    }

    if (this.options.resume && this.options.run_id) {
      // Resume: reuse existing worktree if it exists.
      const existing = !worktreeDisabled
        ? resolveExistingWorktreePath(this.options.run_id, this.workflowDir)
        : undefined;
      if (existing) {
        this.workDir = existing.path;
        this.output.status("engine", `RESUME worktree: ${this.workDir}`);
      } else {
        this.workDir = ".";
      }
    } else if (!worktreeDisabled) {
      // New run: create worktree, then mirror gitignored files (FR-E58)
      this.output.status("engine", "Creating worktree...");
      this.workDir = await createWorktree(runId, this.workflowDir);
      this.output.status("engine", `Worktree: ${this.workDir}`);
      await copyIgnoredIntoWorktree(
        this.workDir,
        this.output,
        ".",
        this.workflowDir,
      );
    } else {
      this.workDir = ".";
    }

    // Phase 3: Load config from workDir
    const configPath = this.workDir === "."
      ? this.options.config_path
      : `${this.workDir}/${this.options.config_path}`;
    this.config = await loadConfig(
      configPath,
      this.workDir === "." ? undefined : this.workDir,
      (m) => this.output.warn(m),
      (m) => this.output.status("config", m),
    );
    // Merge env overrides
    const env = { ...this.config.env, ...this.options.env_overrides };

    // Build execution levels
    const levels = buildLevels(this.config);

    // Initialize or resume state
    if (this.options.resume && this.options.run_id) {
      const runDir = getRunDir(this.options.run_id, this.workflowDir);
      const replay = await replayRunJournal(runDir);
      this.state = replay.state;
      for (const event of replay.events) {
        if (event.kind !== "branches_expanded") continue;
        this.journalledBranches.set(event.node_id, event.branches);
        this.expandedBranches.set(
          event.group,
          event.branches.map((branch) => branch.key),
        );
      }
      this.journal = await RunJournalWriter.open(runDir, this.options.run_id);
      this.state.status = "running";
      delete this.state.completed_at;
      // Env values are deliberately absent from the journal (secrets), so a
      // resumed run re-derives them from the live environment: workflow
      // `env:` block plus `--env` / `.env` overrides, exactly as a fresh run
      // does. A key that disappeared since the original run now fails fast at
      // `{{env.X}}` interpolation instead of silently resolving to stale or
      // redacted text.
      this.state.env = env;
    } else {
      const allNodeIds = collectAllNodeIds(this.config);
      this.state = createRunState(
        runId,
        this.options.config_path,
        allNodeIds,
        this.options.args,
        env,
      );
      this.journal = await RunJournalWriter.open(
        getRunDir(runId, this.workflowDir),
        runId,
      );
    }

    // FR-E49: prevent Claude CLI auto-update during this run.
    const origAutoupdaterVal = Deno.env.get("DISABLE_AUTOUPDATER");
    Deno.env.set("DISABLE_AUTOUPDATER", "1");

    // Acquire per-workflow lock (FR-E54) — serializes runs against the same
    // workflow folder; distinct workflow folders run in parallel.
    const lockPath = this.options.lock_path ??
      defaultLockPath(this.workflowDir);
    await acquireLock(lockPath, this.state.run_id);

    // Register shutdown callbacks for signal-initiated cleanup;
    // disposers remove them after normal completion to prevent leak in loops
    const disposers = [
      onShutdown(() => releaseLock(lockPath)),
      onShutdown(async () => {
        if (this.state.status === "running") {
          markRunFailed(this.state);
          await this.recordRunTerminal("run_failed");
        }
      }),
    ];

    try {
      return await this.runWithLock(levels, lockPath);
    } finally {
      for (const dispose of disposers) dispose();
      await releaseLock(lockPath);
      // FR-E49: restore DISABLE_AUTOUPDATER to its pre-run value.
      if (origAutoupdaterVal === undefined) {
        Deno.env.delete("DISABLE_AUTOUPDATER");
      } else {
        Deno.env.set("DISABLE_AUTOUPDATER", origAutoupdaterVal);
      }
    }
  }

  /** Execute the workflow after lock is acquired. */
  private async runWithLock(
    levels: string[][],
    _lockPath: string,
  ): Promise<RunState> {
    // FR-E9 / FR-E59: build a fresh per-run phase
    // registry from the loaded config. Replacing any prior instance is
    // mandatory — a host that drives several Engine.run() calls back-to-back
    // would otherwise inherit the previous run's mapping.
    this.phaseRegistry = PhaseRegistry.fromConfig(this.config);

    // Create run directory structure
    await this.ensureRunDirs(levels);
    if (!this.options.resume) {
      await this.emitBootstrapJournal(levels);
    }
    // FR-E99: every engine invocation over this run is a fact, the fresh one
    // included. `run_started` is emitted once; counting these is what tells a
    // resumed run which attempt it is.
    const attempt = (this.state.attempt ?? 0) + 1;
    this.state.attempt = attempt;
    await this.journal?.append({ kind: "run_attempt_started", attempt });

    await this.captureCliVersion();

    // FR-E47: pre-execution budget check (applies to fresh and resumed runs).
    // Wrapped so an over-budget resume still records a terminal fact — an
    // unwrapped throw here escaped `run()` past the status bookkeeping and
    // left the journal's last word as `run_started`, i.e. a run that looks
    // alive forever.
    try {
      this.checkWorkflowBudget("resume");
    } catch (err) {
      markRunFailed(this.state);
      await this.recordRunTerminal("run_failed");
      throw err;
    }
    // FR-E47: one-time warnings before the level loop
    this.warnBudgetCaveats();

    // Run prepare_command before level loop (skip on resume)
    const prepareCmd = this.config.defaults?.prepare_command ?? "";
    const cwd = this.workDir !== "." ? this.workDir : undefined;
    if (!this.options.resume && prepareCmd) {
      await runPrepareCommand(
        prepareCmd,
        getRunDir(this.state.run_id, this.workflowDir),
        this.state.run_id,
        this.state.env,
        this.state.args,
        this.output,
        cwd,
        this.workflowDir,
      );
    }

    // FR-E99: the nodes that wait for the run's verdict. They are scheduled by
    // the same `runNodes` as the graph, so their order comes from the shared
    // dependency map and needs no topological sort of its own.
    const postWorkflowNodeIds = collectPostWorkflowNodes(this.config.nodes);

    // Filter post-workflow nodes out of regular DAG levels
    const filteredLevels = levels
      .map((level) => level.filter((id) => !postWorkflowNodeIds.includes(id)))
      .filter((level) => level.length > 0);

    // Ensure post-workflow node dirs exist
    for (const nodeId of postWorkflowNodeIds) {
      await Deno.mkdir(
        workPath(
          this.workDir,
          getNodeDir(
            this.state.run_id,
            nodeId,
            this.workflowDir,
            this.phaseRegistry,
          ),
        ),
        { recursive: true },
      );
    }

    // Execute the graph by readiness (FR-E97): every node whose own inputs
    // are done, not every node of the current level.
    let workflowSuccess = true;
    try {
      workflowSuccess = await this.runNodes(filteredLevels.flat());
    } catch (err) {
      workflowSuccess = false;
      this.output.error((err as Error).message);
    }

    // FR-E99: the outcome is known, so the nodes that wait on it become
    // runnable. Same scheduler, same gate — `run_on` and `when` are both
    // decided by `gateNode` now. The hook fires on its own condition, not on
    // the presence of such nodes (FR-E34).
    this.runOutcome = workflowSuccess ? "success" : "failure";
    if (!workflowSuccess) {
      await runFailureHook(
        this.config.defaults?.on_failure_script,
        this.output,
        cwd,
      );
    }
    if (postWorkflowNodeIds.length > 0) {
      await this.runNodes(postWorkflowNodeIds, {
        continueOnFailure: true,
        outcomeWave: true,
      });
    }

    // Finalize run state
    if (workflowSuccess) {
      markRunCompleted(this.state);
      await this.recordRunTerminal("run_completed");
    } else if (this.state.status === "aborted") {
      await this.recordRunTerminal("run_aborted");
    } else {
      markRunFailed(this.state);
      await this.recordRunTerminal("run_failed");
    }

    // Worktree cleanup: remove on success, preserve on failure for inspection.
    if (this.workDir !== ".") {
      if (workflowSuccess) {
        // FR-E51: pin detached HEAD as rescue branch BEFORE removal so any
        // commits made during the run survive worktree teardown.
        try {
          const rescue = await pinDetachedHead(
            this.workDir,
            this.state.run_id,
          );
          if (rescue !== undefined) {
            this.output.status(
              "engine",
              `Detached HEAD pinned: branch=${rescue} worktree=${this.workDir}`,
            );
          }
        } catch (err) {
          this.output.warn(
            `Failed to pin detached HEAD: ${(err as Error).message}`,
          );
        }
        try {
          await removeWorktree(this.workDir);
          this.output.status("engine", "Worktree removed (success)");
        } catch (err) {
          this.output.warn(
            `Failed to remove worktree: ${(err as Error).message}`,
          );
        }
      } else {
        this.output.status(
          "engine",
          `Worktree preserved for resume: ${this.workDir}`,
        );
      }
    }

    this.printSummary();
    return this.state;
  }

  /**
   * FR-E97: run the graph, starting each node when its own inputs are done.
   *
   * Levels are a picture of the graph, not a schedule. Under level execution a
   * one-node branch waits for its three-node sibling because they share a
   * level; here a node becomes runnable the moment the nodes it names in
   * `inputs` — and, for a `join`, every branch of its group — have finished.
   * `defaults.max_parallel` stays the global cap on how many run at once, and
   * with its default of 1 the order is the same as before, one node at a time.
   */
  private async runNodes(
    nodeIds: string[],
    opts: { continueOnFailure?: boolean; outcomeWave?: boolean } = {},
  ): Promise<boolean> {
    const deps = buildDependencies(this.config);
    const scheduled = new Set(nodeIds);
    const pending = new Set<string>();
    const satisfied = new Set<string>();
    for (const id of nodeIds) {
      // Resume: a node already completed in a previous attempt is a dependency
      // that is met, not work to redo — unless it asked to be reconsidered
      // every attempt (FR-E99).
      if (
        isNodeCompleted(this.state, id) && !this.rerunsThisAttempt(id, opts)
      ) {
        satisfied.add(id);
      } else pending.add(id);
    }

    const maxParallel = this.config.defaults?.max_parallel ?? 1;
    const cap = maxParallel > 0 ? maxParallel : Math.max(nodeIds.length, 1);
    // Only a run that can overlap nodes needs the shared bracket; at
    // max_parallel 1 the per-node guardrail in the dispatcher is exact.
    const guard = maxParallel !== 1 && this.workDir !== "."
      ? new GroupGuardrail({
        repoRoot: Deno.cwd(),
        workDir: this.workDir,
        log: (m) => this.output.warn(m),
      })
      : undefined;
    this.levelGuardrailActive = guard !== undefined;

    // FR-E37: a branch node with no write scope of its own runs in the tree
    // the whole run shares, and its check compares repository-wide snapshots.
    // Letting a sibling write while it runs would fail it for someone else's
    // file, so such a node runs alone. A branch that wants concurrency
    // declares `allowed_paths` and gets a tree of its own.
    const exclusive = (id: string): boolean => {
      const own = this.branchOf(id);
      return own !== undefined &&
        !this.branchIsolated(own.group, own.branch);
    };
    let exclusiveNode: string | undefined;

    const ready = (id: string): boolean =>
      [...(deps.get(id) ?? [])].every((dep) =>
        !scheduled.has(dep) || satisfied.has(dep)
      );

    const running = new Map<string, Promise<string>>();
    let failed = false;
    try {
      while (!failed && (pending.size > 0 || running.size > 0)) {
        let progressed = false;
        for (const id of [...pending].sort()) {
          if (running.size >= cap) break;
          if (exclusiveNode !== undefined) break;
          if (!ready(id)) continue;
          if (exclusive(id) && running.size > 0) continue;
          pending.delete(id);
          progressed = true;
          if (!await this.gateNode(id)) {
            // A skipped node still satisfies its dependents, exactly as a
            // completed one does — that is what `--skip` has always meant.
            satisfied.add(id);
            continue;
          }
          if (exclusive(id)) exclusiveNode = id;
          running.set(
            id,
            this.runScheduledNode(id, guard).then((ok) => {
              if (ok) satisfied.add(id);
              // FR-E34: a node of the outcome wave takes its own verdict down,
              // not the wave's — its siblings still run, and the run's status
              // stays the verdict the graph produced.
              else if (
                !opts.continueOnFailure && !this.absorbBranchFailure(id)
              ) {
                failed = true;
              }
              // A failure the run carries on past must not leave the graph
              // stalled: the failed node counts as finished, so whatever
              // waited on it is reached and skipped for want of its input
              // rather than left unreachable — an unreachable node makes the
              // loop below throw. Two cases qualify. FR-E95: a branch failure
              // the group absorbs, where the join is reached and, under
              // `all_or_nothing`, skipped there. FR-E34: any failure in the
              // outcome wave, which runs to the end by contract.
              const mode = this.branchFailureMode(id);
              const carriesOn = mode === "collect" ||
                mode === "all_or_nothing" ||
                opts.continueOnFailure === true;
              if (!ok && carriesOn) {
                satisfied.add(id);
                this.untaken.set(id, "failed");
              }
              return id;
            }),
          );
        }

        if (running.size === 0) {
          if (pending.size === 0) break;
          if (!progressed) {
            throw new Error(
              `Cannot resolve dependencies for nodes: ${
                [...pending].sort().join(", ")
              }`,
            );
          }
          continue;
        }

        const finished = await Promise.race(running.values());
        running.delete(finished);
        if (finished === exclusiveNode) exclusiveNode = undefined;
        // FR-E47: check on every completion so an over-budget run stops
        // without waiting for the rest of the graph.
        this.checkWorkflowBudget("runtime");
      }
    } finally {
      // A failure stops new starts but never abandons a running subprocess:
      // its node would otherwise report into state after the run finalised.
      await Promise.allSettled(running.values());
      this.levelGuardrailActive = false;
    }

    return !failed && this.failedGroups.size === 0;
  }

  /**
   * FR-E95: decide what a failed branch node does to the rest of the run.
   *
   * Returns true when the failure must NOT stop the scheduler: `collect`
   * hands the verdict to the join, and `all_or_nothing` lets the siblings
   * finish while marking the group failed, so its join is skipped and the run
   * still ends failed. `fail_fast` — the default, and every node outside a
   * group — returns false and stops the run as before.
   */
  private absorbBranchFailure(nodeId: string): boolean {
    const mode = this.branchFailureMode(nodeId);
    if (mode === "collect") return true;
    if (mode === "all_or_nothing") {
      const own = this.branchOf(nodeId);
      if (own) this.failedGroups.add(own.group);
      return true;
    }
    return false;
  }

  /** The failure mode governing a node, or undefined when it is in no group. */
  private branchFailureMode(
    nodeId: string,
  ): "fail_fast" | "collect" | "all_or_nothing" | undefined {
    const own = this.branchOf(nodeId);
    return own === undefined ? undefined : this.joinFailureMode(own.group);
  }

  /**
   * FR-E99: true when a completed node must be reconsidered in this wave.
   *
   * Only `run_on: every_attempt` opts in, and only across attempts — a node
   * that already completed in the CURRENT attempt is left alone, which is
   * what stops it from re-entering itself inside one invocation.
   */
  private rerunsThisAttempt(
    id: string,
    opts: { outcomeWave?: boolean },
  ): boolean {
    if (!opts.outcomeWave) return false;
    if (this.config.nodes[id]?.run_on !== "every_attempt") return false;
    return this.state.nodes[id]?.completed_attempt !== this.state.attempt;
  }

  /**
   * Decide whether a node that became ready actually runs.
   *
   * Returns false when the node is filtered out by `--skip` / `--only`, gated
   * off by its own `when` predicate (FR-E89), or downstream of a node that was
   * gated off. In every case the node is recorded as skipped before returning.
   */
  private async gateNode(id: string): Promise<boolean> {
    if (this.options.skip_nodes?.includes(id)) {
      await this.nodeSkipped(id);
      this.output.nodeSkipped(id, "skipped by --skip");
      return false;
    }
    if (
      this.options.only_nodes &&
      this.options.only_nodes.length > 0 &&
      !this.options.only_nodes.includes(id)
    ) {
      await this.nodeSkipped(id);
      this.output.nodeSkipped(id, "not in --only");
      return false;
    }

    // FR-E89: a node downstream of an untaken branch is itself untaken. Its
    // `{{input.<id>}}` references have no artifacts to resolve, so running it
    // could only fail — and only after spending an agent call to get there.
    const gatedInput = (this.config.nodes[id].inputs ?? []).find((inputId) =>
      this.untaken.has(inputId)
    );
    if (gatedInput !== undefined) {
      this.untaken.set(id, "upstream");
      await this.nodeSkipped(id);
      // Name what actually happened to the input: a failure the run carried
      // on past reads as a skip otherwise, and sends whoever is diagnosing
      // the run looking for a `when` gate that is not there.
      this.output.nodeSkipped(
        id,
        this.untaken.get(gatedInput) === "failed"
          ? `input '${gatedInput}' failed`
          : `input '${gatedInput}' was skipped`,
      );
      return false;
    }

    // FR-E95: `all_or_nothing` fails the whole group, so its join never runs
    // — the branches it would have merged are not all there.
    const joins = this.config.nodes[id].join;
    if (joins !== undefined && this.failedGroups.has(joins)) {
      await this.nodeSkipped(id);
      this.output.nodeSkipped(
        id,
        `group '${joins}' failed under failure_mode: all_or_nothing`,
      );
      return false;
    }

    // FR-E11 / FR-E99: a node that waits for the run's verdict is filtered by
    // it here, next to `when`, instead of in a scheduler of its own.
    const runOn = this.config.nodes[id].run_on;
    if (runOn !== undefined) {
      if (this.runOutcome === "pending") {
        throw new Error(
          `Node '${id}' declares run_on but was scheduled before the run outcome was known`,
        );
      }
      const wanted = runOn === "success" || runOn === "failure"
        ? runOn
        : undefined;
      if (wanted !== undefined && wanted !== this.runOutcome) {
        await this.nodeSkipped(id);
        this.output.nodeSkipped(
          id,
          `skipped: run_on=${runOn} but workflow ${
            this.runOutcome === "success" ? "succeeded" : "failed"
          }`,
        );
        return false;
      }
    }

    const when = this.config.nodes[id].when;
    if (when !== undefined) {
      const predicate = await evaluateShellPredicate(
        when,
        this.buildContext(id),
        this.workDir !== "." ? this.workDir : undefined,
      );
      if (!predicate.satisfied) {
        this.untaken.set(id, "when");
        await this.nodeSkipped(id);
        this.output.nodeSkipped(
          id,
          `when predicate exited ${predicate.code}${
            predicate.stderr.trim() ? `: ${predicate.stderr.trim()}` : ""
          }`,
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Run one scheduled node, inside the shared guardrail bracket when there is
   * one. Never throws: a node that dies takes its own verdict down, not the
   * scheduler's loop.
   */
  private async runScheduledNode(
    id: string,
    guard: GroupGuardrail | undefined,
  ): Promise<boolean> {
    // FR-E96: a join reads its group's answers as files, so they must be in
    // its artifact directory before it starts, not after.
    const group = this.config.nodes[id].join;
    if (group !== undefined) {
      try {
        await this.writeBranchManifest(id, group);
      } catch (err) {
        await this.nodeFailed(
          id,
          `Failed to collect branch answers: ${(err as Error).message}`,
          "unknown",
        );
        return false;
      }
    }
    if (guard) await guard.enter(id, this.config.nodes[id].allowed_paths ?? []);
    if (this.runningScopes.size === 0) this.bracketScopes.clear();
    const scope = this.config.nodes[id].allowed_paths ?? [];
    this.runningScopes.set(id, scope);
    this.bracketScopes.set(id, scope);
    let ok = false;
    try {
      ok = await this.executeNode(id);
    } catch (err) {
      this.output.error((err as Error).message);
    } finally {
      this.runningScopes.delete(id);
    }
    if (!guard) return ok;
    const leak = await guard.leave();
    return ok && leak === undefined;
  }

  /**
   * FR-E95: run one node once per branch of its `fork` source.
   *
   * Item executions do NOT touch run state. The parent node owns exactly one
   * `completed`/`failed` transition, so a fan-out over 40 files leaves one
   * verdict in `state.json` instead of 40 overwrites of the same record.
   * Failures are collected here and reported as one aggregated message.
   */
  private async executeFork(
    eng: EngineContext,
    nodeId: string,
    node: NodeConfig,
  ): Promise<boolean> {
    const cfg = node.fork as ForkConfig;
    const maxConcurrent = cfg.max_concurrent ?? 1;
    const failureMode = this.joinFailureMode(cfg.group);
    const cwd = this.workDir !== "." ? this.workDir : undefined;

    let items;
    const journalled = this.journalledBranches.get(nodeId);
    if (journalled !== undefined) {
      items = journalled;
    } else {
      try {
        items = await resolveBranchItems(
          node,
          this.buildContext(nodeId),
          cwd,
          this.staticBranchNames(cfg.group),
        );
      } catch (err) {
        await this.nodeFailed(nodeId, (err as Error).message, "unknown");
        return false;
      }
    }

    if (items.length === 0) {
      this.output.status(nodeId, "fork: branch list is empty, nothing to run");
      return true;
    }
    this.output.status(nodeId, `fork: ${items.length} branches`);
    this.expandedBranches.set(cfg.group, items.map((item) => item.key));
    if (journalled === undefined) {
      await this.journal?.append({
        kind: "branches_expanded",
        node_id: nodeId,
        group: cfg.group,
        branches: items.map(({ index, key, value }) => ({
          index,
          key,
          value,
        })),
      });
    }
    if (maxConcurrent > 1 && node.isolation !== "worktree") {
      this.output.warn(
        `Node '${nodeId}': fork.max_concurrent=${maxConcurrent} — all branches share one worktree, so the FR-E50 guardrail can mis-attribute concurrent writes between them (FR-E91: set 'isolation: worktree' to give each branch its own tree)`,
      );
    }

    const failures: string[] = [];
    const runItem = async (item: BranchItem): Promise<void> => {
      // Item executions report into `failures` instead of run state: the
      // parent node owns the single verdict.
      const itemEng: EngineContext = {
        ...eng,
        buildContext: (nId, loopIteration?) =>
          branchContext(this.buildContext(nId, loopIteration), item),
        nodeStarted: () => Promise.resolve(),
        nodeCompleted: () => Promise.resolve(),
        nodeFailed: (_id, error) => {
          failures.push(`branch ${item.key}: ${error}`);
          return Promise.resolve();
        },
      };

      await ensureItemDir(itemEng.buildContext(nodeId), cwd);
      // FR-E91: each item gets a worktree of its own, so two items writing the
      // same source file no longer race.
      const ok = await this.maybeIsolated(
        itemEng,
        node.isolation === "worktree" ||
          this.branchIsolated(cfg.group, item.key),
        worktreeKey(nodeId, item.key),
        async (nodeEng) =>
          node.type === "agent"
            ? (await executeAgentNode(nodeEng, nodeId, node))?.success === true
            : await executeCommandNode(nodeEng, nodeId, node),
        (r) => r,
      );
      if (!ok && failures.length === 0) {
        failures.push(`branch ${item.key}: failed`);
      }
    };

    for (let i = 0; i < items.length; i += maxConcurrent) {
      const chunk = items.slice(i, i + maxConcurrent);
      const before = failures.length;
      await Promise.all(chunk.map(runItem));
      if (failures.length > before && failureMode === "fail_fast") break;
    }

    if (failures.length === 0) return true;

    const summary = failureMode === "collect"
      ? `fork: ${failures.length} of ${items.length} branches failed:\n${
        failures.join("\n")
      }`
      : `fork: ${failures[0]}`;
    await this.nodeFailed(nodeId, summary, "unknown");
    return false;
  }

  /**
   * FR-E95: the failure mode a branch group runs under.
   *
   * It is declared on the group's `join` node rather than on each branch: the
   * decision is about the group as a whole, and repeating it per branch would
   * let two branches of one group disagree about what a sibling's failure
   * means.
   */
  private joinFailureMode(
    group: string,
  ): "fail_fast" | "collect" | "all_or_nothing" {
    for (const node of Object.values(this.config.nodes)) {
      if (node.join === group) return node.failure_mode ?? "fail_fast";
    }
    return "fail_fast";
  }

  /**
   * Pick the tree a node runs in: its branch's, its own, or the run's.
   *
   * A branch that declared where it may write owns a tree shared by its nodes;
   * a single node outside any branch can still ask for one with
   * `isolation: worktree` (FR-E91); everything else runs in the run's tree.
   */
  private runNodeTree<T>(
    eng: EngineContext,
    nodeId: string,
    node: NodeConfig,
    fn: (nodeEng: EngineContext) => Promise<T>,
    succeeded: (result: T) => boolean,
  ): Promise<T> {
    const own = this.branchOf(nodeId);
    if (own && this.branchIsolated(own.group, own.branch)) {
      return this.inBranchTree(
        eng,
        branchTreeKey(own.group, own.branch),
        nodeId,
        fn,
        succeeded,
      );
    }
    return this.maybeIsolated(
      eng,
      node.isolation === "worktree",
      worktreeKey(nodeId),
      fn,
      succeeded,
    );
  }

  /**
   * FR-E95: the `{{branch.*}}` variables a node of a STATIC branch sees.
   *
   * A static branch has no list item, so the branch's own name is its value
   * and its position among the group's branches is its index. Unlike a runtime
   * branch this does NOT move the node's artifact directory: the branch is
   * spelled out in the config, so there is nothing to disambiguate.
   */
  private staticBranch(nodeId: string): TemplateContext["branch"] | undefined {
    const own = this.branchOf(nodeId);
    if (!own || own.branch === DYNAMIC_BRANCH) return undefined;
    const names = [...this.staticBranchNames(own.group)].sort();
    return {
      index: names.indexOf(own.branch),
      value: own.branch,
      key: own.branch,
    };
  }

  /**
   * FR-E95: the names of a group's branches that are spelled out in the config.
   *
   * A runtime branch may not take one of them: the two would share an artifact
   * directory and a worktree key, so the static branch's work would be
   * overwritten by whichever of them ran last.
   */
  private staticBranchNames(group: string): Set<string> {
    const names = new Set<string>();
    for (const m of this.branchMembership().values()) {
      if (m.group === group && m.branch !== DYNAMIC_BRANCH) names.add(m.branch);
    }
    return names;
  }

  /** Branch membership of every node, computed once per run. */
  private branchOf(
    nodeId: string,
  ): { group: string; branch: string } | undefined {
    return this.branchMembership().get(nodeId);
  }

  /**
   * FR-E37: the write scopes a node's check forgives — the run's own artifact
   * directory, plus every other node in the current bracket.
   *
   * The scope check snapshots the whole tree, so it sees the engine's own
   * artifact writes and a sibling's writes inside this node's bracket and
   * cannot tell whose they are. Forgiving them is the same answer the FR-E50
   * guardrail gives for the same problem — the check can only be as strict as
   * its most permissive concurrent member.
   */
  private forgivenScopes(nodeId: string): readonly string[] {
    // The engine writes the stream log, answers and run state into the run
    // directory while the node works. Those are its writes, not the agent's,
    // and git reports them without the `./` a run dir may carry.
    const runDir = getRunDir(this.state.run_id, this.workflowDir)
      .replace(/^\.\//, "");
    const scopes: string[] = [`${runDir}/**`];
    for (const [id, paths] of this.bracketScopes) {
      if (id !== nodeId) scopes.push(...paths);
    }
    return scopes;
  }

  /** Node → branch for the whole graph, resolved once per run. */
  private branchMembership(): Map<string, { group: string; branch: string }> {
    this.membership ??= resolveBranchMembership(this.config);
    return this.membership;
  }

  /**
   * FR-E96: put a group's branch answers where its join node can read them.
   *
   * `<join>/branches.json` describes the group — every branch, its outcome and
   * its nodes — and `<join>/branches/<branch>/<node>.answer` is a copy of each
   * answer. The join reads ordinary files rather than a template variable,
   * because an answer may be a whole patch and because a `command` join
   * running `git apply` is the intended way to use one.
   */
  private async writeBranchManifest(
    joinId: string,
    group: string,
  ): Promise<void> {
    const joinDir = workPath(this.workDir, this.buildContext(joinId).node_dir);
    const branches: {
      branch: string;
      status: string;
      nodes: { id: string; status: string; answer: string | null }[];
    }[] = [];

    for (const [branch, members] of this.groupBranches(group)) {
      const nodes: { id: string; status: string; answer: string | null }[] = [];
      for (const member of members) {
        const answer = await readAnswer(workPath(this.workDir, member.dir));
        let relative: string | null = null;
        if (answer !== undefined) {
          relative = `branches/${branch}/${member.id}.answer`;
          await Deno.mkdir(`${joinDir}/branches/${branch}`, {
            recursive: true,
          });
          await Deno.writeTextFile(`${joinDir}/${relative}`, answer);
        }
        nodes.push({ id: member.id, status: member.status, answer: relative });
      }
      const status = nodes.some((n) => n.status === "failed")
        ? "failed"
        : nodes.every((n) => n.status === "completed")
        ? "completed"
        : "skipped";
      branches.push({ branch, status, nodes });
    }

    await Deno.mkdir(joinDir, { recursive: true });
    await Deno.writeTextFile(
      `${joinDir}/branches.json`,
      `${JSON.stringify({ group, branches }, null, 2)}\n`,
    );
  }

  /**
   * The branches of one group and the artifact directory of each of their
   * nodes — static branches from config membership, runtime branches from
   * what the forking node actually expanded into.
   */
  private groupBranches(
    group: string,
  ): Map<string, { id: string; dir: string; status: string }[]> {
    const branches = new Map<
      string,
      { id: string; dir: string; status: string }[]
    >();
    for (const [id, own] of this.branchMembership()) {
      if (own.group !== group) continue;
      const status = this.state.nodes[id]?.status ?? "pending";
      const nodeDir = this.buildContext(id).node_dir;
      if (own.branch !== DYNAMIC_BRANCH) {
        const list = branches.get(own.branch) ?? [];
        list.push({ id, dir: nodeDir, status });
        branches.set(own.branch, list);
        continue;
      }
      for (const key of this.expandedBranches.get(group) ?? []) {
        branches.set(key, [{ id, dir: `${nodeDir}/${key}`, status }]);
      }
    }
    return new Map([...branches].sort(([a], [b]) => a.localeCompare(b)));
  }

  /** Whether a branch owns a worktree, derived from its declared write scope. */
  private branchIsolated(group: string, branch: string): boolean {
    this.isolated ??= isolatedBranches(this.config);
    return this.isolated.has(branchTreeKey(group, branch));
  }

  /**
   * Whether this node is the last of its branch still to run, so the branch's
   * tree can be closed.
   *
   * Not "is this a terminal node of the branch": a branch may end in two nodes
   * at once, and closing the tree when the first of them succeeds would take
   * the branch's work away from the second, which would then rebuild an empty
   * tree from the run's HEAD.
   */
  private branchDone(nodeId: string): boolean {
    const own = this.branchOf(nodeId);
    if (!own) return true;
    for (const [id, other] of this.branchMembership()) {
      if (id === nodeId) continue;
      if (other.group !== own.group || other.branch !== own.branch) continue;
      const status = this.state.nodes[id]?.status;
      if (
        status !== "completed" && status !== "failed" && status !== "skipped"
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * FR-E91/FR-E95: run `fn` in the worktree of the node's branch.
   *
   * The tree belongs to the branch, not to the node: a branch is normally an
   * agent that edits and a command that checks the edit, and giving each of
   * them a tree of its own would hide the first one's work from the second.
   * The first node of the branch creates it, the rest reuse it, and it is
   * closed when the branch's last node succeeds — kept, with its path logged,
   * when any node of the branch fails.
   */
  private async inBranchTree<T>(
    eng: EngineContext,
    branchKey: string,
    nodeId: string,
    fn: (nodeEng: EngineContext) => Promise<T>,
    succeeded: (result: T) => boolean,
  ): Promise<T> {
    let treeDir = this.branchTrees.get(branchKey);
    if (treeDir === undefined) {
      const head = await resolveTreeHead(this.workDir);
      treeDir = await createNodeWorktree(
        this.state.run_id,
        this.workflowDir,
        branchKey,
        head,
      );
      this.output.status(branchKey, `branch worktree: ${treeDir}`);
      await copyIgnoredIntoWorktree(
        treeDir,
        this.output,
        this.workDir,
        workPath(this.workDir, this.workflowDir),
      );
      this.branchTrees.set(branchKey, treeDir);
    }

    const shared = this.workDir;
    const tree = treeDir;
    const nodeEng: EngineContext = {
      ...eng,
      nodeWorkDir: tree,
      buildContext: (id, loopIteration?) =>
        isolatedContext(eng.buildContext(id, loopIteration), shared, tree),
    };

    let result: T;
    try {
      result = await fn(nodeEng);
    } catch (err) {
      this.branchTrees.delete(branchKey);
      this.output.warn(`Branch worktree preserved for diagnosis: ${tree}`);
      throw err;
    }
    if (!succeeded(result)) {
      this.branchTrees.delete(branchKey);
      this.output.warn(`Branch worktree preserved for diagnosis: ${tree}`);
      return result;
    }
    if (this.branchDone(nodeId)) {
      this.branchTrees.delete(branchKey);
      await pinDetachedHead(tree, `${this.state.run_id}-${branchKey}`);
      await removeWorktree(tree);
    }
    return result;
  }

  /**
   * FR-E91: run `fn` in a worktree of the node's own when it declares
   * `isolation: worktree`, otherwise run it unchanged.
   *
   * The node's tree is checked out at the run tree's HEAD, so everything the
   * run has committed so far is visible and nothing it has left uncommitted
   * is. Gitignored files are mirrored in (FR-E58) because a tree without them
   * usually cannot build — that copy is the price of the flag, and it is why
   * isolation is opt-in per node rather than a default.
   *
   * The tree is removed when the node succeeds and kept when it fails: a
   * failed node's tree holds the half-finished work that explains the failure.
   * Commits made inside it are pinned to a rescue branch first (FR-E51),
   * because removing a detached worktree makes them unreachable.
   */
  private async maybeIsolated<T>(
    eng: EngineContext,
    isolate: boolean,
    key: string,
    fn: (nodeEng: EngineContext) => Promise<T>,
    succeeded: (result: T) => boolean,
  ): Promise<T> {
    if (!isolate) return await fn(eng);

    const head = await resolveTreeHead(this.workDir);
    const treeDir = await createNodeWorktree(
      this.state.run_id,
      this.workflowDir,
      key,
      head,
    );
    this.output.status(key, `isolated worktree: ${treeDir}`);
    await copyIgnoredIntoWorktree(
      treeDir,
      this.output,
      this.workDir,
      workPath(this.workDir, this.workflowDir),
    );

    const shared = this.workDir;
    const nodeEng: EngineContext = {
      ...eng,
      nodeWorkDir: treeDir,
      buildContext: (id, loopIteration?) =>
        isolatedContext(eng.buildContext(id, loopIteration), shared, treeDir),
    };

    let result: T;
    try {
      result = await fn(nodeEng);
    } catch (err) {
      this.output.warn(`Isolated worktree preserved for diagnosis: ${treeDir}`);
      throw err;
    }
    if (!succeeded(result)) {
      this.output.warn(`Isolated worktree preserved for diagnosis: ${treeDir}`);
      return result;
    }
    await pinDetachedHead(treeDir, `${this.state.run_id}-${key}`);
    await removeWorktree(treeDir);
    return result;
  }

  /** Execute a single node based on its type. Returns true on success. */
  private async executeNode(nodeId: string): Promise<boolean> {
    const declared = this.config.nodes[nodeId];
    // FR-E37: inside a branch, an absent `allowed_paths` is a no-write
    // contract rather than the absence of a check.
    const node: NodeConfig = {
      ...declared,
      allowed_paths: effectiveAllowedPaths(
        declared,
        this.branchOf(nodeId) !== undefined,
      ),
    };
    // Capture waiting state before markNodeStarted overwrites status
    const wasWaiting = this.state.nodes[nodeId]?.status === "waiting";
    await this.nodeStarted(nodeId);

    const extra = node.type === "loop"
      ? `loop, max ${node.max_iterations ?? 3} iterations`
      : node.inputs && node.inputs.length > 1
      ? "parallel"
      : undefined;
    this.output.nodeStarted(nodeId, extra);

    try {
      let success: boolean;
      let lastAgentResult: AgentResult | null = null;

      const eng: EngineContext = {
        config: this.config,
        state: this.state,
        output: this.output,
        options: this.options,
        userInput: this.userInput,
        buildContext: (nId, loopIteration?) => {
          const ctx = this.buildContext(nId, loopIteration);
          const branch = this.staticBranch(nodeId);
          return branch === undefined ? ctx : { ...ctx, branch };
        },
        workDir: this.workDir,
        nodeWorkDir: this.workDir,
        workflowDir: this.workflowDir,
        phaseRegistry: this.phaseRegistry,
        journal: this.journal,
        nodeGuardrail: !this.levelGuardrailActive,
        forgivenScopes: (id) => this.forgivenScopes(id),
        nodeFailed: (id, error, errorCategory) =>
          this.nodeFailed(id, error, errorCategory),
        nodeWaiting: (id, sessionId, questionJson) =>
          this.nodeWaiting(id, sessionId, questionJson),
        nodeStarted: (id) => this.nodeStarted(id),
        nodeCompleted: (id, costUsd, result) =>
          this.nodeCompleted(id, costUsd, result),
      };

      switch (typeof node.fork === "object" ? "fork" : node.type) {
        case "fork":
          success = await this.executeFork(eng, nodeId, node);
          break;
        case "agent": {
          lastAgentResult = await this.runNodeTree(
            eng,
            nodeId,
            node,
            (nodeEng) => executeAgentNode(nodeEng, nodeId, node, wasWaiting),
            (r) => r?.success === true,
          );
          success = lastAgentResult?.success === true;
          break;
        }
        case "command":
          success = await this.runNodeTree(
            eng,
            nodeId,
            node,
            (nodeEng) => executeCommandNode(nodeEng, nodeId, node),
            (ok) => ok,
          );
          break;
        case "merge":
          success = await executeMergeNode(eng, nodeId, node);
          break;
        case "loop":
          success = await executeLoopNode(eng, nodeId, node);
          break;
        case "human":
          success = await executeHumanNode(eng, nodeId, node);
          break;
        case "hitl":
          success = await executeHitlNode(eng, nodeId, node);
          break;
        default:
          throw new Error(`Unknown node type: ${(node as NodeConfig).type}`);
      }

      if (success) {
        await this.nodeCompleted(
          nodeId,
          lastAgentResult?.output?.total_cost_usd,
          lastAgentResult?.output
            ? resultExcerpt(lastAgentResult.output.result ?? "")
            : undefined,
        );

        // FR-E47: per-node budget check. Demote to failed if cost cap exceeded.
        // Only applies to top-level nodes; loop body nodes are checked inside runLoop.
        const resolvedBudget = resolveBudget(node, this.config.defaults);
        const nodeCost = this.state.nodes[nodeId].cost_usd ?? 0;
        if (
          resolvedBudget?.max_usd !== undefined &&
          nodeCost > resolvedBudget.max_usd
        ) {
          const msg = `Node budget exceeded: $${nodeCost.toFixed(4)} > $${
            resolvedBudget.max_usd.toFixed(4)
          }`;
          await this.nodeFailed(nodeId, msg, "aborted");
          this.output.nodeFailed(nodeId, msg);
          if (lastAgentResult?.output) {
            this.output.nodeResult(nodeId, lastAgentResult.output);
          }
          const onError = node.settings?.on_error ?? "fail";
          return onError === "continue";
        }

        const duration = this.state.nodes[nodeId].duration_ms ?? 0;
        this.output.nodeCompleted(nodeId, duration);
        if (lastAgentResult?.output) {
          this.output.nodeResult(nodeId, lastAgentResult.output);
        }
      } else {
        const error = this.state.nodes[nodeId].error ?? "Unknown error";
        this.output.nodeFailed(nodeId, error);
        if (lastAgentResult?.output) {
          this.output.nodeResult(nodeId, lastAgentResult.output);
        }

        // Check on_error policy
        const onError = node.settings?.on_error ?? "fail";
        if (onError === "continue") {
          this.output.status(
            "engine",
            `node ${nodeId}: failure suppressed by on_error: continue`,
          );
          return true;
        }
      }

      return success;
    } catch (err) {
      if (isNodeLifecycleCallbackError(err)) {
        if (this.state.nodes[nodeId]?.status !== "failed") {
          markNodeFailed(this.state, nodeId, (err as Error).message, "unknown");
        }
      } else {
        await this.nodeFailed(nodeId, (err as Error).message, "unknown");
      }
      this.output.nodeFailed(nodeId, (err as Error).message);
      return false;
    }
  }

  /** Apply started transition and publish optional lifecycle callback. */
  private async nodeStarted(nodeId: string): Promise<void> {
    await nodeStarted(
      this.state,
      nodeId,
      this.options.onNodeLifecycle,
      this.journal,
    );
  }

  /** Apply completed transition and publish optional lifecycle callback. */
  private async nodeCompleted(
    nodeId: string,
    costUsd?: number,
    result?: string,
  ): Promise<void> {
    // FR-E99: record which invocation completed an outcome-wave node, so a
    // later attempt can tell "ran in an earlier attempt" from "ran in this
    // one". Stamped before the transition, so the journal snapshot carries it.
    if (this.config.nodes[nodeId]?.run_on !== undefined) {
      const node = this.state.nodes[nodeId];
      if (node) node.completed_attempt = this.state.attempt ?? 1;
    }
    await nodeCompleted(
      this.state,
      nodeId,
      costUsd,
      result,
      this.options.onNodeLifecycle,
      this.journal,
    );
  }

  /** Apply failed transition and publish optional lifecycle callback. */
  private async nodeFailed(
    nodeId: string,
    error: string,
    errorCategory?: RunState["nodes"][string]["error_category"],
  ): Promise<void> {
    await nodeFailed(
      this.state,
      nodeId,
      error,
      errorCategory,
      this.options.onNodeLifecycle,
      this.journal,
    );
  }

  /** Apply waiting transition and publish optional lifecycle callback. */
  private async nodeWaiting(
    nodeId: string,
    sessionId: string,
    questionJson: string,
  ): Promise<void> {
    await nodeWaiting(
      this.state,
      nodeId,
      sessionId,
      questionJson,
      this.options.onNodeLifecycle,
      this.journal,
    );
  }

  /** Apply skipped transition and publish optional lifecycle callback. */
  private async nodeSkipped(nodeId: string): Promise<void> {
    await nodeSkipped(
      this.state,
      nodeId,
      this.options.onNodeLifecycle,
      this.journal,
    );
  }

  /** Build template context for a node (searches top-level and loop body nodes). */
  private buildContext(
    nodeId: string,
    loopIteration?: number,
  ): TemplateContext {
    const node = findNodeConfig(this.config, nodeId);
    if (!node) {
      throw new Error(`Node '${nodeId}' not found in workflow config`);
    }

    // Path fields are workDir-relative — see TemplateContext JSDoc.
    // Engine internal FS callers wrap them with workPath(ctx.workDir, …).
    const paths = buildTaskPaths(
      this.state.run_id,
      nodeId,
      node.inputs ?? [],
      this.workflowDir,
      this.phaseRegistry,
    );

    // Merge node-level env with global env (node overrides global)
    const env = node.env ? { ...this.state.env, ...node.env } : this.state.env;

    return {
      ...paths,
      run_id: this.state.run_id,
      workDir: this.workDir,
      workflow_dir: this.workflowDir,
      args: this.state.args,
      env,
      run: {
        outcome: this.runOutcome,
        attempt: this.state.attempt ?? 1,
      },
      loop: loopIteration !== undefined
        ? { iteration: loopIteration }
        : undefined,
    };
  }

  /** Ensure all node directories exist. */
  private async ensureRunDirs(levels: string[][]): Promise<void> {
    const runDir = workPath(
      this.workDir,
      getRunDir(this.state.run_id, this.workflowDir),
    );
    await Deno.mkdir(`${runDir}/logs`, { recursive: true });

    for (const level of levels) {
      for (const nodeId of level) {
        await Deno.mkdir(
          workPath(
            this.workDir,
            getNodeDir(
              this.state.run_id,
              nodeId,
              this.workflowDir,
              this.phaseRegistry,
            ),
          ),
          { recursive: true },
        );
      }
    }

    // Also create dirs for loop body nodes (from inline nodes sub-object)
    for (const [_, node] of Object.entries(this.config.nodes)) {
      if (node.type === "loop" && node.nodes) {
        for (const bodyId of Object.keys(node.nodes)) {
          await Deno.mkdir(
            workPath(
              this.workDir,
              getNodeDir(
                this.state.run_id,
                bodyId,
                this.workflowDir,
                this.phaseRegistry,
              ),
            ),
            { recursive: true },
          );
        }
      }
    }
  }

  /** Emit ordered bootstrap facts before executable node transitions. */
  private async emitBootstrapJournal(levels: string[][]): Promise<void> {
    if (!this.journal) throw new Error("Run journal is not initialized");
    await this.journal.append({
      kind: "run_started",
      config_path: this.state.config_path,
      started_at: this.state.started_at,
      ts: this.state.started_at,
      args: this.state.args,
      // Only the key set — env values are secrets (`.env` tokens, API keys)
      // and must not become durable state. See RunStartedJournalEvent.
      env_keys: Object.keys(this.state.env).sort(),
    });
    await this.journal.append({
      kind: "workflow_loaded",
      config_path: this.state.config_path,
      name: this.config.name,
      version: this.config.version,
    });

    const declared = new Set<string>();
    for (const nodeId of collectAllNodeIds(this.config)) {
      const node = findNodeConfig(this.config, nodeId);
      if (!node) continue;
      declared.add(nodeId);
      await this.journal.append(nodeDeclarationPayload(nodeId, node));
    }

    const directoryIds = new Set<string>();
    for (const level of levels) {
      for (const nodeId of level) directoryIds.add(nodeId);
    }
    for (const nodeId of declared) directoryIds.add(nodeId);
    for (const nodeId of directoryIds) {
      await this.journal.append({
        kind: "node_directory_declared",
        node_id: nodeId,
        node_dir: getNodeDir(
          this.state.run_id,
          nodeId,
          this.workflowDir,
          this.phaseRegistry,
        ),
      });
    }
  }

  /** Capture runtime version metadata after bootstrap facts are durable.
   *  Skipped when no node uses runtime=claude — probing a CLI that the
   *  workflow does not invoke leaks irrelevant metadata into the journal
   *  and emits a misleading "claude may not be on PATH" warning. */
  private async captureCliVersion(): Promise<void> {
    if (!workflowUsesClaude(this.config)) return;
    try {
      const versionResult = await new Deno.Command("claude", {
        args: ["--version"],
        stdout: "piped",
        stderr: "null",
      }).output();
      if (versionResult.success) {
        this.state.claude_cli_version = new TextDecoder().decode(
          versionResult.stdout,
        ).trim();
        await this.journal?.append({
          kind: "run_metadata_updated",
          claude_cli_version: this.state.claude_cli_version,
        });
      }
    } catch {
      this.output.warn("claude --version failed — claude may not be on PATH");
    }
  }

  /** Persist the final authoritative run status. */
  private async recordRunTerminal(
    kind: "run_completed" | "run_failed" | "run_aborted",
  ): Promise<void> {
    if (!this.state.completed_at) {
      this.state.completed_at = new Date().toISOString();
    }
    await this.journal?.append({
      kind,
      status: this.state.status,
      completed_at: this.state.completed_at,
    });
  }

  /**
   * FR-E47 workflow-wide budget enforcement.
   * Throws when `state.total_cost_usd` strictly exceeds `options.budget_usd`.
   * No-op when `budget_usd` is unset.
   * @param phase — "resume" produces a resume-specific error message; "runtime"
   * uses the generic runtime-abort message.
   */
  private checkWorkflowBudget(phase: "resume" | "runtime"): void {
    const cap = this.options.budget_usd;
    if (cap === undefined) return;
    const total = this.state.total_cost_usd ?? 0;
    if (total > cap) {
      const prefix = phase === "resume"
        ? "Budget exceeded on resume: "
        : "Budget exceeded: ";
      throw new Error(`${prefix}$${total.toFixed(4)} > $${cap.toFixed(4)}`);
    }
  }

  /**
   * FR-E47 pre-run warnings. Emits at most two one-line warnings:
   * (1) `budget.max_turns` set on a node whose resolved runtime is not Claude
   *     — the flag is Claude CLI-only and other runtimes may reject it.
   * (2) `--budget` set while the default runtime does not report `cost_usd`
   *     — the workflow-wide cap will no-op because `total_cost_usd` stays 0.
   */
  private warnBudgetCaveats(): void {
    const defaults = this.config.defaults;

    // (1) max_turns on non-Claude runtime
    const nonClaudeWithMaxTurns = new Set<string>();
    const walk = (
      nodes: Record<string, NodeConfig>,
      parent?: NodeConfig,
    ): void => {
      for (const [id, node] of Object.entries(nodes)) {
        const resolvedBudget = resolveBudget(node, defaults, parent);
        if (resolvedBudget?.max_turns !== undefined) {
          const rc = resolveRuntimeConfig({ defaults, node, parent });
          if (rc.runtime !== "claude") {
            nonClaudeWithMaxTurns.add(`${id}:${rc.runtime}`);
          }
        }
        if (node.type === "loop" && node.nodes) {
          walk(node.nodes, node);
        }
      }
    };
    walk(this.config.nodes);
    for (const entry of nonClaudeWithMaxTurns) {
      const [nodeId, runtime] = entry.split(":");
      this.output.warn(
        `budget.max_turns ignored: runtime=${runtime} (node '${nodeId}')`,
      );
    }

    // (2) --budget with non-cost-reporting runtime (heuristic: non-claude default)
    if (this.options.budget_usd !== undefined) {
      const runtime = defaults?.runtime ?? "claude";
      if (runtime !== "claude") {
        this.output.warn(
          `--budget set but default runtime '${runtime}' may not report cost_usd — budget checks may no-op`,
        );
      }
    }
  }

  /** Create a dry-run state (no actual execution). */
  private createDryRunState(levels: string[][]): RunState {
    const allIds = levels.flat();
    return createRunState(
      "dry-run",
      this.options.config_path,
      allIds,
      this.options.args,
      {},
    );
  }

  /** Print final summary. */
  private printSummary(): void {
    const nodes = Object.values(this.state.nodes);
    const nodeResults: Record<string, string> = {};
    for (const [id, node] of Object.entries(this.state.nodes)) {
      if (node.result) {
        nodeResults[id] = node.result;
      }
    }
    const summary: RunSummary = {
      name: this.config.name,
      runId: this.state.run_id,
      status: this.state.status,
      durationMs: Date.now() - this.startTime,
      total: nodes.length,
      completed: nodes.filter((n) => n.status === "completed").length,
      failed: nodes.filter((n) => n.status === "failed").length,
      skipped: nodes.filter((n) => n.status === "skipped").length,
      nodeResults: Object.keys(nodeResults).length > 0
        ? nodeResults
        : undefined,
    };
    this.output.summary(summary);
  }
}

/**
 * Execute prepare_command once before the node level loop on fresh runs.
 * Supports template interpolation for run_dir, run_id, env.*, args.*.
 * node_dir and input.* resolve to empty string (not meaningful at workflow scope).
 * Throws on non-zero exit — caller saves state and workflow aborts (FR-E30).
 * Call site guards with !options.resume so this is skipped on resumed runs.
 */
export async function runPrepareCommand(
  cmd: string,
  runDir: string,
  runId: string,
  env: Record<string, string>,
  args: Record<string, string>,
  output: OutputManager,
  cwd?: string,
  workflowDir?: string,
): Promise<void> {
  const ctx: TemplateContext = {
    node_dir: "",
    run_dir: runDir,
    run_id: runId,
    workDir: cwd ?? ".",
    workflow_dir: workflowDir ?? "",
    args,
    env,
    input: {},
  };
  const interpolated = interpolate(cmd, ctx);
  output.status("engine", `PREPARE_COMMAND: ${interpolated}`);
  const proc = new Deno.Command("sh", {
    args: ["-c", interpolated],
    stdout: "piped",
    stderr: "piped",
    ...(cwd ? { cwd } : {}),
  });
  const result = await proc.output();
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (stdout) output.status("engine", stdout);
  if (!result.success) {
    const msg = `prepare_command failed: ${interpolated}${
      stderr ? `\n${stderr}` : ""
    }`;
    output.error(msg);
    throw new Error(msg);
  }
}

/** Derive workflow folder (the directory containing `workflow.yaml`) from a
 * config-file path. Pure helper; FR-S47 + FR-E9. Returns "." for bare
 * `workflow.yaml` so back-compat callers still operate cwd-relative. */
export function deriveWorkflowDir(configPath: string): string {
  const idx = Math.max(
    configPath.lastIndexOf("/"),
    configPath.lastIndexOf("\\"),
  );
  if (idx < 0) return ".";
  const dir = configPath.slice(0, idx);
  return dir.length > 0 ? dir : ".";
}

/** FR-E49: Build spawn environment with DISABLE_AUTOUPDATER forced to "1".
 * Merges over current process env; user-set value cannot override the safety flag. */
export function buildSpawnEnv(): Record<string, string> {
  return { ...Deno.env.toObject(), DISABLE_AUTOUPDATER: "1" };
}

/**
 * FR-E81: True iff any agent node (or its resolved defaults/parent loop)
 * dispatches to `runtime: claude`. Used to gate the `claude --version`
 * bootstrap probe so codex/opencode-only workflows do not record an
 * irrelevant `claude_cli_version` in their journal or warn about a missing
 * Claude CLI. Pure function over the loaded config — safe for tests.
 */
export function workflowUsesClaude(config: WorkflowConfig): boolean {
  const defaults = config.defaults;
  let used = false;
  const walk = (
    nodes: Record<string, NodeConfig>,
    parent?: NodeConfig,
  ): void => {
    if (used) return;
    for (const [, node] of Object.entries(nodes)) {
      if (node.type === "agent") {
        const rc = resolveRuntimeConfig({ defaults, node, parent });
        if (rc.runtime === "claude") {
          used = true;
          return;
        }
      }
      if (node.type === "loop" && node.nodes) walk(node.nodes, node);
    }
  };
  walk(config.nodes);
  return used;
}
