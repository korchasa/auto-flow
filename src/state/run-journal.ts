/**
 * @module
 * Durable run lifecycle journal writer and replayer.
 *
 * `journal.jsonl` is the recovery contract: one append-only JSON object per
 * line, replayed from an empty in-memory model to reconstruct `RunState`.
 */

import type {
  ErrorCategory,
  NodeConfig,
  NodeLifecycleEvent,
  NodeLifecycleJournalEvent,
  RunJournalEvent,
  RunJournalEventBase,
  RunJournalEventKind,
  RunJournalReplayResult,
  RunState,
} from "../types.ts";
import { updateRunCost } from "./state.ts";

/** Event payload accepted by `RunJournalWriter.append()` before enveloping. */
export type NewRunJournalEvent = RunJournalEvent extends infer Event
  ? Event extends RunJournalEvent
    ? Omit<Event, Exclude<keyof RunJournalEventBase, "kind">> & {
      ts?: string;
    }
  : never
  : never;

/** Return the durable lifecycle journal path for a run directory. */
export function getJournalPath(runDir: string): string {
  return `${runDir}/journal.jsonl`;
}

/**
 * Serialise a value with object keys sorted at every depth (FR-E92).
 *
 * The hash must not depend on the order in which fields happened to be
 * assigned: an event round-tripped through `JSON.parse` keeps insertion order
 * from the file, which need not match the order the writer produced.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${
    entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(
      ",",
    )
  }}`;
}

/**
 * Compute a record's FR-E92 hash: SHA-256 over its canonical JSON with `hash`
 * removed. Because `prev_hash` is part of that JSON, the digest transitively
 * covers every earlier record.
 */
export async function hashJournalEvent(
  event: RunJournalEvent,
): Promise<string> {
  const { hash: _drop, ...rest } = event as RunJournalEvent & {
    hash?: string;
  };
  const bytes = new TextEncoder().encode(canonicalJson(rest));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Append-only writer for a single run's `journal.jsonl`. */
export class RunJournalWriter {
  #nextSeq: number;
  #prevHash: string;

  private constructor(
    readonly runDir: string,
    readonly runId: string,
    nextSeq: number,
    prevHash: string,
  ) {
    this.#nextSeq = nextSeq;
    this.#prevHash = prevHash;
  }

  /** Open a writer, continuing after any valid records already on disk. */
  static async open(runDir: string, runId: string): Promise<RunJournalWriter> {
    await Deno.mkdir(runDir, { recursive: true });
    const parsed = await parseJournal(runDir, { allowMissing: true });
    if (parsed.validByteLength !== undefined) {
      await Deno.truncate(getJournalPath(runDir), parsed.validByteLength);
    }
    const events = parsed.events;
    const maxSeq = events.reduce((max, event) => Math.max(max, event.seq), 0);
    // Resuming onto an unhashed journal starts a chain from "" rather than
    // rewriting history: the earlier records are what they are, and
    // verification reports them as unchained instead of as tampered.
    const prevHash = events.length > 0
      ? events[events.length - 1].hash ?? ""
      : "";
    return new RunJournalWriter(runDir, runId, maxSeq + 1, prevHash);
  }

  /** Append one fully-enveloped event and return the persisted record. */
  async append(event: NewRunJournalEvent): Promise<RunJournalEvent> {
    const seq = this.#nextSeq++;
    const ts = event.ts ?? new Date().toISOString();
    const kind = event.kind;
    const persisted = {
      ...event,
      schema_version: 1,
      run_id: this.runId,
      seq,
      event_id: buildEventId(this.runId, seq, kind, event),
      ts,
      prev_hash: this.#prevHash,
    } as RunJournalEvent;
    persisted.hash = await hashJournalEvent(persisted);
    this.#prevHash = persisted.hash;
    await Deno.writeTextFile(
      getJournalPath(this.runDir),
      `${JSON.stringify(persisted)}\n`,
      { append: true, create: true },
    );
    return persisted;
  }

  /** Append the durable counterpart of a live node lifecycle event. */
  async appendNodeLifecycle(event: NodeLifecycleEvent): Promise<void> {
    await this.append({
      kind: nodeLifecycleKind(event.status),
      node_id: event.node_id,
      status: event.status,
      timestamp: event.timestamp,
      ts: event.timestamp,
      node: event.node,
      metadata: event.metadata,
      ...event.metadata,
    });
  }
}

/** Why a journal's hash chain failed to verify (FR-E92). */
export type JournalChainBreakReason = "hash_mismatch" | "prev_hash_mismatch";

/** Outcome of an FR-E92 hash-chain verification. */
export interface JournalChainVerification {
  /** True when no divergence was found. */
  ok: boolean;
  /** Records whose own hash and link both checked out. */
  verified: number;
  /** Records carrying no hash — written before FR-E92 existed. */
  unchained: number;
  /** The first divergent record; absent when `ok`. */
  broken?: {
    /** Sequence number of the divergent record. */
    seq: number;
    /** Its event id, so an operator can find it in the file. */
    event_id: string;
    /** Its kind. */
    kind: RunJournalEventKind;
    /** `hash_mismatch` = the record itself was edited; `prev_hash_mismatch` =
     * a record before it was edited, removed or inserted. */
    reason: JournalChainBreakReason;
  };
}

/**
 * Verify a run journal's FR-E92 hash chain and name the FIRST divergence.
 *
 * Reporting the first one is the point: after one edited record every later
 * link mismatches, so a report of the last divergence would name a record that
 * is fine and hide the one that is not.
 *
 * Unhashed records (journals from before FR-E92) are counted, not failed —
 * absence of evidence is not evidence of tampering, and failing them would
 * make every pre-upgrade run look compromised.
 */
export async function verifyJournalChain(
  runDir: string,
): Promise<JournalChainVerification> {
  const parsed = await parseJournal(runDir, { allowMissing: false });
  let verified = 0;
  let unchained = 0;
  let expectedPrev: string | undefined;

  for (const event of parsed.events) {
    if (event.hash === undefined) {
      unchained++;
      expectedPrev = undefined;
      continue;
    }

    // `expectedPrev === undefined` means the chain starts here (first record,
    // or the first hashed record after an unhashed prefix), so the link is
    // unconstrained; the record's own hash is still checked.
    if (expectedPrev !== undefined && event.prev_hash !== expectedPrev) {
      return {
        ok: false,
        verified,
        unchained,
        broken: {
          seq: event.seq,
          event_id: event.event_id,
          kind: event.kind,
          reason: "prev_hash_mismatch",
        },
      };
    }
    if (await hashJournalEvent(event) !== event.hash) {
      return {
        ok: false,
        verified,
        unchained,
        broken: {
          seq: event.seq,
          event_id: event.event_id,
          kind: event.kind,
          reason: "hash_mismatch",
        },
      };
    }

    verified++;
    expectedPrev = event.hash;
  }

  return { ok: true, verified, unchained };
}

/** Replay `journal.jsonl` under `runDir` into a current run snapshot. */
export async function replayRunJournal(
  runDir: string,
): Promise<RunJournalReplayResult> {
  const parsed = await parseJournal(runDir, { allowMissing: false });
  const unique: RunJournalEvent[] = [];
  const seen = new Set<string>();
  let ignoredDuplicates = 0;

  for (const event of parsed.events) {
    if (seen.has(event.event_id)) {
      ignoredDuplicates++;
      continue;
    }
    seen.add(event.event_id);
    unique.push(event);
  }

  const state = applyJournalEvents(unique);
  return {
    state,
    events: unique,
    ignored_duplicate_event_ids: ignoredDuplicates,
    ignored_partial_tail: parsed.ignoredPartialTail,
  };
}

/** Convenience helper for callers that only need reconstructed `RunState`. */
export async function loadStateFromJournal(runDir: string): Promise<RunState> {
  return (await replayRunJournal(runDir)).state;
}

async function parseJournal(
  runDir: string,
  opts: { allowMissing: boolean },
): Promise<{
  events: RunJournalEvent[];
  ignoredPartialTail: boolean;
  validByteLength?: number;
}> {
  let content: string;
  try {
    content = await Deno.readTextFile(getJournalPath(runDir));
  } catch (error) {
    if (opts.allowMissing && error instanceof Deno.errors.NotFound) {
      return { events: [], ignoredPartialTail: false };
    }
    throw error;
  }

  if (content === "") return { events: [], ignoredPartialTail: false };

  const endedWithNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (endedWithNewline) lines.pop();

  const events: RunJournalEvent[] = [];
  let ignoredPartialTail = false;
  let validByteLength: number | undefined;
  let lineStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLineStart = lineStart + line.length + 1;
    if (line.trim() === "") {
      lineStart = nextLineStart;
      continue;
    }
    try {
      events.push(JSON.parse(line) as RunJournalEvent);
    } catch (error) {
      const isPartialTail = i === lines.length - 1 && !endedWithNewline;
      if (isPartialTail) {
        ignoredPartialTail = true;
        validByteLength = new TextEncoder().encode(
          content.slice(0, lineStart),
        ).length;
        continue;
      }
      throw new Error(
        `Malformed journal record at ${getJournalPath(runDir)}:${i + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    lineStart = nextLineStart;
  }
  return { events, ignoredPartialTail, validByteLength };
}

function applyJournalEvents(events: RunJournalEvent[]): RunState {
  let state: RunState | undefined;

  for (const event of events) {
    switch (event.kind) {
      case "run_started": {
        if (state) {
          assertSameRun(state, event);
          if (isTerminalStatus(state.status)) break;
        }
        state = {
          run_id: event.run_id,
          config_path: event.config_path,
          started_at: event.started_at,
          status: "running",
          args: event.args,
          // Env VALUES are not durable (secrets). `event.env` is only present
          // in journals written before the redaction change; fresh journals
          // carry `env_keys` and replay to an empty map that the engine
          // refills from the live environment on resume.
          env: event.env ?? {},
          // FR-E99: a journal written before the attempt counter existed has
          // no `run_attempt_started` record; normalising to 1 here spares
          // every reader an `?? 1`.
          attempt: state?.attempt ?? 1,
          nodes: state?.nodes ?? {},
          total_cost_usd: state?.total_cost_usd,
          claude_cli_version: state?.claude_cli_version,
        };
        break;
      }
      case "run_attempt_started": {
        const current = requireState(state, event);
        assertSameRun(current, event);
        current.attempt = event.attempt;
        break;
      }
      case "run_metadata_updated": {
        const current = requireState(state, event);
        assertSameRun(current, event);
        if (event.claude_cli_version !== undefined) {
          current.claude_cli_version = event.claude_cli_version;
        }
        break;
      }
      case "workflow_loaded":
      case "node_directory_declared":
        assertSameRun(requireState(state, event), event);
        break;
      case "node_declared": {
        const current = requireState(state, event);
        assertSameRun(current, event);
        current.nodes[event.node_id] ??= { status: "pending" };
        break;
      }
      case "node_started":
      case "node_completed":
      case "node_failed":
      case "node_waiting":
      case "node_skipped": {
        const current = requireState(state, event);
        assertSameRun(current, event);
        current.nodes[event.node_id] = { ...event.node };
        updateRunCost(current);
        if (current.total_cost_usd === 0) {
          const anyCost = Object.values(current.nodes).some((node) =>
            node.cost_usd !== undefined
          );
          if (!anyCost) delete current.total_cost_usd;
        }
        break;
      }
      case "attempt_started":
      case "attempt_completed":
      case "continuation_exhausted": {
        const current = requireState(state, event);
        assertSameRun(current, event);
        const node = current.nodes[event.node_id] ?? { status: "pending" };
        if (event.branch_key !== undefined) {
          // FR-E100: a branch attempt records its session per key, and only
          // when it succeeded — a failed branch leaves nothing to continue.
          if (event.success === true && event.session_id !== undefined) {
            node.branch_sessions = {
              ...node.branch_sessions,
              [event.branch_key]: event.session_id,
            };
          }
        } else if (event.session_id !== undefined) {
          node.session_id = event.session_id;
        }
        if (event.continuations !== undefined) {
          node.continuations = event.continuations;
        }
        current.nodes[event.node_id] = node;
        break;
      }
      case "branches_expanded":
        // A fork's branch set is a fact the engine reads back on resume; it
        // says nothing about node state, so replay carries it and stops.
        break;
      case "loop_iteration_started":
      case "loop_iteration_completed":
      case "loop_iteration_failed": {
        const current = requireState(state, event);
        assertSameRun(current, event);
        const node = current.nodes[event.loop_node_id] ?? { status: "pending" };
        node.iteration = event.iteration;
        current.nodes[event.loop_node_id] = node;
        break;
      }
      case "run_completed":
      case "run_failed":
      case "run_aborted": {
        const current = requireState(state, event);
        assertSameRun(current, event);
        current.status = event.status;
        current.completed_at = event.completed_at;
        break;
      }
    }
  }

  if (!state) {
    throw new Error("Cannot replay journal: missing run_started event");
  }
  return state;
}

function assertSameRun(state: RunState, event: RunJournalEvent): void {
  if (event.run_id !== state.run_id) {
    throw new Error(
      `Cannot replay mixed-run journal: expected ${state.run_id}, got ${event.run_id}`,
    );
  }
}

function requireState(
  state: RunState | undefined,
  event: RunJournalEvent,
): RunState {
  if (!state) {
    throw new Error(
      `Cannot apply ${event.kind} before run_started in journal replay`,
    );
  }
  return state;
}

function isTerminalStatus(status: RunState["status"]): boolean {
  return status === "completed" || status === "failed" || status === "aborted";
}

function nodeLifecycleKind(status: NodeLifecycleEvent["status"]) {
  return `node_${
    status === "running" ? "started" : status
  }` as NodeLifecycleJournalEvent["kind"];
}

function buildEventId(
  runId: string,
  seq: number,
  kind: RunJournalEventKind,
  event: NewRunJournalEvent,
): string {
  const nodeId = "node_id" in event ? event.node_id : "";
  const loopNodeId = "loop_node_id" in event ? event.loop_node_id : "";
  const iteration = "iteration" in event && event.iteration !== undefined
    ? event.iteration
    : "";
  return [runId, String(seq), kind, nodeId, loopNodeId, String(iteration)]
    .filter((part) => part !== "")
    .join(":");
}

/** Build the compact agent result excerpt persisted in node lifecycle facts. */
export function resultExcerpt(result: string): string {
  return result
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 3)
    .join(" | ")
    .slice(0, 400);
}

/** Emit an attempt completion fact from an agent result-like payload.
 * @param branchKey FR-E100: the fork branch the attempt ran for, when the
 *   node runs once per branch. */
export async function appendAttemptCompleted(
  journal: RunJournalWriter | undefined,
  nodeId: string,
  result: {
    success: boolean;
    session_id?: string;
    continuations: number;
    output?: { session_id?: string; total_cost_usd?: number; result?: string };
    error?: string;
    error_category?: ErrorCategory;
  } | null,
  iteration?: number,
  branchKey?: string,
): Promise<void> {
  if (!journal || !result) return;
  await journal.append({
    kind: result.error_category === "continuations_exhausted"
      ? "continuation_exhausted"
      : "attempt_completed",
    node_id: nodeId,
    iteration,
    branch_key: branchKey,
    session_id: result.session_id ?? result.output?.session_id,
    continuations: result.continuations,
    cost_usd: result.output?.total_cost_usd,
    result: result.output?.result !== undefined
      ? resultExcerpt(result.output.result)
      : undefined,
    success: result.success,
    error: result.error,
    error_category: result.error_category,
  });
}

/** Minimal shape needed from workflow nodes for bootstrap journal facts. */
export function nodeDeclarationPayload(
  nodeId: string,
  node: Pick<NodeConfig, "type" | "label" | "phase">,
): Pick<
  Extract<RunJournalEvent, { kind: "node_declared" }>,
  "kind" | "node_id" | "node_type" | "label" | "phase"
> {
  return {
    kind: "node_declared",
    node_id: nodeId,
    node_type: node.type,
    label: node.label,
    phase: node.phase,
  };
}
