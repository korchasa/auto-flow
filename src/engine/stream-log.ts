/**
 * @module
 * Engine-owned per-node stream-log writer + formatter (FR-E18 / FR-E20).
 *
 * Under the ACP-only runtime (FR-E77) the external `@korchasa/ai-ide-cli`
 * library writes nothing to disk — its ACP invoke path only forwards raw
 * `session/update` params through `onEvent`. The engine subscribes to that
 * stream and is the SOLE writer of `${node_dir}/stream.log`, restoring the
 * FR-E18 timestamps and FR-E20 repeated-read warnings the ACP migration
 * dropped, and landing the file write on the correct side of the
 * library/engine boundary (library = transport + raw events; engine =
 * workflow policy + on-disk artefacts).
 *
 * Content *parsing* stays in the library: `handleEvent` wraps the raw ACP
 * params as a `RuntimeSessionEvent` and calls the public
 * {@link extractSessionContent}. The engine owns only *formatting* and
 * *persistence*.
 */

import { extractSessionContent } from "@korchasa/ai-ide-cli/runtime/content";

/** Format a Date as `[HH:MM:SS]` (24-hour, zero-padded). */
export function tsPrefix(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `[${hh}:${mm}:${ss}]`;
}

/**
 * Prefix each non-empty line of `text` with a `[HH:MM:SS]` timestamp.
 * Empty lines pass through unprefixed (FR-E18). The clock is injectable for
 * deterministic tests; production callers omit `now` to stamp wall-clock.
 */
export function stampLines(text: string, now: Date = new Date()): string {
  const prefix = tsPrefix(now);
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? line : `${prefix} ${line}`))
    .join("\n");
}

/**
 * Per-path read counter for one node run (FR-E20). `track` returns the
 * warning line once a path crosses the >2 threshold, else `null`. Counters
 * are per-path independent. One instance spans the initial invoke and every
 * continuation of a node run (a deliberate divergence from the original
 * per-invocation CLI scope — repeated reads across `--resume` attempts are
 * also worth surfacing).
 */
export class FileReadTracker {
  readonly #counts = new Map<string, number>();

  /** Record one read of `path`; return the FR-E20 warning line or `null`. */
  track(path: string): string | null {
    const n = (this.#counts.get(path) ?? 0) + 1;
    this.#counts.set(path, n);
    return n > 2 ? `[WARN] repeated file read: ${path} (${n} times)` : null;
  }
}

/** Engine-owned stream-log writer over a single per-node file handle. */
export interface StreamLogWriter {
  /** Format one raw ACP `session/update` params object and enqueue a write. */
  handleEvent(params: Record<string, unknown>): void;
  /**
   * Return the first async write rejection observed so far (and clear it).
   * `runAgent` polls this after each invoke and after `close()`; a non-null
   * value fails the node `cli_crash`.
   */
  takeWriteError(): Error | null;
  /** Flush pending writes, append the `--- end ---` footer, close the fd.
   * Idempotent. */
  close(): Promise<void>;
}

/** Options for {@link createStreamLogWriter}. */
export interface StreamLogWriterOptions {
  /** Routed sink for a parse throw inside the library extractor. Mirrors the
   * FR-E79 `onCallbackError` channel — a parse failure is best-effort (the
   * line is skipped), only an FS write failure is fatal. */
  onParseError?: (err: unknown, source: string) => void;
}

const encoder = new TextEncoder();

function compactArgs(input: Record<string, unknown> | undefined): string {
  if (!input || Object.keys(input).length === 0) return "";
  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    return "";
  }
  // Keep the line `tail -f`-friendly — cap the rendered args.
  return json.length > 200 ? `${json.slice(0, 197)}...` : json;
}

/**
 * Open `path` once (append, create-if-missing) and return a writer that
 * formats ACP events into timestamped human-readable lines.
 *
 * A synchronous open failure throws — `runAgent` catches it and maps to
 * `error_category: "cli_crash"` (fail-fast). Async write rejections are
 * captured (not thrown) and surfaced through {@link StreamLogWriter.takeWriteError}.
 *
 * The invoke-path `onEvent` is fired WITHOUT await, so `handleEvent` must not
 * return a floating promise: it appends synchronously to an internal
 * promise-chain (`#tail`) that preserves line order and serializes writes.
 */
export function createStreamLogWriter(
  path: string,
  opts: StreamLogWriterOptions = {},
): StreamLogWriter {
  let file: Deno.FsFile;
  try {
    file = Deno.openSync(path, { create: true, append: true });
  } catch (err) {
    throw new Error(
      `Failed to open stream-log file '${path}': ${(err as Error).message}`,
    );
  }

  const tracker = new FileReadTracker();
  let tail: Promise<void> = Promise.resolve();
  let writeError: Error | null = null;
  let closed = false;

  const enqueue = (text: string) => {
    tail = tail.then(async () => {
      if (writeError) return;
      try {
        const bytes = encoder.encode(text);
        let off = 0;
        while (off < bytes.length) {
          off += await file.write(bytes.subarray(off));
        }
      } catch (err) {
        if (!writeError) {
          writeError = err instanceof Error ? err : new Error(String(err));
        }
      }
    });
  };

  const writeLines = (lines: string[]) => {
    if (lines.length === 0) return;
    enqueue(`${stampLines(lines.join("\n"))}\n`);
  };

  return {
    handleEvent(params: Record<string, unknown>) {
      let items;
      try {
        // ACP extractor ignores the `runtime` field — see
        // runtime/acp/content.ts (`_runtime` reserved/unused). The wrapper
        // is byte-identical to the library's own `mapSessionUpdate`.
        items = extractSessionContent({
          runtime: "claude",
          type: "session/update",
          raw: params,
        });
      } catch (err) {
        // Parse failure is best-effort: route to the WARN channel, skip line.
        opts.onParseError?.(err, "onEvent");
        return;
      }
      const lines: string[] = [];
      for (const item of items) {
        if (item.kind === "text") {
          lines.push(`[stream] text: ${item.text}`);
        } else if (item.kind === "tool") {
          const args = compactArgs(item.input);
          lines.push(`[stream] tool: ${item.name}${args ? ` ${args}` : ""}`);
          // FR-E20: surface repeated reads of the same path. Claude's `Read`
          // tool surfaces as the ACP tool title; the path is in `file_path`.
          const filePath = item.input?.file_path;
          if (item.name === "Read" && typeof filePath === "string") {
            const warn = tracker.track(filePath);
            if (warn) lines.push(warn);
          }
        } else if (item.kind === "final") {
          lines.push(`[stream] result: ${item.text}`);
        }
      }
      writeLines(lines);
    },

    takeWriteError(): Error | null {
      const e = writeError;
      writeError = null;
      return e;
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      enqueue(`${stampLines("--- end ---")}\n`);
      await tail;
      try {
        file.close();
      } catch {
        // Already closed / never fully opened — nothing to release.
      }
    },
  };
}
