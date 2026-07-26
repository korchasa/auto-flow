/**
 * @module
 * Handler-driven fake {@link RuntimeAdapter} for engine tests (FR-E86).
 *
 * The engine's only agent boundary is `adapter.invoke()`. Everything above it
 * — validation, continuation, resume, scope guardrail, HITL routing, state,
 * journal, cost aggregation — is engine-owned logic that used to be
 * untestable without a real agent turn. This module replaces the agent (not
 * the engine) with a plain TypeScript function.
 *
 * Why a handler function rather than a scripted data structure: a function
 * asserts on the invoke options it receives AND generates the reply in the
 * same place, with full control over timing (stall until the FR-E80 retry
 * budget fires, resolve after abort, throw mid-turn). A data scenario would
 * need a new mini-language for each of those.
 *
 * Capabilities default to the REAL adapter's vector for the same runtime id,
 * so a capability change in `@korchasa/ai-ide-cli` surfaces in fakes instead
 * of silently drifting from production behaviour.
 */

import { getRuntimeAdapter } from "@korchasa/ai-ide-cli/runtime";
import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeErrorCategory,
  RuntimeInvokeOptions,
  RuntimeInvokeResult,
  TransportOption,
} from "@korchasa/ai-ide-cli/runtime/types";
import type { PermissionDenial, RuntimeId } from "../types.ts";
import { dirname, isAbsolute, join } from "@std/path";

/** Session id handed out by {@link FakeRuntimeCall.reply} unless overridden. */
export const FAKE_SESSION_ID = "ses-fake";

/** Fields a handler may set on the generated runtime reply. Everything else
 * (durations, runtime id) is filled with inert defaults. */
export interface FakeReplyPatch {
  /** Agent's final text. Default: empty string. */
  result?: string;
  /** Session id echoed back to the engine. Default: {@link FAKE_SESSION_ID}. */
  sessionId?: string;
  /** Reported USD cost. Omit to emulate a runtime that reports none. */
  costUsd?: number;
  /** Conversational turns. Default: 1. */
  numTurns?: number;
  /** Runtime-reported failure flag (FR-E82 fail-fast path). Default: false. */
  isError?: boolean;
  /** Adapter-level error message accompanying the output. */
  error?: string;
  /** Typed adapter error category (e.g. `"stream_stall"`). */
  errorCategory?: RuntimeErrorCategory;
  /** Tools the agent was denied. */
  permissionDenials?: PermissionDenial[];
}

/** One `invoke()` seen by the fake, plus reply/IO builders scoped to it. */
export interface FakeRuntimeCall {
  /** Options the engine passed for this invocation. Assert on them directly. */
  opts: RuntimeInvokeOptions;
  /** 1-based position of this invocation on this adapter instance. */
  index: number;
  /** Every invocation seen so far, this one last. */
  history: readonly RuntimeInvokeOptions[];
  /** Build a successful reply, filling the inert fields. */
  reply(patch?: FakeReplyPatch): RuntimeInvokeResult;
  /** Build a reply with NO output — the runtime died before producing one. */
  fail(
    error: string,
    errorCategory?: RuntimeErrorCategory,
  ): RuntimeInvokeResult;
  /** Write an artifact the way a real agent would. Relative paths resolve
   * against the invocation's `cwd` (worktree under isolation). Parent
   * directories are created. */
  write(path: string, content: string): Promise<void>;
  /** Sleep, rejecting as soon as the engine aborts the invocation via
   * `opts.signal` (FR-E80 wall-clock cap). Leaves no dangling timer, so the
   * test runner's timer sanitizer stays happy. */
  sleep(ms: number): Promise<void>;
}

/** Turn one invocation into a reply. Throwing emulates an adapter crash. */
export type FakeRuntimeHandler = (
  call: FakeRuntimeCall,
) => RuntimeInvokeResult | Promise<RuntimeInvokeResult>;

/** Construction options for {@link createFakeRuntime}. */
export interface FakeRuntimeOptions {
  /** Runtime id the fake impersonates. Default `"opencode"` — it keeps the
   * engine's `claude --version` preflight probe out of the test. */
  id?: RuntimeId;
  /** Capability overrides layered on the real adapter's vector. */
  capabilities?: Partial<RuntimeCapabilities>;
}

/** A {@link RuntimeAdapter} that records what the engine asked of it. */
export interface FakeRuntimeAdapter extends RuntimeAdapter {
  /** Invocations in call order — the engine↔library contract, observable. */
  readonly calls: readonly RuntimeInvokeOptions[];
}

/**
 * Build a fake runtime adapter driven by `handler`.
 *
 * Inject it via `EngineOptions.runtimeAdapter` (whole run), `runAgent`,
 * `runLoop`, or `handleAgentHitl` (single node).
 */
export function createFakeRuntime(
  handler: FakeRuntimeHandler,
  options: FakeRuntimeOptions = {},
): FakeRuntimeAdapter {
  const id = options.id ?? "opencode";
  const real = getRuntimeAdapter(id);
  const overrides = options.capabilities ?? {};
  const history: RuntimeInvokeOptions[] = [];

  return {
    id,
    capabilities: { ...real.capabilities, ...overrides },
    capabilitiesFor(transport: TransportOption): RuntimeCapabilities {
      const base = real.capabilitiesFor?.(transport) ?? real.capabilities;
      return { ...base, ...overrides };
    },
    launchInteractive(): Promise<never> {
      return Promise.reject(
        new Error("createFakeRuntime: launchInteractive() is not emulated"),
      );
    },
    // `async` on purpose: a handler that throws synchronously must surface as
    // a REJECTED promise, the way a real adapter's subprocess failure does.
    // A sync throw out of `invoke()` would violate the adapter contract.
    async invoke(opts: RuntimeInvokeOptions): Promise<RuntimeInvokeResult> {
      history.push(opts);
      return await Promise.resolve(handler({
        opts,
        index: history.length,
        history,
        reply: (patch?: FakeReplyPatch) => buildReply(id, patch),
        fail: (error: string, errorCategory?: RuntimeErrorCategory) => ({
          error,
          error_category: errorCategory,
        }),
        write: (path: string, content: string) =>
          writeArtifact(opts.cwd, path, content),
        sleep: (ms: number) => sleep(ms, opts.signal),
      }));
    },
    get calls(): readonly RuntimeInvokeOptions[] {
      return history;
    },
  };
}

/** Fill the fields no test cares about; keep the ones it does. */
function buildReply(
  runtime: RuntimeId,
  patch: FakeReplyPatch = {},
): RuntimeInvokeResult {
  return {
    output: {
      runtime,
      result: patch.result ?? "",
      session_id: patch.sessionId ?? FAKE_SESSION_ID,
      total_cost_usd: patch.costUsd,
      duration_ms: 0,
      duration_api_ms: 0,
      num_turns: patch.numTurns ?? 1,
      is_error: patch.isError ?? false,
      permission_denials: patch.permissionDenials,
    },
    error: patch.error,
    error_category: patch.errorCategory,
  };
}

async function writeArtifact(
  cwd: string | undefined,
  path: string,
  content: string,
): Promise<void> {
  const target = isAbsolute(path) ? path : join(cwd ?? Deno.cwd(), path);
  await Deno.mkdir(dirname(target), { recursive: true });
  await Deno.writeTextFile(target, content);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(String(signal.reason ?? "aborted"));
}
