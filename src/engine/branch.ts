/**
 * @module
 * Branch expansion (FR-E95): expand one node into one branch per element of a
 * list produced by an earlier node.
 * Entry points: {@link parseBranchSource}, {@link slugifyKey},
 * {@link assignKeys}, {@link resolveBranchItems}.
 */

import type { NodeConfig, TemplateContext } from "../types.ts";
import { interpolate } from "../config/template.ts";
import { workPath } from "../state/state.ts";

/** One expansion of a branching node. */
export interface BranchItem {
  /** Zero-based position in the source list. */
  index: number;
  /** The item itself — a string for a scalar list, an object for a record list. */
  value: unknown;
  /** Artifact-directory name for this branch. */
  key: string;
}

/**
 * Parse a branch source file into items.
 *
 * Two accepted shapes, distinguished by the first non-space character: a JSON
 * array, or one item per non-empty line. Array elements may be strings,
 * numbers (stringified) or objects — an object item is what lets the producing
 * agent hand each branch its own instructions and scope. A document that
 * *looks* like JSON but does not parse is an error rather than a single-line
 * item — silently treating a broken array as one long string would fan out to
 * exactly one nonsense execution.
 */
export function parseBranchSource(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(
        `branch source starts with '[' but is not valid JSON: ${
          (err as Error).message
        }`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error(
        "branch source must be a JSON array or newline-separated items",
      );
    }
    return parsed.map((entry, i) => {
      if (typeof entry === "string") return entry;
      if (typeof entry === "number") return String(entry);
      if (isRecord(entry)) return entry;
      throw new Error(
        `branch source items must be strings, numbers or objects (item ${i} is ${
          describe(entry)
        })`,
      );
    });
  }

  if (trimmed.startsWith("{")) {
    throw new Error(
      "branch source must be a JSON array or newline-separated items",
    );
  }

  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** True for a plain JSON object — arrays and `null` are not records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Name a rejected item's shape in a way that reads in an error message. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

/**
 * Turn an item's text into a filesystem-safe directory name.
 *
 * Path separators, dot segments and whitespace runs collapse to single dashes,
 * so an item that is a path cannot escape its node's artifact directory. A
 * value that collapses to nothing falls back to `item`; the caller rejects
 * collisions.
 */
export function slugifyKey(value: string): string {
  const slug = value
    .replace(/\.\.+/g, ".")
    .split(/[/\\]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== ".")
    .join("-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "item" : slug;
}

/**
 * Attach a branch name to every item.
 *
 * `keyPath` is absent for numbered branches, `value` for a scalar list, or
 * `value.<field>` to read a field of an object item. Two branches of one group
 * may not share a name: unlike a `for_each` item, a branch name addresses a
 * worktree and a manifest entry, so a silent suffix would hide which branch
 * produced which answer. `reserved` carries the group's static branch names for
 * the same reason — a runtime branch that takes a static branch's name would
 * write into its artifact directory and its worktree.
 */
export function assignKeys(
  values: readonly unknown[],
  keyPath: string | undefined,
  reserved?: ReadonlySet<string>,
): BranchItem[] {
  const seen = new Set<string>();
  return values.map((value, index) => {
    const key = keyPath === undefined
      ? String(index)
      : slugifyKey(readKeyField(value, keyPath, index));
    if (seen.has(key)) {
      throw new Error(
        `duplicate branch key '${key}' (item ${index}) — branch names must be unique within a group`,
      );
    }
    if (reserved?.has(key)) {
      throw new Error(
        `branch key '${key}' (item ${index}) collides with a static branch of the same group`,
      );
    }
    seen.add(key);
    return { index, value, key };
  });
}

/** Read the string a `key` path points at, failing loudly on every other shape. */
function readKeyField(value: unknown, keyPath: string, index: number): string {
  const [head, ...fields] = keyPath.split(".");
  if (head !== "value") {
    throw new Error(`branch key must start with 'value', got '${keyPath}'`);
  }

  let current: unknown = value;
  for (const field of fields) {
    if (!isRecord(current)) {
      throw new Error(
        `branch key '${keyPath}' has no field '${field}' (item ${index} is ${
          describe(current)
        })`,
      );
    }
    if (!(field in current)) {
      throw new Error(
        `branch key '${keyPath}' has no field '${field}' (item ${index})`,
      );
    }
    current = current[field];
  }

  if (typeof current !== "string") {
    throw new Error(
      `branch key '${keyPath}' must resolve to a string (item ${index} is ${
        describe(current)
      })`,
    );
  }
  return current;
}

/**
 * Read a node's branch source and build its item list.
 *
 * The source path is interpolated first, so it can point at a predecessor's
 * artifact (`{{input.plan}}/tasks.json`), then resolved against the run's
 * working directory like every other engine-side path.
 */
export async function resolveBranchItems(
  node: NodeConfig,
  ctx: TemplateContext,
  cwd?: string,
  reserved?: ReadonlySet<string>,
): Promise<BranchItem[]> {
  const cfg = node.fork;
  if (cfg === undefined || typeof cfg === "string") {
    throw new Error("Node declares no runtime branch source");
  }

  const base = cwd ?? ctx.workDir;
  const resolved = interpolate(cfg.branches, ctx, base);
  const path = resolved.startsWith("/") ? resolved : workPath(base, resolved);

  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    throw new Error(
      `branch source not readable: ${resolved} (${(err as Error).message})`,
    );
  }

  return assignKeys(parseBranchSource(text), cfg.key, reserved);
}

/**
 * Derive the template context for one branch of a fan-out.
 *
 * `node_dir` gains the branch name as a segment, so every branch writes into
 * its own artifact directory instead of overwriting the previous one's output.
 * The value stays workDir-relative, as the `TemplateContext` contract requires
 * (FR-E52) — this is path composition, not a filesystem access.
 */
export function branchContext(
  ctx: TemplateContext,
  item: BranchItem,
): TemplateContext {
  return {
    ...ctx,
    node_dir: `${ctx.node_dir}/${item.key}`,
    branch: { index: item.index, value: item.value, key: item.key },
  };
}

/** Create a branch's artifact directory before its execution writes into it. */
export async function ensureItemDir(
  ctx: TemplateContext,
  cwd?: string,
): Promise<void> {
  await Deno.mkdir(workPath(cwd ?? ctx.workDir, ctx.node_dir), {
    recursive: true,
  });
}
