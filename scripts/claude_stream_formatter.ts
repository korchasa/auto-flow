/**
 * @module
 * Transforms claude CLI stream-json events into readable, ANSI-coloured terminal
 * output. Entry points: {@link formatStreamEvent} (single event → string) and
 * {@link processStream} (full stream → StreamResult).
 */

// deno-lint-ignore no-explicit-any
type StreamEvent = Record<string, any>;

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

/** Format a single stream-json event into readable lines. Returns empty string to skip. */
export function formatStreamEvent(event: StreamEvent): string {
  switch (event.type) {
    case "system":
      return formatSystem(event);
    case "assistant":
      return formatAssistant(event);
    case "user":
      return formatUser(event);
    case "result":
      return formatResult(event);
    default:
      return "";
  }
}

function formatSystem(event: StreamEvent): string {
  if (event.subtype === "init") {
    const model = event.model ?? "unknown";
    const toolCount = Array.isArray(event.tools) ? event.tools.length : 0;
    return `${DIM}[init]${RESET} model=${CYAN}${model}${RESET} tools=${toolCount}`;
  }
  return "";
}

function formatAssistant(event: StreamEvent): string {
  const contents = event.message?.content;
  if (!Array.isArray(contents)) return "";

  const lines: string[] = [];
  for (const block of contents) {
    if (block.type === "text" && block.text) {
      lines.push(`${GREEN}▍${RESET} ${block.text}`);
    } else if (block.type === "tool_use") {
      const name = block.name ?? "?";
      const summary = summarizeToolInput(name, block.input);
      lines.push(`${YELLOW}⚡ ${name}${RESET} ${DIM}${summary}${RESET}`);
    }
  }
  return lines.join("\n");
}

function formatUser(event: StreamEvent): string {
  const contents = event.message?.content;
  if (!Array.isArray(contents)) return "";

  const lines: string[] = [];
  for (const block of contents) {
    if (block.type === "tool_result") {
      const status = block.is_error ? `${RED}error${RESET}` : "ok";
      const preview = truncate(extractToolResultText(block.content), 200);
      lines.push(`${DIM}  ↳ ${status}: ${preview}${RESET}`);
    }
  }
  return lines.join("\n");
}

function formatResult(event: StreamEvent): string {
  const ok = event.subtype === "success";
  const icon = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  const dur = event.duration_ms
    ? ` ${DIM}(${formatMs(event.duration_ms)})${RESET}`
    : "";
  const cost = event.total_cost_usd
    ? ` ${DIM}$${event.total_cost_usd.toFixed(4)}${RESET}`
    : "";
  const turns = event.num_turns ? ` turns=${event.num_turns}` : "";
  return `${icon} ${BOLD}${event.subtype}${RESET}${dur}${cost}${turns}`;
}

/** Summarize tool input for one-line display. */
// deno-lint-ignore no-explicit-any
function summarizeToolInput(name: string, input: Record<string, any>): string {
  if (!input) return "";
  switch (name) {
    case "Bash":
      return truncate(input.command ?? "", 120);
    case "Read":
      return input.file_path ?? "";
    case "Write":
      return input.file_path ?? "";
    case "Edit":
      return input.file_path ?? "";
    case "Glob":
      return input.pattern ?? "";
    case "Grep":
      return `/${input.pattern ?? ""}/ ${input.path ?? ""}`;
    case "TodoWrite":
      return Array.isArray(input.todos) ? `${input.todos.length} item(s)` : "";
    default:
      return truncate(JSON.stringify(input), 100);
  }
}

// deno-lint-ignore no-explicit-any
function extractToolResultText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join(" ");
  }
  return "";
}

function truncate(s: string, max: number): string {
  const oneline = s.replaceAll("\n", "↵");
  return oneline.length > max ? oneline.slice(0, max) + "…" : oneline;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.floor(sec % 60);
  return `${min}m${remSec}s`;
}

export interface StreamResult {
  /** Whether a "result" event was received (model finished). */
  completed: boolean;
  /** Whether the result indicated success. */
  success: boolean;
}

/**
 * Process a readable stream of newline-delimited JSON, printing formatted output.
 * Returns stream result info: whether completed and success status.
 */
export async function processStream(
  reader: ReadableStream<Uint8Array>,
  write: (s: string) => void = (s) => console.log(s),
): Promise<StreamResult> {
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let success = false;

  for await (const chunk of reader) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as StreamEvent;
        const formatted = formatStreamEvent(event);
        if (formatted) write(formatted);
        if (event.type === "result") {
          completed = true;
          success = event.subtype === "success";
        }
      } catch {
        // skip malformed JSON lines
      }
    }
  }
  // process remaining buffer
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer) as StreamEvent;
      const formatted = formatStreamEvent(event);
      if (formatted) write(formatted);
      if (event.type === "result") {
        completed = true;
        success = event.subtype === "success";
      }
    } catch {
      // skip
    }
  }
  return { completed, success };
}
